import { randomUUID } from "node:crypto";
import { formatEther, parseAbi, parseEther } from "viem";
import { baseGasCaps, CONFIG } from "../config.js";
import { withRetry } from "../rpc.js";
import type { ProjectRuntime } from "../projects.js";
import { getHolders, type HolderBalance } from "./holders.js";
import { buyToken, quoteBuy } from "./swap.js";
import { runAirdrop, type AirdropItem } from "./airdrop.js";
import * as journal from "./journal.js";
import { emitEvent } from "./events.js";

/**
 * Rounds: snapshot -> (optional buyback swap) -> airdrop, with an explicit
 * plan/confirm/execute split. planRound() freezes recipients + exact amounts
 * and returns everything the confirm modal shows; executeRound() re-validates
 * and runs it, with the recipient set temporarily allowlisted.
 */

const ERC20_ABI = parseAbi(["function balanceOf(address owner) view returns (uint256)"]);

const PLAN_TTL_MS = 10 * 60 * 1000;

export interface RoundSpec {
  /** eth: distribute budgetEth as ETH; buyback: swap budgetEth -> token, distribute output; token: distribute tokenAmount from the wallet. */
  mode: "eth" | "buyback" | "token";
  budgetEth?: string;
  tokenAmount?: string;
  distribution: "flat" | "pro-rata";
  topN?: number;
  minBalance?: string;
  dryRun?: boolean;
}

export interface RoundRecipient {
  address: `0x${string}`;
  balance: string;
  amount: string;
}

export interface RoundPlan {
  id: string;
  projectId: string;
  createdAt: string;
  expiresAt: string;
  dryRun: boolean;
  mode: RoundSpec["mode"];
  distribution: RoundSpec["distribution"];
  asset: "eth" | "token";
  /** ETH leaving the wallet (airdrop budget or buyback spend), wei string. */
  ethSpendWei: string;
  /** Total distributed (wei for eth, raw units for token; buyback = quoted estimate). */
  totalDistributed: string;
  recipientCount: number;
  recipients: RoundRecipient[];
  minAmount: string;
  maxAmount: string;
  estGasUnits: string;
  estGasCostWei: string;
  quotedOut?: string;
  warnings: string[];
}

interface StoredPlan {
  plan: RoundPlan;
  p: ProjectRuntime;
  items: AirdropItem[];
  holders: HolderBalance[];
}

const plans = new Map<string, StoredPlan>();
const busyProjects = new Set<string>();

export function isBusy(projectId: string): boolean {
  return busyProjects.has(projectId);
}

function sweepPlans(): void {
  const now = Date.now();
  for (const [id, stored] of plans) {
    if (new Date(stored.plan.expiresAt).getTime() < now) plans.delete(id);
  }
}

/** Split `total` across holders. Division dust goes to the first (largest) holder. */
function computeAmounts(
  total: bigint,
  holders: HolderBalance[],
  distribution: RoundSpec["distribution"],
): AirdropItem[] {
  const n = BigInt(holders.length);
  if (distribution === "flat") {
    const per = total / n;
    const dust = total - per * n;
    return holders.map((h, i) => ({ recipient: h.address, amountWei: i === 0 ? per + dust : per }));
  }
  const sum = holders.reduce((acc, h) => acc + h.balance, 0n);
  const items = holders.map((h) => ({ recipient: h.address, amountWei: (total * h.balance) / sum }));
  const assigned = items.reduce((acc, i) => acc + i.amountWei, 0n);
  items[0]!.amountWei += total - assigned;
  return items;
}

