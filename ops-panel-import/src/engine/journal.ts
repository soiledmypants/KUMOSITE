import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { formatEther } from "viem";
import { CONFIG, dataPath } from "../config.js";
import { isDryRun } from "../runtime-mode.js";
import { emitEvent } from "./events.js";

export type LogType =
  | "claim"
  | "unwrap"
  | "forward_eth"
  | "forward_token"
  | "snapshot"
  | "swap"
  | "airdrop"
  | "round"
  | "config"
  | "error";

/** One journal line. True append-only JSONL — one JSON object per line. */
export interface LogEntry {
  ts: string;
  type: LogType;
  dryRun: boolean;
  projectId?: string;
  roundId?: string;
  token?: string;
  // claim
  grossWeth?: string;
  netWeth?: string;
  grossToken?: string;
  netToken?: string;
  // unwrap / forwards / swap / airdrop (wei or raw units, decimal string)
  amount?: string;
  amountOut?: string;
  to?: string;
  role?: "treasury" | "kumo";
  // snapshot / round
  holderCount?: number;
  recipientCount?: number;
  failedCount?: number;
  asset?: "eth" | "token";
  phase?: "start" | "end";
  txHash?: string;
  detail?: string;
}

export interface Stats {
  totalClaimedWethWei: string;
  totalClaimedWethEth: string;
  totalForwardedKumoWei: string;
  totalForwardedKumoEth: string;
  totalForwardedTreasuryWei: string;
  totalForwardedTreasuryEth: string;
  totalTokenForwardedRaw: string;
  totalAirdroppedEthWei: string;
  totalAirdroppedTokenRaw: string;
  claimCount: number;
  forwardCount: number;
  airdropTxCount: number;
  roundCount: number;
  errorCount: number;
  dryRunEntryCount: number;
  lastEntryAt: string | null;
  lastClaimAt: string | null;
  lastRoundAt: string | null;
}

function logPath(): string {
  return dataPath("journal.jsonl");
}

/** Append one entry as a single JSONL line (ts + dryRun auto-filled) and emit it on the bus. */
export function append(entry: Omit<LogEntry, "ts" | "dryRun"> & { dryRun?: boolean }): LogEntry {
  const full: LogEntry = {
    ts: new Date().toISOString(),
    dryRun: entry.dryRun ?? isDryRun(),
    ...entry,
  };
  appendFileSync(logPath(), JSON.stringify(full) + "\n");
  emitEvent("journal", full, full.projectId);
  return full;
}

function readAll(): LogEntry[] {
  const path = logPath();
  if (!existsSync(path)) return [];
  try {
    return readFileSync(path, "utf8")
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as LogEntry];
        } catch {
          return []; // tolerate a torn final line
        }
      });
  } catch {
    return [];
  }
}

/** Read the journal, newest first, optionally filtered by project and limited. */
export function readLog(limit?: number, projectId?: string): LogEntry[] {
  let all = readAll();
  if (projectId) all = all.filter((e) => e.projectId === projectId);
  all.reverse();
  if (limit && limit > 0) return all.slice(0, limit);
  return all;
}

/** Completed round summaries (type "round", phase "end"), newest first. */
export function readRounds(projectId: string, limit = 50): LogEntry[] {
  return readAll()
    .filter((e) => e.projectId === projectId && e.type === "round" && e.phase === "end")
    .reverse()
    .slice(0, limit);
}

/** Fold the journal into totals. Live entries only — dry runs counted separately. */
export function computeStats(projectId?: string): Stats {
  const all = projectId ? readAll().filter((e) => e.projectId === projectId) : readAll();

  let claimedWeth = 0n;
  let kumoWei = 0n;
  let treasuryWei = 0n;
  let tokenRaw = 0n;
  let airdropEth = 0n;
  let airdropToken = 0n;
  let claimCount = 0;
  let forwardCount = 0;
  let airdropTxCount = 0;
  let roundCount = 0;
  let errorCount = 0;
  let dryRunEntryCount = 0;
  let lastClaimAt: string | null = null;
  let lastRoundAt: string | null = null;

  for (const e of all) {
    if (e.type === "error") {
      errorCount++;
      continue;
    }
    if (e.dryRun) {
      dryRunEntryCount++;
      continue;
    }
    try {
      switch (e.type) {
        case "claim":
          claimCount++;
          claimedWeth += BigInt(e.netWeth ?? "0");
          lastClaimAt = e.ts;
          break;
        case "forward_eth":
          forwardCount++;
          if (e.role === "kumo") kumoWei += BigInt(e.amount ?? "0");
          else treasuryWei += BigInt(e.amount ?? "0");
          break;
        case "forward_token":
          forwardCount++;
          tokenRaw += BigInt(e.amount ?? "0");
          break;
        case "airdrop":
          airdropTxCount++;
          if (e.asset === "token") airdropToken += BigInt(e.amount ?? "0");
          else airdropEth += BigInt(e.amount ?? "0");
          break;
        case "round":
          if (e.phase === "end") {
            roundCount++;
            lastRoundAt = e.ts;
          }
          break;
        default:
          break;
      }
    } catch {
      // Bad amount in an old entry — skip rather than break stats.
    }
  }

  const last = all.length > 0 ? all[all.length - 1]!.ts : null;
  return {
    totalClaimedWethWei: claimedWeth.toString(),
    totalClaimedWethEth: formatEther(claimedWeth),
    totalForwardedKumoWei: kumoWei.toString(),
    totalForwardedKumoEth: formatEther(kumoWei),
    totalForwardedTreasuryWei: treasuryWei.toString(),
    totalForwardedTreasuryEth: formatEther(treasuryWei),
    totalTokenForwardedRaw: tokenRaw.toString(),
    totalAirdroppedEthWei: airdropEth.toString(),
    totalAirdroppedTokenRaw: airdropToken.toString(),
    claimCount,
    forwardCount,
    airdropTxCount,
    roundCount,
    errorCount,
    dryRunEntryCount,
    lastEntryAt: last,
    lastClaimAt,
    lastRoundAt,
  };
}
