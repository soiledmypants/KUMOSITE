// kumo's http surface. CORS-open reads for the lovable frontend, admin-key writes,
// bearer-token agent routes. every error reply carries a kumo-voiced line.
import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import { getAddress, type Address } from "viem";
import { CONFIG } from "./config.js";
import { botAddress } from "./clients.js";
import { attachSseClient } from "./feed.js";
import { addWallet, removeWallet, walletCount, walletViews } from "./scanner/wallets.js";
import { stocksView } from "./scanner/stocks.js";
import { rankingFromDb } from "./scanner/ta.js";
import { activeSignals, signalsToday } from "./scanner/signals.js";
import { bestQuote, resolveToken } from "./trade/quote.js";
import { executeEthSwap } from "./trade/execute.js";
import { chat } from "./chat.js";
import { agentCard } from "./agents/card.js";
import { handleEnvelope } from "./agents/inbox.js";
import { authenticateBearer, checkDailyLimit } from "./agents/auth.js";
import { agentLeaderboard, submitIntel, type IntelInput } from "./agents/reputation.js";
import { connectToAgent } from "./agents/outbound.js";
import { registerOnChain } from "./agents/erc8004.js";
import { stakingStats } from "./staking/keeper.js";
import { db } from "./db.js";
import * as mock from "./mock.js";
import { formatEther, parseEther } from "viem";

const t0 = Date.now();

function adminOnly(req: Request, res: Response, next: NextFunction): void {
  if (!CONFIG.adminKey) {
    res.status(503).json({ error: "no admin key configured", line: "kumo has no admin key set, so this door stays closed." });
    return;
  }
  if (req.header("x-kumo-admin-key") !== CONFIG.adminKey) {
    res.status(401).json({ error: "unauthorized", line: "kumo doesn't recognize you. (bad admin key)" });
    return;
  }
  next();
}

function wrap(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response) => {
    fn(req, res).catch((err: Error) => {
      res.status(400).json({ error: err.message, line: `kumo bonked its head on something. (${err.message.slice(0, 80)})` });
    });
  };
}

