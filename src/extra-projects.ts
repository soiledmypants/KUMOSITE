// Panel-created projects, persisted on the data volume alongside overrides.
// projects.json holds the "built-in" projects; this file holds ones added at
// runtime from the panel — the whole point of reusing this console for every
// future token, not just the first one.
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dataPath } from "./config.js";
import type { RawProject } from "./projects.js";

function filePath(): string {
  return dataPath("projects-extra.json");
}

export function loadExtraProjects(): RawProject[] {
  if (!existsSync(filePath())) return [];
  try {
    return JSON.parse(readFileSync(filePath(), "utf8")) as RawProject[];
  } catch {
    console.error(`[extra-projects] ${filePath()} is corrupt — ignoring it (fix or delete the file)`);
    return [];
  }
}

export function isExtraProject(id: string): boolean {
  return loadExtraProjects().some((p) => p.id === id);
}

export function saveExtraProject(raw: RawProject): void {
  const all = loadExtraProjects().filter((p) => p.id !== raw.id);
  all.push(raw);
  const tmp = filePath() + ".tmp";
  writeFileSync(tmp, JSON.stringify(all, null, 2));
  renameSync(tmp, filePath());
}

export function deleteExtraProject(id: string): boolean {
  const all = loadExtraProjects();
  const next = all.filter((p) => p.id !== id);
  if (next.length === all.length) return false;
  const tmp = filePath() + ".tmp";
  writeFileSync(tmp, JSON.stringify(next, null, 2));
  renameSync(tmp, filePath());
  return true;
}
