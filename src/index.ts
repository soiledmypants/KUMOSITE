import "dotenv/config";
import { CONFIG } from "./config.js";
import { loadProjects } from "./projects.js";
import { claimCycle, resolveLockerContext } from "./engine/claim.js";
import { startServer } from "./server/http.js";
import type { AppState, ProjectState } from "./server/api.js";

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

    if (p.lockerMode !== null) {
      try {
        ps.lockerCtx = await resolveLockerContext(p);
        const recipientOk =
          ps.lockerCtx !== null &&
          ps.lockerCtx.recipient.toLowerCase() === p.botAddress.toLowerCase();
        if (!recipientOk && ps.lockerCtx) {
          const msg =
            `fee recipient is ${ps.lockerCtx.recipient}, not the bot wallet ${p.botAddress}. ` +
            `Run with that wallet's key or setFeeRedirect(${p.tokenAddress}, ${p.botAddress}) ` +
            `on locker ${ps.lockerCtx.locker}.`;
          if (CONFIG.dryRun) {
            console.warn(`[boot] WARNING (${p.id}): ${msg}`);
          } else {
            // Unlike phase 1 we keep the panel up (other projects/tabs still work),
            // but live claiming for THIS project is disabled until fixed.
            ps.claimDisabledReason = msg;
            console.error(`[boot] LIVE CLAIM DISABLED (${p.id}): ${msg}`);
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        ps.claimDisabledReason = message;
        console.error(`[boot] locker resolution failed (${p.id}): ${message} — claim disabled`);
      }
    }
  }

  startServer(state);

  // Claim schedulers (rounds are manual-only from the panel).
  for (const ps of state.projects.values()) {
    const { p } = ps;
    if (!p.claim.enabled || !ps.lockerCtx) continue;
    const run = async (): Promise<void> => {
      if (ps.claimBusy) return;
      ps.claimBusy = true;
      try {
        // Master DRY_RUN governs scheduled cycles; claimDisabledReason blocks live sends.
        await claimCycle(p, ps.lockerCtx, { dryRun: CONFIG.dryRun || ps.claimDisabledReason !== null });
      } finally {
        ps.claimBusy = false;
      }
    };
    console.log(`[boot] claim scheduler for "${p.id}": every ${p.claim.intervalMinutes} min`);
    void run();
    setInterval(() => void run(), p.claim.intervalMinutes * 60_000);
  }
}

main().catch((err) => {
  console.error(`[boot] fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