export function buildServer(): express.Express {
  const app = express();
  app.use(express.json({ limit: "64kb" }));
  app.use(
    cors({
      origin: CONFIG.corsOrigins.includes("*") ? true : CONFIG.corsOrigins,
      allowedHeaders: ["Content-Type", "Authorization", "X-Kumo-Admin-Key"],
    }),
  );

  app.get("/status", wrap(async (_req, res) => {
    if (CONFIG.mock) {
      res.json(mock.mockStatus());
      return;
    }
    res.json({
      state: "awake",
      uptime_s: Math.floor((Date.now() - t0) / 1000),
      watching: await walletCount(),
      agents_connected: Number((await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM agents"))?.n ?? 0),
      signals_today: await signalsToday(),
      trading_enabled: CONFIG.tradingEnabled,
      mock: false,
      address: botAddress,
      chain_id: CONFIG.chainId,
    });
  }));

  app.get("/feed", (req, res) => {
    const limit = Number(req.query.limit ?? 30);
    attachSseClient(res, Number.isFinite(limit) ? limit : 30);
  });

  app.post("/watch", adminOnly, wrap(async (req, res) => {
    if (CONFIG.mock) {
      res.json({ ok: true, line: "kumo is watching a new wallet... (mock)" });
      return;
    }
    const address = getAddress(String(req.body.address ?? ""));
    const existing = await db.get("SELECT address FROM wallets WHERE address = ?", [address.toLowerCase()]);
    if (existing) {
      res.json({ ok: true, line: "kumo was already watching that one." });
      return;
    }
    const row = await addWallet(address, req.body.label);
    res.json({ ok: true, wallet: row, line: `kumo is watching a new wallet... hello, ${row.label}.` });
  }));

  app.delete("/watch/:address", adminOnly, wrap(async (req, res) => {
    if (CONFIG.mock) {
      res.json({ ok: true });
      return;
    }
    const ok = await removeWallet(req.params.address);
    res.json({ ok, line: ok ? "kumo waved goodbye." : "kumo wasn't watching that one." });
  }));

  app.get("/wallets", wrap(async (_req, res) => {
    res.json(CONFIG.mock ? mock.mockWallets() : await walletViews());
  }));

  app.get("/stocks", wrap(async (_req, res) => {
    res.json(CONFIG.mock ? mock.mockStocks() : await stocksView());
  }));

  app.get("/stocks/ranking", wrap(async (_req, res) => {
    if (CONFIG.mock) {
      res.json(mock.mockRanking());
      return;
    }
    res.json(await rankingFromDb());
  }));

  app.get("/signals", wrap(async (req, res) => {
    if (CONFIG.mock) {
      res.json(mock.mockSignals());
      return;
    }
    const agent = await authenticateBearer(req.header("authorization"));
    const early = agent !== null && (agent.tier === "trusted" || agent.tier === "inner-circle");
    const rows = await activeSignals(early);
    res.json(
      rows.map((s) => ({
        id: s.id,
        ts: Number(s.ts),
        kind: s.kind,
        subject: { type: s.subject_type, address: s.subject, symbol: s.symbol },
        strength: s.strength,
        sources: { kumo: s.kumo_score, contributors: Number(s.contributors) },
        line: s.line,
      })),
    );
  }));

  app.post("/trade/quote", wrap(async (req, res) => {
    const { tokenIn, tokenOut, amountIn } = req.body as { tokenIn?: string; tokenOut?: string; amountIn?: string | number };
    if (!tokenIn || !tokenOut || !amountIn) throw new Error("need tokenIn, tokenOut, amountIn");
    if (CONFIG.mock) {
      res.json(mock.mockQuote(tokenIn, tokenOut, String(amountIn)));
      return;
    }
    const inAddr = resolveToken(tokenIn);
    const outAddr = resolveToken(tokenOut);
    const amount = parseEther(String(amountIn));
    const q = await bestQuote(inAddr, outAddr, amount);
    if (!q) throw new Error("no route found");
    res.json({
      route: q.route,
      tokenIn: inAddr,
      tokenOut: outAddr,
      amountIn: String(amountIn),
      amountOut: formatEther(q.amountOut),
      minOut: formatEther(q.minOut),
      impact_pct: Math.round(q.impactPct * 100) / 100,
      line: `kumo priced it out: ${q.route}, impact ${q.impactPct.toFixed(2)}%.`,
    });
  }));

  app.post("/trade/execute", adminOnly, wrap(async (req, res) => {
    if (CONFIG.mock) {
      res.json({ tx: "0xmock", line: "kumo pretended to trade. (mock mode)" });
      return;
    }
    const tokenOut = resolveToken(String(req.body.tokenOut ?? ""));
    const amountEth = Number(req.body.amountEth ?? req.body.amountIn);
    if (!botAddress) throw new Error("no wallet configured");
    const result = await executeEthSwap({
      tokenOut,
      amountEth,
      recipient: botAddress,
      maxSlippagePct: req.body.maxSlippagePct !== undefined ? Number(req.body.maxSlippagePct) : undefined,
    });
    res.json({ ...result, line: "kumo made a trade." });
  }));

  app.post("/chat", wrap(async (req, res) => {
    const message = String(req.body.message ?? "");
    if (!message) throw new Error("say something to kumo");
    const reply = CONFIG.mock
      ? "kumo is in mock mode, dreaming of real markets. everything you see is a rehearsal."
      : await chat(message);
    res.json({ reply });
  }));

  const serveCard = wrap(async (_req: Request, res: Response) => {
    res.json(await agentCard());
  });
  app.get("/agent/manifest", serveCard);
  app.get("/.well-known/agent-card.json", serveCard);

  app.post("/agent/inbox", wrap(async (req, res) => {
    const agent = await authenticateBearer(req.header("authorization"));
    if (req.body?.intent === "intel" && agent && !checkDailyLimit(agent.address, CONFIG.intelDailyLimit)) {
      res.status(429).json({ error: "daily intel limit reached", line: "kumo's ears are full for today. tell me tomorrow." });
      return;
    }
    const reply = await handleEnvelope(req.body ?? {}, agent);
    res.status(reply.error ? 400 : 200).json(reply);
  }));

  app.post("/intel", wrap(async (req, res) => {
    if (CONFIG.mock) {
      res.json({ accepted: true, current_rep: 0.35, line: "kumo is thinking about what you said... (mock)" });
      return;
    }
    const agent = await authenticateBearer(req.header("authorization"));
    if (!agent) {
      res.status(401).json({ error: "bearer token required — hello handshake first", line: "kumo doesn't know you yet. say hello at /agent/inbox." });
      return;
    }
    if (!checkDailyLimit(agent.address, CONFIG.intelDailyLimit)) {
      res.status(429).json({ error: "daily intel limit reached", line: "kumo's ears are full for today." });
      return;
    }
    const result = await submitIntel(agent, req.body as IntelInput);
    res.json({ accepted: true, ...result, current_rep: agent.rep, line: "kumo is thinking about what you said..." });
  }));

  app.get("/agents", wrap(async (_req, res) => {
    res.json(CONFIG.mock ? mock.mockAgents() : await agentLeaderboard());
  }));

  app.get("/agents/:address", wrap(async (req, res) => {
    if (CONFIG.mock) {
      res.json({ ...mock.mockAgents()[0], recent_intel: [] });
      return;
    }
    const address = String(req.params.address).toLowerCase();
    const agent = await db.get("SELECT address, name, rep, n_scored, n_hit, tier, first_seen, last_seen FROM agents WHERE address = ?", [address]);
    if (!agent) throw new Error("kumo doesn't know that agent");
    const recent = await db.all(
      "SELECT kind, subject_type, subject, symbol, direction, confidence, created_at, scored_at, score FROM intel WHERE agent_address = ? ORDER BY id DESC LIMIT 20",
      [address],
    );
    res.json({ ...agent, recent_intel: recent });
  }));

  app.get("/staking/stats", wrap(async (_req, res) => {
    res.json(CONFIG.mock ? mock.mockStakingStats() : await stakingStats());
  }));

  // admin utilities used by the cli
  app.post("/admin/connect", adminOnly, wrap(async (req, res) => {
    const url = String(req.body.url ?? "");
    if (!url) throw new Error("need url");
    res.json(await connectToAgent(url));
  }));

  app.post("/admin/register-erc8004", adminOnly, wrap(async (_req, res) => {
    res.json(await registerOnChain());
  }));

  app.use((_req, res) => {
    res.status(404).json({ error: "not found", line: "kumo looked everywhere but couldn't find that." });
  });

  return app;
}
