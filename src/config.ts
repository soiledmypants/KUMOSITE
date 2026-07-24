import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { getAddress, parseGwei } from "viem";

/** Normalise any hex string to a checksummed 0x-address (validates length/hex). */
export function addr(value: string): `0x${string}` {
  return getAddress(value.trim());
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const DEAD_ADDRESS = "0x000000000000000000000000000000000000dead";

/**
 * GLOBAL config only — everything project-specific lives in projects.json
 * (resolved by projects.ts). Secrets stay in env.
 */
export const CONFIG = {
  // HTTP server (Railway injects PORT).
  port: Number(process.env.PORT ?? "8787"),

  // MASTER dry-run switch: when true, every action is dry regardless of any
  // per-action flag from the panel. Defaults ON.
  dryRun: (process.env.DRY_RUN ?? "true").toLowerCase() !== "false",

  // Where journal.jsonl, holders-*.db and keys.json live. On Railway set
  // DATA_DIR=/data and mount a volume there.
  dataDir: process.env.DATA_DIR ?? "data",

  // Panel auth. The server refuses to boot without ADMIN_PASSWORD.
  adminPassword: process.env.ADMIN_PASSWORD ?? "",
  sessionTtlHours: Number(process.env.SESSION_TTL_HOURS ?? "24"),

  // Key vault secret (AES-256-GCM). Required only when a project uses
  // keyRef "vault:<id>" or a key is imported through the panel.
  keySecret: process.env.KEY_SECRET ?? "",

  // Re-expose read-only /api/stats without auth (off by default).
  publicStats: (process.env.PUBLIC_STATS ?? "false").toLowerCase() === "true",

  // Gas policy (applies to every project).
  gas: {
    maxFeePerGasGwei: Number(process.env.MAX_FEE_GWEI ?? "50"),
    maxPriorityFeePerGasGwei: Number(process.env.MAX_PRIORITY_GWEI ?? "2"),
    gasBumpPct: Number(process.env.GAS_BUMP_PCT ?? "25"),
    txWaitMs: Number(process.env.TX_WAIT_MS ?? "90000"),
  },
} as const;

/** Absolute path inside the data dir (created on demand). */
export function dataPath(...segments: string[]): string {
  const dir = resolve(process.cwd(), CONFIG.dataDir);
  mkdirSync(dir, { recursive: true });
  return resolve(dir, ...segments);
}

/** EIP-1559 gas caps derived from config, as wei bigints. */
export function baseGasCaps(): { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint } {
  return {
    maxFeePerGas: parseGwei(String(CONFIG.gas.maxFeePerGasGwei)),
    maxPriorityFeePerGas: parseGwei(String(CONFIG.gas.maxPriorityFeePerGasGwei)),
  };
}

/** Bump both gas caps by `pct` percent (used to un-stick a pending tx). */
export function bumpGasCaps(
  caps: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint },
  pct: number,
): { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint } {
  const factor = BigInt(100 + Math.round(pct));
  return {
    maxFeePerGas: (caps.maxFeePerGas * factor) / 100n,
    maxPriorityFeePerGas: (caps.maxPriorityFeePerGas * factor) / 100n,
  };
}

export { ZERO_ADDRESS, DEAD_ADDRESS };
