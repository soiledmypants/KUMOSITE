// Master live/safe switch, controllable from the panel and persisted on the
// data volume so it survives redeploys. This is what "put it on mainnet" means
// operationally — the chain is always mainnet; this flag decides whether the
// app SIMULATES (safe / dry-run) or SENDS REAL TRANSACTIONS (live).
//
// Precedence: a value saved from the panel wins. If nothing has been saved,
// the DRY_RUN env var is the default (safe unless explicitly DRY_RUN=false).
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { CONFIG, dataPath } from "./config.js";

function filePath(): string {
  return dataPath("runtime-mode.json");
}

/** true = simulate only (safe); false = send real transactions (live). */
export function isDryRun(): boolean {
  try {
    if (existsSync(filePath())) {
      const saved = JSON.parse(readFileSync(filePath(), "utf8")) as { dryRun?: boolean };
      if (typeof saved.dryRun === "boolean") return saved.dryRun;
    }
  } catch {
    // corrupt/unreadable — fall back to the env default (safe)
  }
  return CONFIG.dryRun;
}

/** persist a panel-set mode. */
export function setDryRun(dryRun: boolean): void {
  const tmp = filePath() + ".tmp";
  writeFileSync(tmp, JSON.stringify({ dryRun }, null, 2));
  renameSync(tmp, filePath());
}
