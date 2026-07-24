import { Router, type Request, type Response } from "express";
import { parseAbi } from "viem";
import { CONFIG, addr } from "../config.js";
import { withRetry } from "../rpc.js";
import { buildRuntime, rebuildProject, RHC_DEFAULTS, type ProjectRuntime, type RawProject } from "../projects.js";
import { getOverride, saveOverride, type ProjectOverride } from "../overrides.js";
import { deleteExtraProject, isExtraProject, saveExtraProject } from "../extra-projects.js";
import { claimCycle, readClaimable, resolveLockerContext, type LockerContext } from "../engine/claim.js";
import { getHolders, indexInfo, sync } from "../engine/holders.js";
import { executeRound, isBusy, planRound, type RoundSpec } from "../engine/rounds.js";
import * as journal from "../engine/journal.js";
import { emitEvent } from "../engine/events.js";
import { importKey, listKeys } from "../keyvault.js";
import { handleLogin, handleLogout, requireAuth } from "./auth.js";

export interface ProjectState {
  p: ProjectRuntime;
  lockerCtx: LockerContext | null;
  /** Set when live claiming was disabled at boot (recipient mismatch etc.). */
  claimDisabledReason: string | null;
  claimBusy: boolean;
  tokenMeta?: { symbol: string; decimals: number };
  /** ms epoch of the next scheduled auto claim cycle (null = scheduler off). */
  nextClaimAt?: number | null;
  claimTimer?: NodeJS.Timeout;
}

export interface AppState {
  projects: Map<string, ProjectState>;
}

/**
 * Resolve the locker + recipient sanity check for a project. Used at boot and
 * again whenever the panel changes the project's config. Sets lockerCtx and
 * claimDisabledReason on the ProjectState.
 */
