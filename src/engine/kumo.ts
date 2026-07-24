import { CONFIG } from "../config.js";
import type { ProjectRuntime } from "../projects.js";
import * as journal from "./journal.js";

/**
 * kumo ledger reporting (kumo repo docs/API.md, POST /ledger).
 *
 * Fire-and-forget by design: reportToKumo() returns immediately and the
 * delivery runs detached with 3 attempts — a dead kumo API must never block
 * or crash the claim loop. A final miss is journaled locally (type "error",
 * detail prefixed "kumo-ledger") so it shows up in the panel feed.
 *
 * txHash is deduped server-side, so a retried-then-eventually-delivered
 * report or an accidental double-post is a safe no-op.
 *
 * Nothing is ever posted in DRY_RUN (callers only fire on real txs, and the
 * master switch is re-checked here as a belt-and-braces guard).
 */

export interface LedgerReport {
  kind: "claim" | "forward";
  txHash: `0x${string}`;
  assetIn?: string;
  amountIn?: string;
  assetOut?: string;
  /** Whole units as a string (per API.md), e.g. "0.3" — not wei. */
  amountOut?: string;
  from?: string;
  to?: string;
  note?: string;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export function reportToKumo(p: ProjectRuntime, report: LedgerReport): void {
  if (CONFIG.dryRun) return; // DRY_RUN posts nothing
  if (!CONFIG.kumoApi || !CONFIG.kumoAdminKey) return; // feature off / not configured
  void deliver(p, report); // detached — never awaited by the claim loop
}

async function deliver(p: ProjectRuntime, report: LedgerReport): Promise<void> {
  const body = JSON.stringify({
    ...report,
    chainExplorerUrl: p.explorerTx(report.txHash),
    source: "ops-panel",
  });

  let lastError = "unknown";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${CONFIG.kumoApi}/ledger`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Kumo-Admin-Key": CONFIG.kumoAdminKey,
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        console.log(`[kumo:${p.id}] ledger recorded ${report.kind} ${report.txHash}`);
        return;
      }
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    if (attempt < 3) await sleep(1000 * attempt);
  }

  // Journal the miss locally; swallow absolutely everything.
  console.warn(`[kumo:${p.id}] ledger report missed (${report.kind} ${report.txHash}): ${lastError}`);
  try {
    journal.append({
      type: "error",
      projectId: p.id,
      txHash: report.txHash,
      detail: `kumo-ledger report missed (${report.kind}): ${lastError}`,
    });
  } catch {
    // even the journal failing must not surface
  }
}
