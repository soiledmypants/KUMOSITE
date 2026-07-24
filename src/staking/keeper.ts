// the payout engine: a rapid rotating cycle every CYCLE_MINUTES (default 10).
// claim/sweep fees -> if accumulated ETH >= DISTRIBUTE_MIN_ETH run a payout
// round, else journal "kumo is saving up" and wait. each round: the ta engine
// picks the CURRENT best screen-passing stock (rotation — can differ every
// round), market-buys it with an impact cap, then distributes DIRECTLY to
// stakers pro-rata (memedex-style batch transfers) — NOT via the staking
// contract's reward stream. the contract remains the stake registry + the
// KUMO bootstrap stream.
import { encodeFunctionData, formatEther, formatUnits, parseAbi, parseEther, type Address } from "viem";
import { CONFIG } from "../config.js";
import { publicClient, botAddress } from "../clients.js";
import { withRetry } from "../rpc.js";
import { db } from "../db.js";
import { lines, say } from "../voice.js";
import { encodePath, quoterAbi } from "../trade/quote.js";
import { routerAbi } from "../trade/execute.js";
import { brandTx, sendGuardedTx } from "../trade/guard.js";
import { pickRoundStock } from "./epoch.js";
import { resolveRecipients } from "./recipients.js";
import { computeShares, loadDust, distributeShares } from "./distribute.js";
import { stockByAddress } from "../scanner/discovery.js";
import { ethUsd, priceUsd } from "../scanner/prices.js";
import { emitKumoEvent } from "../twitter/events.js";
import { recordLedger } from "../ledger.js";

const stakingAbi = parseAbi([
  "function totalSupply() view returns (uint256)",
  "function rewardTokens() view returns (address[])",
  "function rewardData(address token) view returns (address distributor, uint256 rewardsDuration, uint256 periodFinish, uint256 rewardRate, uint256 lastUpdateTime, uint256 rewardPerTokenStored, uint256 minNotifyAmount, uint256 notifyCap, uint256 notifiedTotal, uint256 claimedTotal, uint256 ethSpentTotal)",
]);
const erc20Abi = parseAbi(["function balanceOf(address) view returns (uint256)"]);

interface KeeperState {
  lastRun: number | null;
  lastResult: string;
  roundStock: string | null;
  screenNote: string | null;
  lastRound: {
    ts: number;
    stock: string;
    recipients: number;
    skippedDust: number;
    totalSent: string;
    gasSpentEth: string;
  } | null;
  alerts: string[];
}
export const keeperState: KeeperState = {
  lastRun: null,
  lastResult: "never ran",
  roundStock: null,
  screenNote: null,
  lastRound: null,
  alerts: [],
};

let lastSavingLine = 0;

async function journal(ethSpent: bigint, token: string, amount: string, txs: string, note: string): Promise<void> {
  await db.run("INSERT INTO keeper_journal (ts, eth_spent, token, amount, tx_hashes, note) VALUES (?, ?, ?, ?, ?, ?)", [
    Date.now(),
    ethSpent.toString(),
    token,
    amount,
    txs,
    note,
  ]);
}

