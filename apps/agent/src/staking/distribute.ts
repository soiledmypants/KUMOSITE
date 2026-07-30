// direct memedex-style distribution: split the bought stock pro-rata across
// recipients, skip-and-accrue shares under PER_RECIPIENT_MIN_USD (dust carried
// per (address, token) and added back next time that token pays), then batch
// erc-20 transfers through the signer guard with gas accounting.
import { encodeFunctionData, formatEther, parseAbi, type Address } from "viem";
import { CONFIG } from "../config.js";
import { publicClient } from "../clients.js";
import { withRetry } from "../rpc.js";
import { db } from "../db.js";
import { brandTx, sendGuardedTx } from "../trade/guard.js";
import type { Recipient } from "./recipients.js";

const erc20Abi = parseAbi(["function transfer(address, uint256) returns (bool)"]);

export interface Share {
  address: Address;
  amount: bigint; // raw units to send this round (incl. re-added dust)
  dustCarried: bigint; // dust that was added back in
  boosted: boolean;
  agent?: string; // agent identity when this share belongs to the agent pool
}

export interface ShareResult {
  paid: Share[];
  skipped: { address: Address; accrued: bigint }[]; // below min — accrued as dust
  totalPaid: bigint;
}

/** pure share math: pro-rata split + dust threshold. exported for tests. */
export function computeShares(
  recipients: Recipient[],
  totalAmount: bigint,
  tokenUsdPerUnit: number, // usd value of 1 whole token (raw / 10^decimals)
  tokenDecimals: number,
  minUsd: number,
  priorDust: Map<string, bigint>,
): ShareResult {
  const totalWeight = recipients.reduce((a, r) => a + r.weight, 0n);
  if (totalWeight === 0n || totalAmount === 0n) return { paid: [], skipped: [], totalPaid: 0n };

  const minRaw =
    tokenUsdPerUnit > 0
      ? BigInt(Math.floor((minUsd / tokenUsdPerUnit) * 10 ** tokenDecimals))
      : 0n;

  const paid: Share[] = [];
  const skipped: { address: Address; accrued: bigint }[] = [];
  let totalPaid = 0n;
  for (const r of recipients) {
    const base = (totalAmount * r.weight) / totalWeight;
    const dust = priorDust.get(r.address.toLowerCase()) ?? 0n;
    const amount = base + dust;
    if (amount === 0n) continue;
    if (amount < minRaw) {
      skipped.push({ address: r.address, accrued: amount });
    } else {
      paid.push({ address: r.address, amount, dustCarried: dust, boosted: r.boosted, agent: r.agent });
      totalPaid += amount;
    }
  }
  return { paid, skipped, totalPaid };
}

export type DustPool = "stakers" | "agents";

/** dust is keyed per (address, token, pool) with ZERO schema surgery: the agent
 * pool suffixes the token key. exported for tests. */
export function dustKey(token: string, pool: DustPool = "stakers"): string {
  return pool === "agents" ? `${token.toLowerCase()}:agents` : token.toLowerCase();
}

/** split a bought amount into staker + agent-pool portions. zero eligible
 * agents -> the pool folds back to stakers, never stranded. pure, tested. */
export function splitPoolAmount(
  total: bigint,
  poolPct: number,
  eligibleAgents: number,
): { stakerAmount: bigint; agentAmount: bigint } {
  const pct = Math.min(Math.max(poolPct, 0), 25); // hard cap mirrors config
  if (eligibleAgents <= 0 || pct <= 0 || total === 0n) return { stakerAmount: total, agentAmount: 0n };
  const agentAmount = (total * BigInt(Math.round(pct * 100))) / 10_000n;
  return { stakerAmount: total - agentAmount, agentAmount };
}

/** clamp any single recipient to maxSharePct of the pool's total weight,
 * redistributing implicitly (iterates to a fixpoint). when the cap is
 * mathematically unsatisfiable (fewer than 100/pct recipients) it falls back
 * to an equal split. pure, tested. */
