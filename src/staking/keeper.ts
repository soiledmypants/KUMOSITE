// fee keeper: sweep hot-wallet ETH above reserve -> two-hop buyback into the epoch
// stock -> exact-amount approve -> pull-based notifyRewardAmount on the staking pool.
// crash-safe: notifies the wallet's full stock balance, so a crashed prior cycle heals.
import { encodeFunctionData, formatEther, formatUnits, parseAbi, parseEther, type Address } from "viem";
import { CONFIG } from "../config.js";
import { publicClient, botAddress } from "../clients.js";
import { withRetry } from "../rpc.js";
import { db } from "../db.js";
import { lines, say } from "../voice.js";
import { encodePath, quoterAbi } from "../trade/quote.js";
import { routerAbi } from "../trade/execute.js";
import { brandTx, sendGuardedTx } from "../trade/guard.js";
import { epochStock } from "./epoch.js";
import { stockByAddress } from "../scanner/discovery.js";
import { ethUsd } from "../scanner/prices.js";
import { emitKumoEvent } from "../twitter/events.js";
import { recordLedger } from "../ledger.js";

const stakingAbi = parseAbi([
  "function totalSupply() view returns (uint256)",
  "function notifyRewardAmount(address token, uint256 amount, uint256 ethSpentWei)",
  "function rewardTokens() view returns (address[])",
  "function rewardData(address token) view returns (address distributor, uint256 rewardsDuration, uint256 periodFinish, uint256 rewardRate, uint256 lastUpdateTime, uint256 rewardPerTokenStored, uint256 minNotifyAmount, uint256 notifyCap, uint256 notifiedTotal, uint256 claimedTotal, uint256 ethSpentTotal)",
]);
const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function approve(address, uint256) returns (bool)",
]);

interface KeeperState {
  lastRun: number | null;
  lastResult: string;
  epochSymbol: string | null;
  screenNote: string | null;
  alerts: string[];
}
export const keeperState: KeeperState = { lastRun: null, lastResult: "never ran", epochSymbol: null, screenNote: null, alerts: [] };