export async function planRound(p: ProjectRuntime, spec: RoundSpec): Promise<RoundPlan> {
  sweepPlans();
  if (busyProjects.has(p.id)) throw new Error(`project "${p.id}" already has a round executing`);

  const dryRun = CONFIG.dryRun || (spec.dryRun ?? false);
  const warnings: string[] = [];

  // ---- budget + caps -------------------------------------------------------
  let ethSpendWei = 0n;
  let tokenTotal = 0n;
  let quotedOut: bigint | undefined;

  if (spec.mode === "eth" || spec.mode === "buyback") {
    if (!spec.budgetEth) throw new Error(`mode "${spec.mode}" requires budgetEth`);
    ethSpendWei = parseEther(spec.budgetEth);
    if (ethSpendWei <= 0n) throw new Error("budgetEth must be > 0");
    if (ethSpendWei > p.caps.maxRoundWei) {
      throw new Error(
        `budget ${formatEther(ethSpendWei)} ETH exceeds maxRoundEth cap ${formatEther(p.caps.maxRoundWei)}`,
      );
    }
  } else {
    if (!spec.tokenAmount) throw new Error(`mode "token" requires tokenAmount (raw units)`);
    tokenTotal = BigInt(spec.tokenAmount);
    if (tokenTotal <= 0n) throw new Error("tokenAmount must be > 0");
    const bal = await withRetry(
      () =>
        p.publicClient.readContract({
          address: p.tokenAddress,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [p.botAddress],
        }),
      `rounds:${p.id}.tokenBalance`,
    );
    if (tokenTotal > bal) {
      throw new Error(`tokenAmount ${tokenTotal} exceeds wallet balance ${bal}`);
    }
  }

  // ---- recipients ----------------------------------------------------------
  const holders = await getHolders(p, {
    minBalance: spec.minBalance !== undefined ? BigInt(spec.minBalance) : undefined,
    topN: spec.topN,
  });
  if (holders.length === 0) {
    throw new Error("no eligible holders — run a snapshot first (holders tab) or lower minBalance");
  }
  if (holders.length > p.caps.maxAirdropRecipients) {
    throw new Error(
      `${holders.length} recipients exceeds maxAirdropRecipients cap ${p.caps.maxAirdropRecipients} — set topN`,
    );
  }

  // ---- distribution total --------------------------------------------------
  const asset: "eth" | "token" = spec.mode === "eth" ? "eth" : "token";
  let total: bigint;
  if (spec.mode === "eth") {
    total = ethSpendWei;
  } else if (spec.mode === "buyback") {
    const q = await quoteBuy(p, ethSpendWei);
    quotedOut = q.quotedOut;
    total = q.quotedOut; // estimate — execute re-measures the actual swap output
    warnings.push("buyback output is a quote; actual distributed amount is measured after the swap");
  } else {
    total = tokenTotal;
  }
  if (total <= 0n) throw new Error("nothing to distribute (quote returned 0?)");

  const items = computeAmounts(total, holders, spec.distribution);

  // ---- gas + balance sanity --------------------------------------------------
  const perTxGas = asset === "eth" ? 21_000n : 60_000n;
  const estGasUnits = perTxGas * BigInt(items.length) + (spec.mode === "buyback" ? 250_000n : 0n);
  const estGasCostWei = estGasUnits * baseGasCaps().maxFeePerGas;

  const ethBal = await withRetry(
    () => p.publicClient.getBalance({ address: p.botAddress }),
    `rounds:${p.id}.getBalance`,
  );
  const needed = ethSpendWei + estGasCostWei + p.caps.gasReserveWei;
  if (ethBal < needed) {
    const msg =
      `wallet ETH ${formatEther(ethBal)} < needed ~${formatEther(needed)} ` +
      `(spend + est gas + reserve)`;
    if (dryRun) warnings.push(msg);
    else throw new Error(msg);
  }

  const amounts = items.map((i) => i.amountWei);
  const plan: RoundPlan = {
    id: randomUUID(),
    projectId: p.id,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + PLAN_TTL_MS).toISOString(),
    dryRun,
    mode: spec.mode,
    distribution: spec.distribution,
    asset,
    ethSpendWei: ethSpendWei.toString(),
    totalDistributed: total.toString(),
    recipientCount: items.length,
    recipients: items.map((i, idx) => ({
      address: i.recipient,
      balance: holders[idx]!.balance.toString(),
      amount: i.amountWei.toString(),
    })),
    minAmount: amounts.reduce((a, b) => (b < a ? b : a)).toString(),
    maxAmount: amounts.reduce((a, b) => (b > a ? b : a)).toString(),
    estGasUnits: estGasUnits.toString(),
    estGasCostWei: estGasCostWei.toString(),
    quotedOut: quotedOut?.toString(),
    warnings,
  };

  plans.set(plan.id, { plan, p, items, holders });
  emitEvent("round_plan", { planId: plan.id, recipientCount: plan.recipientCount, dryRun }, p.id);
  return plan;
}

