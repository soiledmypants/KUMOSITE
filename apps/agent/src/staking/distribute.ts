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
      paid.push({ address: r.address, amount, dustCarried: dust, boosted: r.boosted });
      totalPaid += amount;
    }
  }
  return { paid, skipped, totalPaid };
}

export async function loadDust(token: string): Promise<Map<string, bigint>> {
  const rows = await db.all<{ address: string; amount: string }>(
    "SELECT address, amount FROM dust_accruals WHERE token = ?",
    [token.toLowerCase()],
  );
  return new Map(rows.map((r) => [r.address.toLowerCase(), BigInt(r.amount)]));
}

async function saveDust(token: string, result: ShareResult): Promise<void> {
  // paid recipients consumed their carried dust; skipped ones accrue
  for (const p of result.paid) {
    if (p.dustCarried > 0n) {
      await db.run("DELETE FROM dust_accruals WHERE address = ? AND token = ?", [
        p.address.toLowerCase(),
        token.toLowerCase(),
      ]);
    }
  }
  for (const s of result.skipped) {
    const existing = await db.get("SELECT amount FROM dust_accruals WHERE address = ? AND token = ?", [
      s.address.toLowerCase(),
      token.toLowerCase(),
    ]);
    if (existing) {
      await db.run("UPDATE dust_accruals SET amount = ? WHERE address = ? AND token = ?", [
        s.accrued.toString(),
        s.address.toLowerCase(),
        token.toLowerCase(),
      ]);
    } else {
      await db.run("INSERT INTO dust_accruals (address, token, amount) VALUES (?, ?, ?)", [
        s.address.toLowerCase(),
        token.toLowerCase(),
        s.accrued.toString(),
      ]);
    }
  }
}

export interface DistributionSummary {
  recipients: number;
  skippedDust: number;
  failed: number;
  totalSent: bigint;
  gasSpentEth: string;
  txHashes: string[];
}

/** send the shares: serial transfers with the guard's nonce/gas-bump handling */
export async function distributeShares(token: Address, result: ShareResult): Promise<DistributionSummary> {
  const txHashes: string[] = [];
  let gasWei = 0n;
  let failed = 0;
  let totalSent = 0n;

  for (const share of result.paid) {
    try {
      const data = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [share.address, share.amount] });
      const hash = await sendGuardedTx(brandTx({ to: token, data, value: 0n, label: "airdrop" }));
      txHashes.push(hash);
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
      const existing = await db.get("SELECT amount FROM dust_accruals WHERE address = ? AND token = ?", [
        share.address.toLowerCase(),
        token.toLowerCase(),
      ]);
      const next = BigInt((existing as { amount: string } | undefined)?.amount ?? "0") + share.amount;
      if (existing) {
        await db.run("UPDATE dust_accruals SET amount = ? WHERE address = ? AND token = ?", [
          next.toString(),
          share.address.toLowerCase(),
          token.toLowerCase(),
        ]);
      } else {
        await db.run("INSERT INTO dust_accruals (address, token, amount) VALUES (?, ?, ?)", [
          share.address.toLowerCase(),
          token.toLowerCase(),
          next.toString(),
        ]);
      }
    }
  }

  await saveDust(token, result);
  return {
    recipients: result.paid.length - failed,
    skippedDust: result.skipped.length,
    failed,
    totalSent,
    gasSpentEth: formatEther(gasWei),
    txHashes,
  };
}