export async function initProjectLocker(ps: ProjectState): Promise<void> {
  const { p } = ps;
  ps.lockerCtx = null;
  ps.claimDisabledReason = null;
  if (p.lockerMode === null) return;
  try {
    ps.lockerCtx = await resolveLockerContext(p);
    const recipientOk =
      ps.lockerCtx !== null && ps.lockerCtx.recipient.toLowerCase() === p.botAddress.toLowerCase();
    if (!recipientOk && ps.lockerCtx) {
      const msg =
        `fee recipient is ${ps.lockerCtx.recipient}, not the bot wallet ${p.botAddress}. ` +
        `Run with that wallet's key or setFeeRedirect(${p.tokenAddress}, ${p.botAddress}) ` +
        `on locker ${ps.lockerCtx.locker}.`;
      if (CONFIG.dryRun) {
        console.warn(`[locker] WARNING (${p.id}): ${msg}`);
      } else {
        ps.claimDisabledReason = msg;
        console.error(`[locker] LIVE CLAIM DISABLED (${p.id}): ${msg}`);
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ps.claimDisabledReason = message;
    console.error(`[locker] resolution failed (${p.id}): ${message} — claim disabled`);
  }
}

const ERC20_META_ABI = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);

/** JSON responder that survives bigints anywhere in the payload. */
function send(res: Response, payload: unknown, status = 200): void {
  res
    .status(status)
    .type("application/json")
    .send(JSON.stringify(payload, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
}

type AsyncHandler = (req: Request, res: Response) => Promise<void>;
const wrap =
  (fn: AsyncHandler) =>
  (req: Request, res: Response): void => {
    fn(req, res).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      const status = /already has a round|busy/i.test(message) ? 409 : 400;
      send(res, { error: message }, status);
    });
  };

function getProject(state: AppState, req: Request): ProjectState {
  const ps = state.projects.get(req.params.id ?? "");
  if (!ps) throw new Error(`unknown project "${req.params.id}"`);
  return ps;
}

async function tokenMeta(ps: ProjectState): Promise<{ symbol: string; decimals: number }> {
  if (ps.tokenMeta) return ps.tokenMeta;
  const { p } = ps;
  try {
    const [symbol, decimals] = await Promise.all([
      withRetry(
        () =>
          p.publicClient.readContract({
            address: p.tokenAddress,
            abi: ERC20_META_ABI,
            functionName: "symbol",
          }),
        `api:${p.id}.symbol`,
        { retries: 1 },
      ),
      withRetry(
        () =>
          p.publicClient.readContract({
            address: p.tokenAddress,
            abi: ERC20_META_ABI,
            functionName: "decimals",
          }),
        `api:${p.id}.decimals`,
        { retries: 1 },
      ),
    ]);
    ps.tokenMeta = { symbol, decimals: Number(decimals) };
  } catch {
    ps.tokenMeta = { symbol: "TOKEN", decimals: 18 };
  }
  return ps.tokenMeta;
}

/**
 * (Re)start a project's auto-claim loop. setTimeout chain (not setInterval) so
 * a panel-side interval change can reschedule cleanly, and so nextClaimAt is
 * always accurate for the dashboard countdown.
 */
export function scheduleClaimLoop(ps: ProjectState): void {
  if (ps.claimTimer) clearTimeout(ps.claimTimer);
  const intervalMs = ps.p.claim.intervalMinutes * 60_000;
  const tick = async (): Promise<void> => {
    ps.nextClaimAt = Date.now() + intervalMs;
    ps.claimTimer = setTimeout(() => void tick(), intervalMs);
    const { p } = ps; // current runtime — panel config changes apply next tick
    if (!p.claim.enabled || !ps.lockerCtx || ps.claimBusy) return;
    ps.claimBusy = true;
    try {
      // Master DRY_RUN governs scheduled cycles; claimDisabledReason blocks live sends.
      await claimCycle(p, ps.lockerCtx, { dryRun: CONFIG.dryRun || ps.claimDisabledReason !== null });
    } finally {
      ps.claimBusy = false;
    }
  };
  void tick();
}

/** keyRef for display: never expose env var names beyond the ref itself; vault refs are safe ids. */
function overrideSafeKeyRef(_projectId: string, override: ProjectOverride): string {
  return override.keyRef ?? "(from projects.json / env)";
}

/** Validate + normalize a panel config patch. Throws on anything malformed. */
function parseConfigPatch(body: Record<string, unknown>): ProjectOverride {
  const patch: ProjectOverride = {};
  if (body.tokenAddress !== undefined && String(body.tokenAddress).trim() !== "") {
    patch.tokenAddress = addr(String(body.tokenAddress));
  }
  if (body.treasuryWallet !== undefined && String(body.treasuryWallet).trim() !== "") {
    patch.treasuryWallet = addr(String(body.treasuryWallet));
  }
  if (body.kumoWallet !== undefined) {
    const v = String(body.kumoWallet).trim();
    patch.kumoWallet = v ? addr(v) : "";
  }
  if (body.treasuryPct !== undefined && String(body.treasuryPct).trim() !== "") {
    const n = Number(body.treasuryPct);
    if (!Number.isInteger(n) || n < 0 || n > 100) throw new Error("treasuryPct must be an integer 0-100");
    patch.treasuryPct = n;
  }
  if (body.keyRef !== undefined && String(body.keyRef).trim() !== "") {
    const v = String(body.keyRef).trim();
    if (!v.startsWith("env:") && !v.startsWith("vault:")) {
      throw new Error('keyRef must be "env:VAR" or "vault:<id>" (import keys on the Keys tab)');
    }
    patch.keyRef = v;
  }
  if (body.claimEnabled !== undefined) patch.claimEnabled = body.claimEnabled === true || body.claimEnabled === "true";
  if (body.claimMinEth !== undefined && String(body.claimMinEth).trim() !== "") {
    const v = String(body.claimMinEth).trim();
    if (!/^\d+(\.\d+)?$/.test(v)) throw new Error("claimMinEth must be a decimal ETH amount");
    patch.claimMinEth = v;
  }
  if (body.claimIntervalMinutes !== undefined && String(body.claimIntervalMinutes).trim() !== "") {
    const n = Number(body.claimIntervalMinutes);
    if (!Number.isInteger(n) || n < 1 || n > 1440) throw new Error("claimIntervalMinutes must be 1-1440");
    patch.claimIntervalMinutes = n;
  }
  if (body.holdersStartBlock !== undefined && String(body.holdersStartBlock).trim() !== "") {
    const v = String(body.holdersStartBlock).trim();
    if (!/^\d+$/.test(v)) throw new Error("holdersStartBlock must be a block number");
    patch.holdersStartBlock = v;
  }
  return patch;
}

export function apiRouter(state: AppState): Router {
  const router = Router();

  // ---- public within /api: login only --------------------------------------
  router.post("/login", handleLogin);

  // Everything below requires a session.
  router.use(requireAuth);
  router.post("/logout", handleLogout);
  router.get("/me", (_req, res) => send(res, { ok: true, dryRunMaster: CONFIG.dryRun }));

  // ---- projects -------------------------------------------------------------
  router.get("/projects", (_req, res) => {
    send(res, {
      dryRunMaster: CONFIG.dryRun,
      projects: [...state.projects.values()].map(({ p, lockerCtx, claimDisabledReason }) => ({
        id: p.id,
        name: p.name,
        chainId: p.chainId,
        explorerBase: p.explorerBase,
        tokenAddress: p.tokenAddress,
        botAddress: p.botAddress,
        treasuryWallet: p.treasuryWallet,
        kumoWallet: p.kumoWallet,
        treasuryPct: p.treasuryPct,
        claimEnabled: p.claim.enabled && !claimDisabledReason,
        claimDisabledReason,
        locker: lockerCtx?.locker ?? null,
        caps: p.caps,
        extra: isExtraProject(p.id),
      })),
    });
  });

  // ---- create / remove projects from the panel -------------------------------
  router.post(
    "/projects",
    wrap(async (req, res) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const id = String(b.id ?? "").trim().toLowerCase();
      if (!/^[a-z0-9-]{2,24}$/.test(id)) throw new Error("id must be 2-24 chars: a-z, 0-9, dashes");
      if (state.projects.has(id)) throw new Error(`project "${id}" already exists`);
      const keyRef = String(b.keyRef ?? "").trim();
      if (!keyRef.startsWith("env:") && !keyRef.startsWith("vault:")) {
        throw new Error('keyRef required — "vault:<id>" (import on this page) or "env:VAR"');
      }
      const raw: RawProject = {
        id,
        name: String(b.name ?? id).trim() || id,
        chainId: RHC_DEFAULTS.chainId,
        rpcUrl: RHC_DEFAULTS.rpcUrl,
        explorerBase: RHC_DEFAULTS.explorerBase,
        tokenAddress: addr(String(b.tokenAddress ?? "")),
        weth: RHC_DEFAULTS.weth,
        locker: "auto",
        treasuryWallet: addr(String(b.treasuryWallet ?? "")),
        kumoWallet: String(b.kumoWallet ?? "").trim() ? addr(String(b.kumoWallet)) : undefined,
        treasuryPct: b.treasuryPct !== undefined && String(b.treasuryPct).trim() !== "" ? Number(b.treasuryPct) : 100,
        keyRef,
        claim: { enabled: true, intervalMinutes: 10, claimMinEth: "0.01" },
        holders: {
          startBlock: /^\d+$/.test(String(b.holdersStartBlock ?? "").trim()) ? String(b.holdersStartBlock).trim() : "0",
          scanChunkBlocks: "10000",
        },
        swap: { feeTier: 10000, slippagePct: 3 },
      };

      const p = buildRuntime(raw); // validates everything (addresses, pct, key resolution)
      saveExtraProject(raw);
      const ps: ProjectState = { p, lockerCtx: null, claimDisabledReason: null, claimBusy: false };
      state.projects.set(id, ps);
      await initProjectLocker(ps);
      scheduleClaimLoop(ps);

      journal.append({ type: "config", dryRun: false, projectId: id, token: p.tokenAddress, detail: `project "${id}" created via panel` });
      emitEvent("config", { created: id, tokenAddress: p.tokenAddress }, id);
      send(res, { ok: true, id, botAddress: p.botAddress, claimDisabledReason: ps.claimDisabledReason });
    }),
  );

  router.delete(
    "/projects/:id",
    wrap(async (req, res) => {
      const ps = getProject(state, req);
      const id = ps.p.id;
      if (!isExtraProject(id)) throw new Error(`"${id}" comes from projects.json — remove it there, not from the panel`);
      if (ps.claimBusy || isBusy(id)) throw new Error("busy: a claim cycle or round is running — try again in a moment");
      if (ps.claimTimer) clearTimeout(ps.claimTimer);
      deleteExtraProject(id);
      state.projects.delete(id);
      journal.append({ type: "config", dryRun: false, projectId: id, detail: `project "${id}" removed via panel` });
      emitEvent("config", { removed: id }, id);
      send(res, { ok: true, removed: id });
    }),
  );

  // ---- runtime-editable config (persisted on the data volume) ---------------
  router.get("/projects/:id/config", (req, res) => {
    const ps = getProject(state, req);
    const { p } = ps;
    const override = getOverride(p.id);
    send(res, {
      effective: {
        tokenAddress: p.tokenAddress,
        treasuryWallet: p.treasuryWallet,
        kumoWallet: p.kumoWallet,
        treasuryPct: p.treasuryPct,
        keyRef: overrideSafeKeyRef(p.id, override),
        botAddress: p.botAddress,
        claimEnabled: p.claim.enabled,
        claimMinEth: (Number(p.claim.claimMinWei) / 1e18).toString(),
        claimIntervalMinutes: p.claim.intervalMinutes,
        holdersStartBlock: p.holders.startBlock.toString(),
      },
      overridden: Object.keys(override),
      note: "changes apply immediately and persist on the volume — they always win over Railway env vars / projects.json",
    });
  });

  router.post(
    "/projects/:id/config",
    wrap(async (req, res) => {
      const ps = getProject(state, req);
      if (ps.claimBusy || isBusy(ps.p.id)) {
        throw new Error("busy: a claim cycle or round is running — try again in a moment");
      }
      const patch = parseConfigPatch(req.body ?? {});
      if (Object.keys(patch).length === 0) throw new Error("nothing to change");

      // Validate the FULL merged config first — only persist + swap on success.
      const candidate = { ...getOverride(ps.p.id), ...patch };
      const newP = rebuildProject(ps.p.id, candidate);

      saveOverride(ps.p.id, patch);
      const oldToken = ps.p.tokenAddress;
      const oldInterval = ps.p.claim.intervalMinutes;
      ps.p = newP;
      ps.tokenMeta = undefined;
      await initProjectLocker(ps);
      if (newP.claim.intervalMinutes !== oldInterval) scheduleClaimLoop(ps);

      const changed = Object.keys(patch).join(", ");
      journal.append({
        type: "config",
        dryRun: false,
        projectId: newP.id,
        token: newP.tokenAddress,
        detail: `config changed via panel: ${changed}`,
      });
      emitEvent("config", { changed, tokenAddress: newP.tokenAddress }, newP.id);
      if (oldToken.toLowerCase() !== newP.tokenAddress.toLowerCase()) {
        console.log(`[config:${newP.id}] token switched ${oldToken} -> ${newP.tokenAddress} (fresh holder index)`);
      }

      send(res, {
        ok: true,
        applied: patch,
        botAddress: newP.botAddress,
        locker: ps.lockerCtx?.locker ?? null,
        claimDisabledReason: ps.claimDisabledReason,
      });
    }),
  );

  router.get(
    "/projects/:id/status",
    wrap(async (req, res) => {
      const ps = getProject(state, req);
      const { p, lockerCtx } = ps;
      const meta = await tokenMeta(ps);

      const [ethBal, wethBal, tokenBal] = await Promise.all([
        p.publicClient.getBalance({ address: p.botAddress }),
        p.publicClient.readContract({
          address: p.weth,
          abi: ERC20_META_ABI,
          functionName: "balanceOf",
          args: [p.botAddress],
        }),
        p.publicClient.readContract({
          address: p.tokenAddress,
          abi: ERC20_META_ABI,
          functionName: "balanceOf",
          args: [p.botAddress],
        }),
      ]);

      let claimable: unknown = null;
      let recipient: string | null = null;
      if (lockerCtx) {
        try {
          // Status reads always simulate as the on-chain recipient (works with any key).
          const c = await readClaimable(p, lockerCtx, true);
          claimable = c;
          recipient = lockerCtx.recipient;
        } catch (err) {
          claimable = { error: err instanceof Error ? err.message : String(err) };
        }
      }

      send(res, {
        projectId: p.id,
        botAddress: p.botAddress,
        balances: { eth: ethBal, weth: wethBal, token: tokenBal },
        tokenMeta: meta,
        claimable,
        recipient,
        recipientOk: recipient ? recipient.toLowerCase() === p.botAddress.toLowerCase() : null,
        locker: lockerCtx?.locker ?? null,
        lockerGeneration: lockerCtx?.generation ?? null,
        protocolFeeSharePct: lockerCtx?.protocolFeeSharePct ?? null,
        claimDisabledReason: ps.claimDisabledReason,
        claimBusy: ps.claimBusy,
        roundBusy: isBusy(p.id),
        nextClaimAt: ps.nextClaimAt ?? null,
        claimIntervalMinutes: p.claim.intervalMinutes,
        index: indexInfo(p),
        stats: journal.computeStats(p.id),
        dryRunMaster: CONFIG.dryRun,
        allowlist: p.sender.allowedTargets(),
      });
    }),
  );

  // ---- actions ---------------------------------------------------------------
  router.post(
    "/projects/:id/claim",
    wrap(async (req, res) => {
      const ps = getProject(state, req);
      if (ps.claimBusy) throw new Error(`project "${ps.p.id}" claim cycle already running (busy)`);
      const dryRun = req.body?.dryRun !== false; // default dry — live requires explicit false
      if (!dryRun && ps.claimDisabledReason) {
        throw new Error(`live claim disabled: ${ps.claimDisabledReason}`);
      }
      ps.claimBusy = true;
      try {
        const entries = await claimCycle(ps.p, ps.lockerCtx, { dryRun });
        send(res, { dryRun: CONFIG.dryRun || dryRun, entries });
      } finally {
        ps.claimBusy = false;
      }
    }),
  );

  router.post(
    "/projects/:id/snapshot",
    wrap(async (req, res) => {
      const ps = getProject(state, req);
      const scan = await sync(ps.p);
      const holders = await getHolders(ps.p, {
        minBalance: req.body?.minBalance ? BigInt(String(req.body.minBalance)) : undefined,
        topN: req.body?.topN ? Number(req.body.topN) : undefined,
      });
      send(res, { scan, holderCount: holders.length, holders });
    }),
  );

  router.get(
    "/projects/:id/holders",
    wrap(async (req, res) => {
      const ps = getProject(state, req);
      const holders = await getHolders(ps.p, {
        minBalance: req.query.minBalance ? BigInt(String(req.query.minBalance)) : undefined,
        topN: req.query.topN ? Number(req.query.topN) : undefined,
      });
      send(res, { holderCount: holders.length, holders, index: indexInfo(ps.p) });
    }),
  );

  router.post(
    "/projects/:id/rounds/plan",
    wrap(async (req, res) => {
      const ps = getProject(state, req);
      const plan = await planRound(ps.p, req.body as RoundSpec);
      send(res, plan);
    }),
  );

  router.post(
    "/rounds/:planId/execute",
    wrap(async (req, res) => {
      const result = await executeRound(req.params.planId ?? "");
      send(res, result);
    }),
  );

  router.get("/projects/:id/rounds", (req, res) => {
    const ps = getProject(state, req);
    send(res, { rounds: journal.readRounds(ps.p.id) });
  });

  // ---- journal / stats --------------------------------------------------------
  router.get("/journal", (req, res) => {
    const limit = req.query.limit ? Number(req.query.limit) : 100;
    const projectId = req.query.project ? String(req.query.project) : undefined;
    send(res, journal.readLog(limit, projectId));
  });

  router.get("/stats", (req, res) => {
    const projectId = req.query.project ? String(req.query.project) : undefined;
    send(res, journal.computeStats(projectId));
  });

  // ---- key vault ---------------------------------------------------------------
  router.get("/keys", (_req, res) => send(res, { keys: listKeys() }));

  router.post(
    "/keys",
    wrap(async (req, res) => {
      const name = typeof req.body?.name === "string" ? req.body.name : "";
      const privateKey = typeof req.body?.privateKey === "string" ? req.body.privateKey : "";
      if (!privateKey) throw new Error("privateKey required");
      // NOTE: the key is intentionally never logged or echoed; response is id+address only.
      const result = importKey(name, privateKey);
      send(res, result);
    }),
  );

  return router;
}
