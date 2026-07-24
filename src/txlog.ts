import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { formatEther } from "viem";
import { CONFIG } from "./config.js";

const DATA_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "data");
const LOG_PATH = resolve(DATA_DIR, "journal.jsonl");

export type LogType = "claim" | "unwrap" | "forward_eth" | "forward_token" | "error";

/** One journal line. True append-only JSONL — one JSON object per line. */
export interface LogEntry {
  ts: string; // ISO timestamp
  type: LogType;
  dryRun: boolean;
  token?: string; // token address involved
  // claim
  grossWeth?: string;
  netWeth?: string;
  grossToken?: string;
  netToken?: string;
  // unwrap / forwards (wei or raw token units, decimal string)
  amount?: string;
  to?: string;
  role?: "treasury" | "kumo";
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
  claimCount: number;
  forwardCount: number;
  errorCount: number;
  dryRunEntryCount: number;
  lastEntryAt: string | null;
  lastCycleAt: string | null;
  nextCycleAt: string | null;
  intervalMinutes: number;
}

let lastCycleAt: string | null = null;

/** Record that a cycle ran (even if it produced no journal entries). */
export function markCycle(): void {
  lastCycleAt = new Date().toISOString();
}

function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

/** Append one entry as a single JSONL line (timestamp + dryRun auto-filled). */
export function append(entry: Omit<LogEntry, "ts" | "dryRun"> & { dryRun?: boolean }): LogEntry {
  ensureDataDir();
  const full: LogEntry = {
    ts: new Date().toISOString(),
    dryRun: entry.dryRun ?? CONFIG.dryRun,
    ...entry,
  };
  appendFileSync(LOG_PATH, JSON.stringify(full) + "\n");
  return full;
}

function readAll(): LogEntry[] {
  if (!existsSync(LOG_PATH)) return [];
  try {
    return readFileSync(LOG_PATH, "utf8")
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

/** Read the journal, newest first, optionally limited. */
export function readLog(limit?: number): LogEntry[] {
  const all = readAll().reverse();
  if (limit && limit > 0) return all.slice(0, limit);
  return all;
}

/** Fold the journal into totals. Live entries only — dry runs are counted separately. */
export function computeStats(): Stats {
  const all = readAll();

  let claimedWeth = 0n;
  let kumoWei = 0n;
  let treasuryWei = 0n;
  let tokenRaw = 0n;
  let claimCount = 0;
  let forwardCount = 0;
  let errorCount = 0;
  let dryRunEntryCount = 0;

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
        case "unwrap":
          break;
      }
    } catch {
      // Bad amount in an old entry — skip it rather than break /stats.
    }
  }

  const last = all.length > 0 ? all[all.length - 1]!.ts : null;
  const cycleAt = lastCycleAt ?? last;
  const nextCycleAt = cycleAt
    ? new Date(new Date(cycleAt).getTime() + CONFIG.intervalMinutes * 60_000).toISOString()
    : null;

  return {
    totalClaimedWethWei: claimedWeth.toString(),
    totalClaimedWethEth: formatEther(claimedWeth),
    totalForwardedKumoWei: kumoWei.toString(),
    totalForwardedKumoEth: formatEther(kumoWei),
    totalForwardedTreasuryWei: treasuryWei.toString(),
    totalForwardedTreasuryEth: formatEther(treasuryWei),
    totalTokenForwardedRaw: tokenRaw.toString(),
    claimCount,
    forwardCount,
    errorCount,
    dryRunEntryCount,
    lastEntryAt: last,
    lastCycleAt: cycleAt,
    nextCycleAt,
    intervalMinutes: CONFIG.intervalMinutes,
  };
}
