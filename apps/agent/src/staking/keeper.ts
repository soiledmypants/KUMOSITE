// the payout engine: a rapid rotating cycle every CYCLE_MINUTES (default 10).
// claim/sweep fees -> if accumulated ETH >= DISTRIBUTE_MIN_ETH run a payout
// round, else journal "kumo is saving up" and wait. each round: the ta engine
// picks the CURRENT best screen-passing stock (rotation — can differ every
// round), market-buys it with an impact cap, then distributes DIRECTLY to
// stakers pro-rata (memedex-style batch transfers) — NOT via the staking
// contract's reward stream. the contract remains the stake registry + the
// KUMO bootstrap stream.
import { encodeFunctionData, formatEther, formatUnits, parseAbi, parseEther, type Address } from "viem";
import type { RoundPlan } from "@kumo/shared";
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
import {
  computeShares,
  loadDust,
  distributeShares,
  splitPoolAmount,
  clampWeights,
  type DistributionSummary,
  type ShareResult,
} from "./distribute.js";
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
    agents: number;
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

/** quote the two-hop ETH -> USDG -> stock buy and estimate price impact. read-only. */
async function quoteRoundBuy(
  stock: Address,
  amountIn: bigint,
): Promise<{ path: `0x${string}`; quotedOut: bigint; impactPct: number; minOut: bigint }> {
  const path = encodePath([
    { token: CONFIG.weth, fee: CONFIG.wethUsdgFeeTier },
    { token: CONFIG.usdg, fee: CONFIG.usdgStockFeeTier },
    { token: stock },
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
  const qFull = await quote(amountIn);
  const probeIn = amountIn / 100n > 0n ? amountIn / 100n : amountIn;
  const qProbe = await quote(probeIn);
  const impactPct =
    probeIn === amountIn
      ? 0
      : Math.max(0, (1 - Number(qFull) / Number(amountIn) / (Number(qProbe) / Number(probeIn))) * 100);
  const minOut = (qFull * BigInt(10_000 - Math.round(CONFIG.slippagePct * 100))) / 10_000n;
  return { path, quotedOut: qFull, impactPct, minOut };
}

// RoundPlan (the fully-planned, never-sent payout round) is a wire type shared
// with the site — the single copy lives in @kumo/shared.
export type { RoundPlan };

/** plan a round end-to-end without sending anything. safe to call any time. */
export async function keeperPlanOnce(): Promise<RoundPlan> {
  const base: RoundPlan = {
    ts: Date.now(),
    dry: true,
    phase: "no_wallet",
    note: "",
    wallet: botAddress ?? null,
    balance_eth: "0",
    gas_reserve_eth: CONFIG.gasReserveEth,
    distributable_eth: "0",
    distribute_min_eth: CONFIG.distributeMinEth,
    claim_note: "kumo does not claim fees itself — ops-panel claims and forwards ETH here, so the sweep just reads the wallet balance.",
  };
  if (!botAddress) {
    base.note = "no PRIVATE_KEY configured — kumo has no hands, nothing to plan.";
    return base;
  }
  const wallet = botAddress;
  const balance = await withRetry(() => publicClient.getBalance({ address: wallet }), "getBalance");
  const reserve = parseEther(CONFIG.gasReserveEth.toString());
  const minDistribute = parseEther(CONFIG.distributeMinEth.toString());
  const distributable = balance > reserve ? balance - reserve : 0n;
  base.balance_eth = formatEther(balance);
  base.distributable_eth = formatEther(distributable);

  if (distributable < minDistribute) {
    base.phase = "saving_up";
    base.note = `saving up: ${formatEther(distributable)} of ${CONFIG.distributeMinEth} eth — no round would fire.`;
    return base;
  }

  const pick = await pickRoundStock();
  base.pick = {
    symbol: pick.symbol,
    address: pick.address,
    passes_screen: pick.passesScreen,
    screen_note: pick.screenNote,
    ta_score: pick.taScore,
  };
  if (!pick.passesScreen) {
    base.phase = "screen_fail";
    base.note = `round would be skipped: liquidity screen not passing (${pick.screenNote}).`;
    return base;
  }

  const decimals = stockByAddress(pick.address)?.decimals ?? 18;
  const buy = await quoteRoundBuy(pick.address, distributable);
  base.planned_buy = {
    route: `ETH -> USDG -> ${pick.symbol}`,
    amount_in_eth: formatEther(distributable),
    quoted_out: formatUnits(buy.quotedOut, decimals),
    min_out: formatUnits(buy.minOut, decimals),
    impact_pct: Number(buy.impactPct.toFixed(3)),
    max_impact_pct: CONFIG.maxImpactPct,
  };
  if (buy.impactPct > CONFIG.maxImpactPct) {
    base.phase = "impact_abort";
    base.note = `round would be skipped: price impact ${buy.impactPct.toFixed(2)}% over the ${CONFIG.maxImpactPct}% cap.`;
    return base;
  }

  const { stakers, agents, mode } = await resolveRecipients();
  if (stakers.length === 0) {
    base.phase = "no_recipients";
    base.note = "buy would go through, but nobody to pay yet (no stakers or holders) — kumo would hold the stock.";
    return base;
  }

  const price = await priceUsd(pick.address, pick.symbol);
  const usdPerUnit = price?.price ?? 0;

  const poolOn = CONFIG.agentRewardMode === "pool" || CONFIG.agentRewardMode === "both";
  const clampedAgents = clampWeights(agents, CONFIG.maxAgentSharePct);
  const { stakerAmount, agentAmount } = splitPoolAmount(buy.quotedOut, poolOn ? CONFIG.agentPoolPct : 0, clampedAgents.length);

  const shares = computeShares(
    stakers,
    stakerAmount,
    usdPerUnit,
    decimals,
    CONFIG.perRecipientMinUsd,
    await loadDust(pick.address, "stakers"),
  );
  const agentShares: ShareResult =
    agentAmount > 0n
      ? computeShares(clampedAgents, agentAmount, usdPerUnit, decimals, CONFIG.perRecipientMinUsd, await loadDust(pick.address, "agents"))
      : { paid: [], skipped: [], totalPaid: 0n };

  base.planned_distribution = {
    mode,
    recipients: shares.paid.length,
    boosted: shares.paid.filter((s) => s.boosted).length,
    skipped_dust: shares.skipped.length,
    total_planned: formatUnits(shares.totalPaid, decimals),
    per_recipient_min_usd: CONFIG.perRecipientMinUsd,
    boost_enabled: CONFIG.boostEnabled,
    top: shares.paid
      .slice()
      .sort((a, b) => (a.amount > b.amount ? -1 : 1))
      .slice(0, 10)
      .map((s) => ({ address: s.address, amount: formatUnits(s.amount, decimals), boosted: s.boosted })),
  };
  base.planned_agent_pool = {
    mode: CONFIG.agentRewardMode === "" ? "off" : CONFIG.agentRewardMode,
    pool_pct: poolOn ? CONFIG.agentPoolPct : 0,
    eligible_agents: clampedAgents.length,
    amount: formatUnits(agentShares.totalPaid, decimals),
    skipped_dust: agentShares.skipped.length,
    top: agentShares.paid
      .slice()
      .sort((a, b) => (a.amount > b.amount ? -1 : 1))
      .slice(0, 10)
      .map((s) => ({ address: s.address, agent: s.agent, amount: formatUnits(s.amount, decimals) })),
  };
  base.planned_ledger = [
    {
      kind: "buyback",
      assetIn: "ETH",
      amountIn: formatEther(distributable),
      assetOut: pick.symbol,
      amountOut: formatUnits(buy.quotedOut, decimals),
      from: wallet,
      source: "kumo",
      note: `PLANNED: kumo would buy ${Number(formatUnits(buy.quotedOut, decimals)).toFixed(4)} ${pick.symbol} for the ${mode}.`,
    },
    {
      kind: "airdrop",
      assetOut: pick.symbol,
      amountOut: formatUnits(shares.totalPaid, decimals),
      from: wallet,
      source: "kumo",
      note: `PLANNED: kumo would pay ${shares.paid.length} ${mode} (${shares.skipped.length} dust-accrued).`,
    },
  ];
  base.phase = "ready";
  base.note = `round is ready: buy ~${Number(formatUnits(buy.quotedOut, decimals)).toFixed(4)} ${pick.symbol} with ${formatEther(distributable)} eth, pay ${shares.paid.length} ${mode}.`;
  return base;
}

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
    // KEEPER_DRY_RUN: plan the round, journal it, send nothing.
    if (CONFIG.keeperDryRun) {
      const plan = await keeperPlanOnce();
      keeperState.lastResult = `dry-run: ${plan.note}`;
      if (plan.pick) {
        keeperState.roundStock = plan.pick.symbol;
        keeperState.screenNote = plan.pick.screen_note;
      }
      await journal(0n, plan.pick?.address.toLowerCase() ?? "-", "0", "-", `dry-run (${plan.phase}): ${plan.note}`.slice(0, 300));
      return;
    }
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
    const { path, impactPct: impact, minOut } = await quoteRoundBuy(pick.address, distributable);
    if (impact > CONFIG.maxImpactPct) {
      keeperState.alerts.push(`buyback aborted: price impact ${impact.toFixed(2)}%`);
      keeperState.lastResult = "round skipped: impact cap";
      say("stake", lines.keeperSkip(`the ${pick.symbol} pool looked too shallow (impact ${impact.toFixed(1)}%). kumo will wait.`));
      return;
    }
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

    const { stakers, agents, mode } = await resolveRecipients();
    if (stakers.length === 0) {
      // no staker/holder base -> the whole round holds, exactly like today.
      // (agents alone never unlock a round — anti-sybil floor.)
      keeperState.lastResult = "nobody to pay yet — holding the stock for next round";
      keeperState.alerts.push("no stakers or holders resolved; bought stock is held and re-swept next round");
      await journal(distributable, pick.address.toLowerCase(), stockBal.toString(), swapTx, "no recipients yet, holding");
      say("stake", "kumo bought the round but found nobody to pay yet. kumo holds it for later.");
      return;
    }

    const price = await priceUsd(pick.address, pick.symbol);
    const usdPerUnit = price?.price ?? 0;

    // split the bought amount: staker pool + (pool/both mode) agent pool.
    // zero eligible agents -> splitPoolAmount folds the pool back to stakers.
    const poolOn = CONFIG.agentRewardMode === "pool" || CONFIG.agentRewardMode === "both";
    const clampedAgents = clampWeights(agents, CONFIG.maxAgentSharePct);
    const { stakerAmount, agentAmount } = splitPoolAmount(stockBal, poolOn ? CONFIG.agentPoolPct : 0, clampedAgents.length);

    const stakerShares = computeShares(
      stakers,
      stakerAmount,
      usdPerUnit,
      decimals,
      CONFIG.perRecipientMinUsd,
      await loadDust(pick.address, "stakers"),
    );
    const agentShares: ShareResult =
      agentAmount > 0n
        ? computeShares(clampedAgents, agentAmount, usdPerUnit, decimals, CONFIG.perRecipientMinUsd, await loadDust(pick.address, "agents"))
        : { paid: [], skipped: [], totalPaid: 0n };

    // one batched pass: staker transfers then agent transfers, back-to-back
    // through the same guard so the nonce cursor stays linear.
    const stakerSummary = await distributeShares(pick.address, stakerShares, "stakers");
    const agentSummary: DistributionSummary =
      agentShares.paid.length > 0
        ? await distributeShares(pick.address, agentShares, "agents")
        : { recipients: 0, skippedDust: agentShares.skipped.length, failed: 0, totalSent: 0n, gasSpentEth: "0", txHashes: [], sent: [] };

    const totalSent = stakerSummary.totalSent + agentSummary.totalSent;
    const allTx = [...stakerSummary.txHashes, ...agentSummary.txHashes];
    const dustSkipped = stakerSummary.skippedDust + agentSummary.skippedDust;
    const roundTs = Date.now();

    // the round receipt (id read back for the agent_payouts rows)
    await db.run(
      `INSERT INTO rounds (ts, stock_symbol, stock_address, eth_spent, tokens_bought, mode, staker_count, agent_count, dust_skipped, failed, gas_spent_eth, tx_hashes, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        roundTs,
        pick.symbol,
        pick.address.toLowerCase(),
        formatEther(distributable),
        formatUnits(stockBal, decimals),
        mode,
        stakerSummary.recipients,
        agentSummary.recipients,
        dustSkipped,
        stakerSummary.failed + agentSummary.failed,
        (Number(stakerSummary.gasSpentEth) + Number(agentSummary.gasSpentEth)).toFixed(9),
        [swapTx, ...allTx].join(","),
        `paid ${stakerSummary.recipients} ${mode} + ${agentSummary.recipients} agents in ${pick.symbol}`,
      ],
    );
    const roundRow = await db.get<{ id: number }>("SELECT id FROM rounds WHERE ts = ? ORDER BY id DESC", [roundTs]);
    const roundId = Number(roundRow?.id ?? 0);

    // per-agent payout rows + running totals on the agents table
    for (const s of agentSummary.sent) {
      const usd = usdPerUnit > 0 ? Number(formatUnits(s.amount, decimals)) * usdPerUnit : 0;
      await db.run(
        "INSERT INTO agent_payouts (round_id, agent_address, token, amount, tx_hash, ts) VALUES (?, ?, ?, ?, ?, ?)",
        [roundId, (s.agent ?? s.address).toLowerCase(), pick.address.toLowerCase(), formatUnits(s.amount, decimals), s.txHash, roundTs],
      );
      await db.run("UPDATE agents SET total_received = total_received + ?, last_payout_ts = ? WHERE address = ?", [
        usd,
        roundTs,
        (s.agent ?? s.address).toLowerCase(),
      ]);
    }

    if (allTx.length > 0) {
      await recordLedger({
        kind: "airdrop",
        txHash: allTx[0],
        assetOut: pick.symbol,
        amountOut: formatUnits(totalSent, decimals),
        from: wallet,
        source: "kumo",
        note: `kumo paid ${stakerSummary.recipients} ${mode === "stakers" ? "stakers" : "holders"}${agentSummary.recipients > 0 ? ` and ${agentSummary.recipients} agents` : ""}. ${Number(formatUnits(totalSent, decimals)).toFixed(4)} ${pick.symbol} total.`,
      });
    }
    await journal(
      distributable,
      pick.address.toLowerCase(),
      totalSent.toString(),
      allTx.join(","),
      `round #${roundId}: ${stakerSummary.recipients} ${mode} + ${agentSummary.recipients} agents paid, ${dustSkipped} dust-accrued, ${stakerSummary.failed + agentSummary.failed} failed, gas ${stakerSummary.gasSpentEth} eth`,
    );

    keeperState.lastRound = {
      ts: roundTs,
      stock: pick.symbol,
      recipients: stakerSummary.recipients,
      agents: agentSummary.recipients,
      skippedDust: dustSkipped,
      totalSent: formatUnits(totalSent, decimals),
      gasSpentEth: stakerSummary.gasSpentEth,
    };
    keeperState.lastResult = `paid ${stakerSummary.recipients} ${mode}${agentSummary.recipients > 0 ? ` + ${agentSummary.recipients} agents` : ""} in ${pick.symbol}`;
    say(
      "stake",
      `kumo paid ${stakerSummary.recipients} ${mode === "stakers" ? "stakers" : "holders"}${agentSummary.recipients > 0 ? ` and ${agentSummary.recipients} agent friends` : ""}. kumo is already looking again.`,
    );

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
      dry_run: CONFIG.keeperDryRun,
    },
    boost: { enabled: CONFIG.boostEnabled, pct: CONFIG.boostPct },
    airdrops_7d: airdrops7d,
    onchain,
    journal: journalRows,
  };
}
