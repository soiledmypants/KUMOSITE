// in-memory feed ring + SSE broadcaster. lines also persist to db (best-effort).
import type { Response } from "express";

export interface FeedEvent {
  ts: number;
  kind: string;
  line: string;
}

const RING_MAX = 500;
const ring: FeedEvent[] = [];
const clients = new Set<Response>();

// db hook is injected late to avoid a config/db import cycle at boot
let persist: ((ev: FeedEvent) => void) | null = null;
export function setFeedPersist(fn: (ev: FeedEvent) => void): void {
  persist = fn;
}

export function pushFeed(kind: string, line: string): void {
  const ev: FeedEvent = { ts: Date.now(), kind, line };
  ring.push(ev);
  if (ring.length > RING_MAX) ring.shift();
  try {
    persist?.(ev);
  } catch {
    // feed persistence is best-effort
  }
  const payload = `data: ${JSON.stringify(ev)}\n\n`;
  for (const res of clients) {
    try {
      res.write(payload);
    } catch {
      clients.delete(res);
    }
  }
}

export function feedBacklog(limit = 50): FeedEvent[] {
  return ring.slice(-Math.max(0, Math.min(limit, RING_MAX)));
}

export function attachSseClient(res: Response, backlog: number): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(":ok\n\n");
  for (const ev of feedBacklog(backlog)) {
    res.write(`data: ${JSON.stringify(ev)}\n\n`);
  }
  clients.add(res);
  res.on("close", () => clients.delete(res));
}

export function sseClientCount(): number {
  return clients.size;
}

// heartbeat comments keep proxies from closing idle streams
setInterval(() => {
  for (const res of clients) {
    try {
      res.write(":hb\n\n");
    } catch {
      clients.delete(res);
    }
  }
}, 25_000).unref();