export function clampWeights(recipients: Recipient[], maxSharePct: number): Recipient[] {
  if (recipients.length === 0 || maxSharePct >= 100) return recipients;
  if (recipients.length < Math.ceil(100 / maxSharePct)) {
    return recipients.map((r) => ({ ...r, weight: 1_000_000n }));
  }
  const out = recipients.map((r) => ({ ...r }));
  for (let iter = 0; iter < 20; iter++) {
    const total = out.reduce((a, r) => a + r.weight, 0n);
    if (total === 0n) return out;
    const cap = (total * BigInt(Math.round(maxSharePct * 100))) / 10_000n;
    let changed = false;
    for (const r of out) {
      if (r.weight > cap) {
        r.weight = cap;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return out;
}

export async function loadDust(token: string, pool: DustPool = "stakers"): Promise<Map<string, bigint>> {
  const rows = await db.all<{ address: string; amount: string }>(
    "SELECT address, amount FROM dust_accruals WHERE token = ?",
    [dustKey(token, pool)],
  );
  return new Map(rows.map((r) => [r.address.toLowerCase(), BigInt(r.amount)]));
}

async function saveDust(token: string, result: ShareResult, pool: DustPool): Promise<void> {
  const key = dustKey(token, pool);
  // paid recipients consumed their carried dust; skipped ones accrue
  for (const p of result.paid) {
    if (p.dustCarried > 0n) {
      await db.run("DELETE FROM dust_accruals WHERE address = ? AND token = ?", [p.address.toLowerCase(), key]);
    }
  }
  for (const s of result.skipped) {
    const existing = await db.get("SELECT amount FROM dust_accruals WHERE address = ? AND token = ?", [
      s.address.toLowerCase(),
      key,
    ]);
    if (existing) {
      await db.run("UPDATE dust_accruals SET amount = ? WHERE address = ? AND token = ?", [
        s.accrued.toString(),
        s.address.toLowerCase(),
        key,
      ]);
    } else {
      await db.run("INSERT INTO dust_accruals (address, token, amount) VALUES (?, ?, ?)", [
        s.address.toLowerCase(),
        key,
        s.accrued.toString(),
      ]);
    }
  }
}

export interface SentShare {
  address: Address;
  amount: bigint;
  txHash: string;
  boosted: boolean;
  agent?: string;
}

export interface DistributionSummary {
  recipients: number;
  skippedDust: number;
  failed: number;
  totalSent: bigint;
  gasSpentEth: string;
  txHashes: string[];
  sent: SentShare[]; // per-recipient detail (feeds agent_payouts + receipts)
}

/** send the shares: serial transfers with the guard's nonce/gas-bump handling.
 * both pools of a round flow through here back-to-back in one pass — the
 * guard's nonce cursor is shared, so ordering stays sane. */
export async function distributeShares(
  token: Address,
  result: ShareResult,
  pool: DustPool = "stakers",
): Promise<DistributionSummary> {
  const txHashes: string[] = [];
  const sent: SentShare[] = [];
  let gasWei = 0n;
  let failed = 0;
  let totalSent = 0n;

  for (const share of result.paid) {
    try {
      const data = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [share.address, share.amount] });
      const hash = await sendGuardedTx(brandTx({ to: token, data, value: 0n, label: "airdrop" }));
      txHashes.push(hash);
      sent.push({ address: share.address, amount: share.amount, txHash: hash, boosted: share.boosted, agent: share.agent });
      totalSent += share.amount;
      try {
        const receipt = await withRetry(() => publicClient.getTransactionReceipt({ hash }), "distribute.receipt", { retries: 2 });
        gasWei += receipt.gasUsed * receipt.effectiveGasPrice;
      } catch {
        // receipt fetch failure only affects gas accounting
      }
    } catch (err) {
      failed++;
      console.error(`[kumo/distribute] transfer to ${share.address} failed:`, (err as Error).message.slice(0, 120));
      // failed share accrues as dust so nobody silently loses their cut
      const key = dustKey(token, pool);
      const existing = await db.get("SELECT amount FROM dust_accruals WHERE address = ? AND token = ?", [
        share.address.toLowerCase(),
        key,
      ]);
      const next = BigInt((existing as { amount: string } | undefined)?.amount ?? "0") + share.amount;
      if (existing) {
        await db.run("UPDATE dust_accruals SET amount = ? WHERE address = ? AND token = ?", [
          next.toString(),
          share.address.toLowerCase(),
          key,
        ]);
      } else {
        await db.run("INSERT INTO dust_accruals (address, token, amount) VALUES (?, ?, ?)", [
          share.address.toLowerCase(),
          key,
          next.toString(),
        ]);
      }
    }
  }

  await saveDust(token, result, pool);
  return {
    recipients: result.paid.length - failed,
    skippedDust: result.skipped.length,
    failed,
    totalSent,
    gasSpentEth: formatEther(gasWei),
    txHashes,
    sent,
  };
}
