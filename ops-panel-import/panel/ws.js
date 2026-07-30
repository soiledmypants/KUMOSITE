/**
 * OpsSocket — reusable WebSocket live-feed client (pairs with server/ws.ts).
 *
 * The whole pattern in one file, copy-paste it into any project site:
 *
 *   import { createOpsSocket } from "./ws.js";
 *   const sock = createOpsSocket("/ws", { onStatus: (s) => console.log("ws:", s) });
 *   sock.on("journal", (evt) => render(evt));   // one event type
 *   sock.on("*", (evt) => feed(evt));           // everything
 *   sock.connect();
 *
 * Frames are JSON: { type, ts, projectId?, data }.
 * - Auto-reconnect: exponential backoff with jitter, capped at 30s.
 * - Liveness: the server sends a {type:"hb"} data frame every 30s; if nothing
 *   arrives for IDLE_TIMEOUT_MS the socket is torn down and reconnected
 *   (protocol pings are invisible to browser JS, hence the data heartbeat).
 * - Auth: rides the same session cookie as the page; a 401 handshake just
 *   looks like a failed connect and retries — log back in and it recovers.
 */
export function createOpsSocket(path, { onStatus } = {}) {
  const IDLE_TIMEOUT_MS = 75_000; // 2 missed heartbeats + slack
  const MAX_BACKOFF_MS = 30_000;

  const handlers = new Map(); // type -> Set<fn>, "*" = all frames
  let ws = null;
  let attempt = 0;
  let closedByUser = false;
  let idleTimer = null;

  const url =
    path.startsWith("ws://") || path.startsWith("wss://")
      ? path
      : `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}${path}`;

  function status(s) {
    if (onStatus) onStatus(s);
  }

  function resetIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      // Nothing (not even a heartbeat) for too long — force a reconnect.
      if (ws) ws.close();
    }, IDLE_TIMEOUT_MS);
  }

  function dispatch(evt) {
    for (const key of [evt.type, "*"]) {
      const set = handlers.get(key);
      if (set) for (const fn of set) fn(evt);
    }
  }

  function connect() {
    closedByUser = false;
    status(attempt === 0 ? "connecting" : `reconnecting (try ${attempt + 1})`);
    ws = new WebSocket(url);

    ws.onopen = () => {
      attempt = 0;
      status("online");
      resetIdle();
    };

    ws.onmessage = (msg) => {
      resetIdle();
      let evt;
      try {
        evt = JSON.parse(msg.data);
      } catch {
        return;
      }
      if (evt.type === "hb") return; // liveness only
      dispatch(evt);
    };

    ws.onclose = () => {
      clearTimeout(idleTimer);
      status("offline");
      if (closedByUser) return;
      // Full-jitter exponential backoff.
      const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt) * (0.5 + Math.random());
      attempt++;
      setTimeout(connect, delay);
    };

    ws.onerror = () => {
      // onclose always follows; nothing to do here.
    };
  }

  return {
    connect,
    on(type, fn) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type).add(fn);
      return () => handlers.get(type)?.delete(fn);
    },
    close() {
      closedByUser = true;
      clearTimeout(idleTimer);
      if (ws) ws.close();
    },
  };
}