export async function keeperCycleOnce(): Promise<void> {
  keeperState.lastRun = Date.now();
  keeperState.alerts = [];
  try {
    if (!botAddress) {
      keeperState.lastResult = "wallet not configured";
      return;
    }
    const wallet = botAddress;

    // 1. sweep: everything above the gas reserve is distributable
    const balance = await withRetry(() => publicClient.getBalance({ address: wallet }), "getBalance");
    const reserve = parseEther(CONFIG.gasReserveEth.toString());
    const minDistribute = parseEther(CONFIG.distributeMinEth.toString());
    const distributable = balance > reserve ? balance - reserve : 0n;

    // 2. saving up?
    if (distributable < minDistribute) {
      keeperState.lastResult = `saving up: ${formatEther(distributable)} / ${CONFIG.distributeMinEth} eth`;
      await journal(distributable, "-", "0", "-", "kumo is saving up");
      if (Date.now() - lastSavingLine > 3600_000 && distributable > 0n) {
        lastSavingLine = Date.now();
        say("stake", `kumo is saving up. ${Number(formatEther(distributable)).toFixed(4)} of ${CONFIG.distributeMinEth} eth.`);
      }
      return;
    }

    // 3. the rotation: current best ta pick behind the liquidity screen
    const pick = await pickRoundStock();
    keeperState.roundStock = pick.symbol;
    keeperState.screenNote = pick.screenNote;
    if (!pick.passesScreen) {
      keeperState.alerts.push(`no screen-passing stock this round: ${pick.screenNote}`);
      keeperState.lastResult = "round skipped: liquidity screen";
      await journal(distributable, pick.address.toLowerCase(), "0", "-", "round skipped: liquidity screen not passing");
      return;
    }
    say("stake", `kumo ran the numbers. this round: ${pick.symbol}.`);

    // 4. market-buy with impact cap (two-hop ETH -> USDG -> stock)
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
      probeIn === distributable
        ? 0
        : Math.max(0, (1 - Number(qFull) / Number(distributable) / (Number(qProbe) / Number(probeIn))) * 100);
    if (impact > CONFIG.maxImpactPct) {
      keeperState.alerts.push(`buyback aborted: price impact ${impact.toFixed(2)}%`);
      keeperState.lastResult = "round skipped: impact cap";
      say("stake", lines.keeperSkip(`the ${pick.symbol} pool looked too shallow (impact ${impact.toFixed(1)}%). kumo will wait.`));
      return;
    }
    const minOut = (qFull * BigInt(10_000 - Math.round(CONFIG.slippagePct * 100))) / 10_000n;
    const inner = encodeFunctionData({
      abi: routerAbi,
      functionName: "exactInput",
      args: [{ path, recipient: wallet, amountIn: distributable, amountOutMinimum: minOut }],
    });
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
    const data = encodeFunctionData({ abi: routerAbi, functionName: "multicall", args: [deadline, [inner]] });
    const swapTx = await sendGuardedTx(brandTx({ to: CONFIG.swapRouter02, data, value: distributable, label: "buyback" }));
    await recordLedger({
      kind: "buyback",
      txHash: swapTx,
      assetIn: "ETH",
      amountIn: formatEther(distributable),
      assetOut: pick.symbol,
      from: wallet,
      source: "kumo",
    });

    // 5. distribute the wallet's FULL stock balance (self-heals a crashed prior round)
    const decimals = stockByAddress(pick.address)?.decimals ?? 18;
    const stockBal = await withRetry(
      () => publicClient.readContract({ address: pick.address, abi: erc20Abi, functionName: "balanceOf", args: [wallet] }),
      "keeper.stockBal",
    );
    if (stockBal === 0n) {
      keeperState.lastResult = "buyback yielded nothing to distribute";
      await journal(distributable, pick.address.toLowerCase(), "0", swapTx, "buyback done, zero balance to distribute");
      return;
    }

    const { recipients, mode } = await resolveRecipients();
    if (recipients.length === 0) {
      keeperState.lastResult = "nobody to pay yet — holding the stock for next round";
      keeperState.alerts.push("no stakers or holders resolved; bought stock is held and re-swept next round");
      await journal(distributable, pick.address.toLowerCase(), stockBal.toString(), swapTx, "no recipients yet, holding");
      say("stake", "kumo bought the round but found nobody to pay yet. kumo holds it for later.");
      return;
    }

    const price = await priceUsd(pick.address, pick.symbol);
    const usdPerUnit = price?.price ?? 0;
    const dust = await loadDust(pick.address);
    const shares = computeShares(recipients, stockBal, usdPerUnit, decimals, CONFIG.perRecipientMinUsd, dust);
    const summary = await distributeShares(pick.address, shares);

    if (summary.txHashes.length > 0) {
      await recordLedger({
        kind: "airdrop",
        txHash: summary.txHashes[0],
        assetOut: pick.symbol,
        amountOut: formatUnits(summary.totalSent, decimals),
        from: wallet,
        source: "kumo",
        note: `kumo paid ${summary.recipients} ${mode === "stakers" ? "stakers" : "holders"}. ${Number(formatUnits(summary.totalSent, decimals)).toFixed(4)} ${pick.symbol} total.`,
      });
    }
    await journal(
      distributable,
      pick.address.toLowerCase(),
      summary.totalSent.toString(),
      summary.txHashes.join(","),
      `round: ${summary.recipients} paid, ${summary.skippedDust} dust-accrued, ${summary.failed} failed, gas ${summary.gasSpentEth} eth`,
    );

    keeperState.lastRound = {
      ts: Date.now(),
      stock: pick.symbol,
      recipients: summary.recipients,
      skippedDust: summary.skippedDust,
      totalSent: formatUnits(summary.totalSent, decimals),
      gasSpentEth: summary.gasSpentEth,
    };
    keeperState.lastResult = `paid ${summary.recipients} ${mode} in ${pick.symbol}`;
    say("stake", `kumo paid ${summary.recipients} ${mode === "stakers" ? "stakers" : "holders"}. kumo is already looking again.`);

    const eu = await ethUsd().catch(() => null);
    if (eu) {
      emitKumoEvent({
        type: "fee_claimed",
        amountUsd: Number(formatEther(distributable)) * eu,
        token: pick.symbol,
        txHash: swapTx, // metadata only — composer never sees it, guardrails block it anyway
      });
    }
  } catch (err) {
    keeperState.lastResult = `error: ${(err as Error).message.slice(0, 200)}`;
    say("stake", lines.err("keeper round failed. kumo will try again next cycle."));
  }
}

