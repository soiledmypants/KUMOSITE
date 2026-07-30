import { useCallback, useEffect, useState } from "react";

// kumo's agent API. Override with VITE_KUMO_API; otherwise the production
// agent in builds, a local agent in dev.
export const KUMO_API: string =
  import.meta.env.VITE_KUMO_API ||
  (import.meta.env.DEV ? "http://localhost:3000" : "https://api.imkumoagent.com");

export const LINES = {
  offline: "kumo is sleeping... (the api didn't pick up. kumo naps until it returns.)",
  retry: "kumo didn't hear that. kumo is trying again.",
  thinking: "kumo is thinking...",
} as const;

// ---- response shapes: the single copy lives in @kumo/shared (packages/shared),
// re-exported here so existing `@/lib/kumo-api` imports keep working.
export type {
  KumoStatus,
  FeedEvent,
  KumoSignal,
  KumoAgent,
  StockRank,
  LedgerEntry,
  LedgerKind,
  StakingStats,
  RoundPlan,
} from "@kumo/shared";
import type { FeedEvent } from "@kumo/shared";

// ---- shared client ----

export class KumoApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function kumoFetch<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const { timeoutMs = 8000, ...rest } = init ?? {};
  let res: Response;
  try {
    res = await fetch(`${KUMO_API}${path}`, {
      ...rest,
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        ...(rest.body ? { "content-type": "application/json" } : {}),
        ...(rest.headers ?? {}),
      },
    });
  } catch {
    throw new Error(LINES.offline);
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // non-json body; fall through to status check
  }
  if (!res.ok) {
    const line = (body as { line?: string } | null)?.line;
    throw new KumoApiError(line || LINES.retry, res.status);
  }
  return body as T;
}

// Client-side polling fetch. Never runs during prerender (useEffect), so the
// static HTML ships the loading state and hydrates into live data.
export function useKumo<T>(path: string, opts?: { refreshMs?: number }) {
  const refreshMs = opts?.refreshMs;
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [nonce, setNonce] = useState(0);
  const refetch = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function tick() {
      try {
        const d = await kumoFetch<T>(path);
        if (!alive) return;
        setData(d);
        setError(null);
        setErrorStatus(null);
      } catch (e) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : LINES.retry);
        setErrorStatus(e instanceof KumoApiError ? e.status : null);
      } finally {
        if (alive && refreshMs) timer = setTimeout(tick, refreshMs);
      }
    }
    tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [path, refreshMs, nonce]);

  return { data, error, errorStatus, loading: data === null && error === null, refetch };
}

// Live SSE feed. `live` is null while connecting, then true/false; EventSource
// reconnects on its own after errors.
export function useKumoFeed(limit = 10, max = 30) {
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [live, setLive] = useState<boolean | null>(null);

  useEffect(() => {
    const es = new EventSource(`${KUMO_API}/feed?limit=${limit}`);
    es.onopen = () => setLive(true);
    es.onerror = () => setLive(false);
    es.onmessage = (ev) => {
      try {
        const e = JSON.parse(ev.data) as FeedEvent;
        if (!e?.line) return;
        setLive(true);
        setEvents((xs) => [...xs, e].slice(-max));
      } catch {
        // not json — ignore
      }
    };
    return () => es.close();
  }, [limit, max]);

  return { events, live };
}
