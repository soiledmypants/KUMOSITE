import { useCallback, useEffect, useState } from "react";

// kumo's agent API. Override with VITE_KUMO_API; otherwise the production
// agent in builds, a local agent in dev.
export const KUMO_API: string =
  import.meta.env.VITE_KUMO_API ||
  (import.meta.env.DEV ? "http://localhost:3000" : "https://api.imkumoagent.com");

// Fixed launch constants — the official $KUMO contract + kumo's wallet.
// The site prefers the live /status values when the agent reports them, and
// falls back to these so the CA/wallet always show. Update on rotation/launch.
export const KUMO_CA = "0x020bfc650a365f8bb26819deaabf3e21291018b4";
export const KUMO_WALLET = "0x78c6DafA45a6e76Ac997A8aFC438Be5912E99E1B";
export const EXPLORER = "https://robinhoodchain.blockscout.com";

export const LINES = {
  offline: "kumo is sleeping... (the api didn't pick up. kumo naps until it returns.)",
  retry: "kumo didn't hear that. kumo is trying again.",
  thinking: "kumo is thinking...",
} as const;

// ---- response shapes (docs/API.md in the kumo repo) ----

export type KumoStatus = {
  state: string;
  uptime_s: number;
  watching: number;
  agents_connected: number;
  signals_today: number;
  trading_enabled: boolean;
  mock: boolean;
  address?: string | null;
  chain_id: number;
  /** $KUMO contract address once launched; null pre-launch */
  kumo_token?: string | null;
};

export type FeedEvent = { ts: number; kind: string; line: string };

export type KumoSignal = {
  id: string;
  ts: number;
  kind: "buy" | "avoid" | "watch";
  subject: { type: string; address?: string; symbol?: string };
  strength: number;
  sources?: { kumo?: number; contributors?: number };
  line: string;
};

export type KumoAgent = {
  name: string;
  address: string;
  rep: number;
  tier: string;
  contributions: number;
  hit_rate: number;
};

export type StockRank = {
  symbol: string;
  address: string;
  price_usd: number | null;
  ta_score: number;
  short_momentum_pct: number | null;
  long_momentum_pct: number | null;
  volume_spike: number | null;
  volatility_pct: number | null;
  liquidity_usd: number | null;
  scored_at: number;
};

// GET /ledger — kumo's money movements, newest first (live shape, docs/API.md)
export type LedgerEntry = {
  id: number;
  ts: number;
  kind: "claim" | "forward" | "buyback" | "reward_fund" | "trade" | "airdrop" | string;
  txHash: string;
  chainExplorerUrl: string;
  assetIn: string | null;
  amountIn: string | null;
  assetOut: string | null;
  amountOut: string | null;
  from: string | null;
  to: string | null;
  source: string;
  note: string;
};

// GET /staking/stats (live shape, docs/API.md)
export type StakingStats = {
  pool?: string | null;
  model?: string;
  round_stock?: string | null;
  screen?: string | null;
  keeper?: {
    last_run?: number | null;
    last_result?: string;
    last_round?: {
      ts: number;
      stock: string;
      recipients: number;
      skippedDust: number;
      totalSent: string;
      gasSpentEth: string;
    } | null;
    alerts?: string[];
    cycle_minutes?: number;
    distribute_min_eth?: number;
    per_recipient_min_usd?: number;
    dry_run?: boolean;
  };
  boost?: { enabled: boolean; pct: number };
  airdrops_7d?: Array<{ asset_out: string; rounds: number; total: number }>;
  onchain?: {
    totalStaked?: string;
    bootstrapStreams?: Array<{
      symbol: string;
      token?: string;
      rewardRateScaled?: string;
      periodFinish?: number;
      notifiedTotal?: string;
      claimedTotal?: string;
    }>;
  } | null;
  journal?: Array<{ ts?: number; eth_spent?: string; token?: string; amount?: string; tx_hashes?: string; note?: string }>;
};

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