export async function executeRound(planId: string): Promise<{ plan: RoundPlan; sent: number; failed: number }> {
  sweepPlans();
  const stored = plans.get(planId);
  if (!stored) throw new Error("plan not found or expired — plan again");
  plans.delete(planId); // single-use
  const { plan, p } = stored;
  let { items } = stored;

  if (busyProjects.has(p.id)) throw new Error(`project "${p.id}" already has a round executing`);
  busyProjects.add(p.id);
  const roundId = plan.id;

  try {
    journal.append({
      type: "round",
      dryRun: plan.dryRun,
      projectId: p.id,
      roundId,
      phase: "start",
      asset: plan.asset,
      amount: plan.totalDistributed,
      recipientCount: plan.recipientCount,
      detail: `${plan.mode}/${plan.distribution}`,
    });

    if (plan.dryRun) {
      if (plan.mode === "buyback") {
        await buyToken(p, BigInt(plan.ethSpendWei), { dryRun: true, roundId });
      }
      await runAirdrop(p, plan.asset, items, roundId, true);
      const end = journal.append({
        type: "round",
        dryRun: true,
        projectId: p.id,
        roundId,
        phase: "end",
        asset: plan.asset,
        amount: plan.totalDistributed,
        recipientCount: plan.recipientCount,
        failedCount: 0,
        detail: "dry run complete",
      });
      emitEvent("round_end", end, p.id);
      return { plan, sent: 0, failed: 0 };
    }

    await p.sender.refreshNonce();

    const result = await p.sender.withExtraAllowed(
      items.map((i) => i.recipient),
      async () => {
        // Optional buyback: swap, then re-split the ACTUAL received amount.
        if (plan.mode === "buyback") {
          const before = await withRetry(
            () =>
              p.publicClient.readContract({
                address: p.tokenAddress,
                abi: ERC20_ABI,
                functionName: "balanceOf",
                args: [p.botAddress],
              }),
            `rounds:${p.id}.balBefore`,
          );
          await buyToken(p, BigInt(plan.ethSpendWei), { dryRun: false, roundId });
          const after = await withRetry(
            () =>
              p.publicClient.readContract({
                address: p.tokenAddress,
                abi: ERC20_ABI,
                functionName: "balanceOf",
                args: [p.botAddress],
              }),
            `rounds:${p.id}.balAfter`,
          );
          const actualOut = after - before;
          if (actualOut <= 0n) throw new Error("buyback swap produced no tokens");
          items = computeAmounts(actualOut, stored.holders, plan.distribution);
        }
        return runAirdrop(p, plan.asset, items, roundId, false);
      },
    );

    const end = journal.append({
      type: "round",
      dryRun: false,
      projectId: p.id,
      roundId,
      phase: "end",
      asset: plan.asset,
      amount: result.totalSentWei.toString(),
      recipientCount: result.sent,
      failedCount: result.failed,
      txHash: result.firstTxHash,
      detail: `${plan.mode}/${plan.distribution}`,
    });
    emitEvent("round_end", end, p.id);
    return { plan, sent: result.sent, failed: result.failed };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    journal.append({ type: "error", projectId: p.id, roundId, detail: `round: ${message}` });
    throw err;
  } finally {
    busyProjects.delete(p.id);
  }
}
