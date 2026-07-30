// Panel-editable project settings, persisted on the data volume so they
// survive redeploys and always win over projects.json / env interpolation.
// This is what lets you swap the token CA / wallets at launch from the panel
// instead of editing Railway variables.
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dataPath } from "./config.js";

/** Fields the panel may override. Shapes mirror RawProject (strings in, validation in buildRuntime). */
export interface ProjectOverride {
  tokenAddress?: string;
  treasuryWallet?: string;
  kumoWallet?: string;
  treasuryPct?: number;
  keyRef?: string;
  claimEnabled?: boolean;
  claimMinEth?: string;
  claimIntervalMinutes?: number;
  holdersStartBlock?: string;
}

type OverridesFile = Record<string, ProjectOverride>;

function filePath(): string {
  return dataPath("project-overrides.json");
}

export function loadOverrides(): OverridesFile {
  if (!existsSync(filePath())) return {};
  try {
    return JSON.parse(readFileSync(filePath(), "utf8")) as OverridesFile;
  } catch {
    console.error(`[overrides] ${filePath()} is corrupt — ignoring it (fix or delete the file)`);
    return {};
  }
}

export function getOverride(projectId: string): ProjectOverride {
  return loadOverrides()[projectId] ?? {};
}

/** Merge + persist (atomic write). Returns the stored override for the project. */
export function saveOverride(projectId: string, patch: ProjectOverride): ProjectOverride {
  const all = loadOverrides();
  const next: ProjectOverride = { ...all[projectId], ...patch };
  // dropping a field entirely: callers pass undefined explicitly via delete-markers upstream;
  // here undefined values just vanish through JSON serialization.
  all[projectId] = next;
  const tmp = filePath() + ".tmp";
  writeFileSync(tmp, JSON.stringify(all, null, 2));
  renameSync(tmp, filePath());
  return next;
}