export async function keeperCycleOnce(): Promise<void> {
  keeperState.lastRun = Date.now();
  keeperState.alerts = [];
  try {
    if (!CONFIG.stakingAddress || !botAddress) {
      keeperState.lastResult = "staking address or wallet not configured";
      return;
    }
    const staking = CONFIG.stakingAddress as Address;
    const wallet = botAddress;

    const balance = await withRetry(() => publicClient.getBalance({ address: wallet }), "getBalance");
    const reserve = parseEther(CONFIG.gasReserveEth.toString());
    const minFund = parseEther(CONFIG.minFundEth.toString());
    const distributable = balance > reserve ? balance - reserve : 0n;

    const pick = await epochStock();
    keeperState.epochSymbol = pick.symbol;
    keeperState.screenNote = pick.screenNote;
    if (!pick.passesScreen) keeperState.alerts.push(`liquidity screen not passing: ${pick.screenNote}`);
    if (pick.pendingWinner) keeperState.alerts.push(pick.pendingWinner.note);

    const totalStaked = await withRetry(
      () => publicClient.readContract({ address: staking, abi: stakingAbi, functionName: "totalSupply" }),
      "staking.totalSupply",
    );
    if (totalStaked === 0n) {
      keeperState.lastResult = "skipped: nobody staked yet";
      say("stake", lines.keeperSkip("nobody is staked yet. kumo waits."));
      return;
    }

    const reward = await withRetry(
      () => publicClient.readContract({ address: staking, abi: stakingAbi, functionName: "rewardData", args: [pick.address] }),
      "staking.rewardData",
    );
    const minNotify = reward[6];

    if (distributable >= minFund && pick.passesScreen) {
      // two-hop quote + impact screen
      const path = encodePath([
        { token: CONFIG.weth, fee: CONFIG.wethUsdgFeeTier },
        { token: CONFIG.usdg, fee: CONFIG.usdgStockFeeTier },
        { token: pick.address },
      ]);
      const quote = async (amount: bigint) => {
        const { result } = await withRetry(
          () =>
            publicClient.simulateContract({
              address: CONFIG.quoterV2,
              abi: quoterAbi,
              functionName: "quoteExactInput",
              args: [path, amount],
            }),
          "keeper.quote",
        );
        return result[0];
      };
      const qFull = await quote(distributable);
      const probeIn = distributable / 100n > 0n ? distributable / 100n : distributable;
      const qProbe = await quote(probeIn);
      const impact =
        probeIn === distributable ? 0 : Math.max(0, (1 - Number(qFull) / Number(distributable) / (Number(qProbe) / Number(probeIn))) * 100);
      if (impact > CONFIG.maxImpactPct) {
        keeperState.alerts.push(`buyback aborted: price impact ${impact.toFixed(2)}%`);
        say("stake", lines.keeperSkip(`the pool looked too shallow (impact ${impact.toFixed(1)}%). kumo will wait.`));
      } else {
        const minOut = (qFull * BigInt(10_000 - Math.round(CONFIG.slippagePct * 100))) / 10_000n;
        const inner = encodeFunctionData({
          abi: routerAbi,
          functionName: "exactInput",
          args: [{ path, recipient: wallet, amountIn: distributable, amountOutMinimum: minOut }],
        });
        const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
        const data = encodeFunctionData({ abi: routerAbi, functionName: "multicall", args: [deadline, [inner]] });
        const swapTx = await sendGuardedTx(brandTx({ to: CONFIG.swapRouter02, data, value: distributable, label: "buyback" }));
        await db.run(
          "INSERT INTO keeper_journal (ts, eth_spent, token, amount, tx_hashes, note) VALUES (?, ?, ?, ?, ?, ?)",
          [Date.now(), distributable.toString(), pick.address.toLowerCase(), "pending", swapTx, "buyback swap"],
        );
        await recordLedger({
          kind: "buyback",
          txHash: swapTx,
          assetIn: "ETH",
          amountIn: formatEther(distributable),
          assetOut: pick.symbol,
          from: wallet,
          source: "kumo",
        });
      }
    } else if (distributable < minFund) {
      keeperState.lastResult = `skipped: only ${formatEther(distributable)} eth distributable (< ${CONFIG.minFundEth})`;
    }

    // notify the wallet's FULL stock balance (self-healing sweep)
    const stockBal = await withRetry(
      () => publicClient.readContract({ address: pick.address, abi: erc20Abi, functionName: "balanceOf", args: [wallet] }),
      "stock.balanceOf",
    );
    if (stockBal < minNotify || stockBal === 0n) {
      if (keeperState.lastResult.startsWith("never") || !keeperState.lastResult.startsWith("skipped")) {
        keeperState.lastResult = `nothing to notify (balance ${stockBal} < min ${minNotify})`;
      }
      return;
    }

    const approveData = encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [staking, stockBal],
    });
    await sendGuardedTx(brandTx({ to: pick.address, data: approveData, value: 0n, label: "approve" }));

    const notifyData = encodeFunctionData({
      abi: stakingAbi,
      functionName: "notifyRewardAmount",
      args: [pick.address, stockBal, distributable],
    });
    const notifyTx = await sendGuardedTx(brandTx({ to: staking, data: notifyData, value: 0n, label: "notify" }));

    await db.run(
      "INSERT INTO keeper_journal (ts, eth_spent, token, amount, tx_hashes, note) VALUES (?, ?, ?, ?, ?, ?)",
      [Date.now(), distributable.toString(), pick.address.toLowerCase(), stockBal.toString(), notifyTx, "notify"],
    );
    await recordLedger({
      kind: "reward_fund",
      txHash: notifyTx,
      assetOut: pick.symbol,
      amountOut: formatUnits(stockBal, stockByAddress(pick.address)?.decimals ?? 18),
      from: wallet,
      to: staking,
      source: "kumo",
    });
    keeperState.lastResult = `notified ${stockBal} raw ${pick.symbol} to the pool`;
    say("stake", lines.staking(`${formatEther(distributable)} eth became ${pick.symbol} for stakers.`));
    const eu = await ethUsd().catch(() => null);
    if (eu) {
      emitKumoEvent({
        type: "fee_claimed",
        amountUsd: Number(formatEther(distributable)) * eu,
        token: pick.symbol,
        txHash: notifyTx, // event metadata only — composer never receives it, guardrails block it anyway
      });
    }
  } catch (err) {
    keeperState.lastResult = `error: ${(err as Error).message.slice(0, 200)}`;
    say("stake", lines.err("keeper cycle failed. kumo will try again later."));
  }
}

export async function stakingStats(): Promise<Record<string, unknown>> {
  const journal = await db.all(
    "SELECT ts, eth_spent, token, amount, tx_hashes, note FROM keeper_journal ORDER BY id DESC LIMIT 20",
  );
  let onchain: Record<string, unknown> | null = null;
  if (CONFIG.stakingAddress) {
    try {
      const staking = CONFIG.stakingAddress as Address;
      const totalStaked = await publicClient.readContract({ address: staking, abi: stakingAbi, functionName: "totalSupply" });
      const registered = await publicClient.readContract({ address: staking, abi: stakingAbi, functionName: "rewardTokens" });
      const perToken: Record<string, unknown>[] = [];
      for (const token of registered) {
        try {
          const r = await publicClient.readContract({ address: staking, abi: stakingAbi, functionName: "rewardData", args: [token] });
          const known = stockByAddress(token);
          perToken.push({
            symbol: known?.symbol ?? (CONFIG.kumoToken && token.toLowerCase() === CONFIG.kumoToken.toLowerCase() ? "KUMO" : token.slice(0, 8)),
            token,
            rewardRateScaled: r[3].toString(),
            periodFinish: Number(r[2]),
            notifiedTotal: r[8].toString(),
            claimedTotal: r[9].toString(),
            ethSpentTotal: r[10].toString(),
          });
        } catch {
          // transient rpc failure on this token
        }
      }
      onchain = { totalStaked: totalStaked.toString(), rewards: perToken };
    } catch {
      onchain = null;
    }
  }
  return {
    pool: CONFIG.stakingAddress || null,
    epoch_stock: keeperState.epochSymbol,
    screen: keeperState.screenNote,
    keeper: {
      last_run: keeperState.lastRun,
      last_result: keeperState.lastResult,
      alerts: keeperState.alerts,
      next_threshold_eth: CONFIG.minFundEth,
    },
    onchain,
    journal,
  };
}
