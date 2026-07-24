import { Router, type Request, type Response } from "express";
import { parseAbi } from "viem";
import { CONFIG } from "../config.js";
import { withRetry } from "../rpc.js";
import type { ProjectRuntime } from "../projects.js";
import { claimCycle, readClaimable, type LockerContext } from "../engine/claim.js";
import { getHolders, indexInfo, sync } from "../engine/holders.js";
import { executeRound, isBusy, planRound, type RoundSpec } from "../engine/rounds.js";
import * as journal from "../engine/journal.js";
import { importKey, listKeys } from "../keyvault.js";
import { handleLogin, handleLogout, requireAuth } from "./auth.js";

export interface ProjectState {
  p: ProjectRuntime;
  lockerCtx: LockerContext | null;
  /** Set when live claiming was disabled at boot (recipient mismatch etc.). */
  claimDisabledReason: string | null;
  claimBusy: boolean;
  tokenMeta?: { symbol: string; decimals: number };
}

export interface AppState {
  projects: Map<string, ProjectState>;
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
      })),
    });
  });

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
