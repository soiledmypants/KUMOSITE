import express from "express";
import cors from "cors";
import { CONFIG } from "./config.js";
import { botAddress } from "./clients.js";
import type { LockerContext } from "./locker.js";
import { readLog, computeStats } from "./txlog.js";

/** Start the express stats/journal server. */
export function startServer(ctx: LockerContext): void {
  const app = express();
  app.use(cors());

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/log", (req, res) => {
    const raw = req.query.limit;
    const parsed = typeof raw === "string" ? Number.parseInt(raw, 10) : NaN;
    const limit = Number.isFinite(parsed) && parsed > 0 ? parsed : 100;
    res.json(readLog(limit));
  });

  app.get("/stats", (_req, res) => {
    res.json({
      ...computeStats(),
      botAddress,
      chainId: CONFIG.chainId,
      dryRun: CONFIG.dryRun,
      tokenAddress: CONFIG.tokenAddress,
      locker: ctx.locker,
      lockerGeneration: ctx.generation,
      protocolFeeSharePct: ctx.protocolFeeSharePct.toString(),
      recipient: ctx.recipient,
      recipientOk: ctx.recipient.toLowerCase() === botAddress.toLowerCase(),
      treasuryWallet: CONFIG.treasuryWallet,
      kumoWallet: CONFIG.kumoWallet,
      treasuryPct: CONFIG.treasuryPct,
    });
  });

  app.listen(CONFIG.serverPort, () => {
    console.log(`[server] stats API listening on http://localhost:${CONFIG.serverPort}`);
    console.log(`[server]   GET /health   GET /log?limit=100   GET /stats`);
  });
}