export async function stakingStats(): Promise<Record<string, unknown>> {
  const journalRows = await db.all(
    "SELECT ts, eth_spent, token, amount, tx_hashes, note FROM keeper_journal ORDER BY id DESC LIMIT 20",
  );
  const weekAgo = Date.now() - 7 * 86_400_000;
  const airdrops7d = await db.all<{ asset_out: string; total: number; rounds: number }>(
    "SELECT asset_out, COUNT(*) AS rounds, SUM(CAST(amount_out AS DOUBLE PRECISION)) AS total FROM ledger WHERE kind = 'airdrop' AND ts > ? GROUP BY asset_out",
    [weekAgo],
  ).catch(async () =>
    db.all<{ asset_out: string; total: number; rounds: number }>(
      "SELECT asset_out, COUNT(*) AS rounds, SUM(CAST(amount_out AS REAL)) AS total FROM ledger WHERE kind = 'airdrop' AND ts > ? GROUP BY asset_out",
      [weekAgo],
    ),
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
            symbol:
              known?.symbol ??
              (CONFIG.kumoToken && token.toLowerCase() === CONFIG.kumoToken.toLowerCase() ? "KUMO" : token.slice(0, 8)),
            token,
            rewardRateScaled: r[3].toString(),
            periodFinish: Number(r[2]),
            notifiedTotal: r[8].toString(),
            claimedTotal: r[9].toString(),
          });
        } catch {
          // transient rpc failure on this token
        }
      }
      onchain = { totalStaked: totalStaked.toString(), bootstrapStreams: perToken };
    } catch {
      onchain = null;
    }
  }
  return {
    pool: CONFIG.stakingAddress || null,
    model: "rotating direct airdrops (fee-funded) + on-chain KUMO bootstrap stream",
    round_stock: keeperState.roundStock,
    screen: keeperState.screenNote,
    keeper: {
      last_run: keeperState.lastRun,
      last_result: keeperState.lastResult,
      last_round: keeperState.lastRound,
      alerts: keeperState.alerts,
      cycle_minutes: CONFIG.cycleMinutes,
      distribute_min_eth: CONFIG.distributeMinEth,
      per_recipient_min_usd: CONFIG.perRecipientMinUsd,
    },
    airdrops_7d: airdrops7d,
    onchain,
    journal: journalRows,
  };
}
