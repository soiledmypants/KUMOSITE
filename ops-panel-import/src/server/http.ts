import { createServer, type Server } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { CONFIG } from "../config.js";
import * as journal from "../engine/journal.js";
import { apiRouter, type AppState } from "./api.js";
import { attachWs } from "./ws.js";

const PANEL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "panel");

/** Express app + static panel + REST API + ws hub on one shared HTTP server. */
export function startServer(state: AppState): Server {
  const app = express();
  app.set("trust proxy", 1); // Railway/reverse-proxy: req.ip + req.secure work
  app.disable("x-powered-by");
  app.use(express.json({ limit: "256kb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  if (CONFIG.publicStats) {
    app.get("/stats", (_req, res) => {
      res.json(journal.computeStats());
    });
  }

  app.use("/api", apiRouter(state));
  app.use(express.static(PANEL_DIR));

  const server = createServer(app);
  attachWs(server);

  server.listen(CONFIG.port, () => {
    console.log(`[server] ops panel on http://localhost:${CONFIG.port}`);
    console.log(`[server]   panel /   api /api/*   ws /ws   health /health`);
  });
  return server;
}
