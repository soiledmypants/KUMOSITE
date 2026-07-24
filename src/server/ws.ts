import type { Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { onEvent } from "../engine/events.js";
import { isAuthedRequest } from "./auth.js";

/**
 * WebSocket live-feed hub — the reusable server half of the pattern
 * (panel/ws.js is the client half; both are written to be copy-pasted into
 * future projects).
 *
 * Design:
 * - One WebSocketServer in noServer mode, attached to the existing HTTP
 *   server's `upgrade` event — no second port, works behind any proxy.
 * - Auth happens AT THE HANDSHAKE (session cookie), so an unauthenticated
 *   socket never even upgrades.
 * - Every frame is one JSON object: { type, ts, projectId?, data }.
 * - Liveness: server pings every 30s; a client that misses a ping is
 *   terminated. The client side mirrors this with its own idle timeout.
 */
export function attachWs(server: Server, path = "/ws"): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== path) {
      socket.destroy();
      return;
    }
    if (!isAuthedRequest(req)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  // Liveness sweep: mark dead on missed pong, ping the rest. The JSON "hb"
  // frame exists for the CLIENT's benefit — browsers answer protocol pings
  // transparently, so a data frame is the only way panel/ws.js can detect a
  // dead connection on its side.
  const alive = new WeakSet<WebSocket>();
  const interval = setInterval(() => {
    const hb = JSON.stringify({ type: "hb", ts: new Date().toISOString(), data: null });
    for (const client of wss.clients) {
      if (!alive.has(client)) {
        client.terminate();
        continue;
      }
      alive.delete(client);
      client.ping();
      if (client.readyState === WebSocket.OPEN) client.send(hb);
    }
  }, 30_000);
  wss.on("close", () => clearInterval(interval));

  wss.on("connection", (ws) => {
    alive.add(ws);
    ws.on("pong", () => alive.add(ws));
    ws.send(JSON.stringify({ type: "hello", ts: new Date().toISOString(), data: { ok: true } }));
  });

  // Single bus subscription fans out to every connected client.
  onEvent((event) => {
    const frame = JSON.stringify(event);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(frame);
    }
  });
}
