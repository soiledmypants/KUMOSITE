import "dotenv/config";
import { CONFIG } from "./config.js";
import { loadProjects } from "./projects.js";
import { startServer } from "./server/http.js";
import { initProjectLocker, scheduleClaimLoop, type AppState, type ProjectState } from "./server/api.js";
import { initAutodrop } from "./engine/autodrop.js";

async function main(): Promise<void> {
  console.log("[boot] ops-panel starting");
  console.log(`[boot] mode: ${CONFIG.dryRun ? "DRY RUN (master) — no txs will be sent" : "LIVE"}`);

  if (!CONFIG.adminPassword) {
    console.error("[boot] REFUSING TO START: ADMIN_PASSWORD env var is required (panel auth).");
    process.exit(1);
  }
  if (CONFIG.adminPassword.length < 8) {
    console.error("[boot] REFUSING TO START: ADMIN_PASSWORD must be at least 8 characters.");
    process.exit(1);
  }

  if (CONFIG.kumoApi && !CONFIG.kumoAdminKey) {
    console.warn("[boot] KUMO_API is set but KUMO_ADMIN_KEY is empty — ledger reporting disabled");
  } else if (CONFIG.kumoApi) {
    console.log(`[boot] kumo ledger reporting -> ${CONFIG.kumoApi}/ledger`);
  }

  const projects = loadProjects();
  const state: AppState = { projects: new Map() };

  for (const p of projects) {
    const ps: ProjectState = { p, lockerCtx: null, claimDisabledReason: null, claimBusy: false };
    state.projects.set(p.id, ps);
    console.log(`[boot] project "${p.id}" — token ${p.tokenAddress}, wallet ${p.botAddress}, chain ${p.chainId}`);
    await initProjectLocker(ps);
  }

  startServer(state);
  initAutodrop();

  // Claim schedulers (rounds are manual-only from the panel). Each loop reads
  // ps.p FRESH every tick — panel config changes (new token CA, wallets, key,
  // interval) apply without a redeploy.
  for (const ps of state.projects.values()) {
    console.log(`[boot] claim scheduler for "${ps.p.id}": every ${ps.p.claim.intervalMinutes} min`);
    scheduleClaimLoop(ps);
  }
}

main().catch((err) => {
  console.error(`[boot] fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
