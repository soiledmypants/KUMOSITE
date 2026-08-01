// SIMULATED scan engine for the "kumo thinking" panel. Everything here is fake
// — no price feeds, no chain reads, no trading. It produces believable, gently
// evolving scores so the panel looks alive. Replace this module with real
// scanner output later; the stock universe (stock-universe.ts) stays as-is.
import { useEffect, useRef, useState } from "react";
import {
  SUPPORTED_STOCKS,
  INITIAL_LEADER,
  type MockStockAnalysis,
  type StockStatus,
} from "./stock-universe";

// deterministic seed per symbol so first paint is stable (SSR/hydration safe)
function seed(symbol: string): number {
  let h = 0;
  for (let i = 0; i < symbol.length; i++) h = (h * 31 + symbol.charCodeAt(i)) >>> 0;
  return h;
}
const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

// starting seeds — MSFT leads, then the familiar mega-caps, then a spread.
const HEADLINERS: Record<string, number> = { MSFT: 87, NVDA: 82, META: 78, AMZN: 73, GOOGL: 69 };

function initial(): MockStockAnalysis[] {
  return SUPPORTED_STOCKS.map((s) => {
    const base = HEADLINERS[s.symbol] ?? 30 + (seed(s.symbol) % 42); // 30-71
    const jitter = (seed(s.symbol + "x") % 20) - 10;
    return {
      ...s,
      score: clamp(base),
      momentum: clamp(base + jitter),
      volume: clamp(40 + (seed(s.symbol + "v") % 55)),
      volatility: clamp(20 + (seed(s.symbol + "z") % 65)),
      liquidity: clamp(35 + (seed(s.symbol + "l") % 60)),
      status: "watching" as StockStatus,
    };
  }).sort((a, b) => b.score - a.score);
}

function statusFor(rank: number, score: number, delta: number): StockStatus {
  if (rank === 0) return "leading";
  if (score < 25) return "rejected";
  if (delta > 1.2) return "rising";
  if (delta < -1.2) return "cooling";
  return "watching";
}

const THOUGHTS = (rows: MockStockAnalysis[]): string[] => {
  const leader = rows[0];
  const second = rows[1];
  const rising = rows.find((r) => r.status === "rising");
  const cooling = rows.find((r) => r.status === "cooling");
  const pool = [
    `scanning ${SUPPORTED_STOCKS.length} tokenized stocks...`,
    `checking ${leader.symbol} liquidity...`,
    `${leader.symbol} momentum remains strong...`,
    `${second.symbol} pressing on ${leader.symbol} for first...`,
    rising ? `${rising.symbol} climbing the board...` : `re-scoring the board...`,
    cooling ? `${cooling.symbol} volatility increased...` : `volatility within range...`,
    `${leader.symbol} holds first place...`,
    `cross-checking volume against liquidity...`,
    `final pick has not been locked...`,
    `weighing ${second.symbol} vs ${leader.symbol}...`,
  ];
  return pool;
};

export type ScanState = {
  rows: MockStockAnalysis[];
  leader: MockStockAnalysis;
  confidence: number; // 0-100
  scanned: number;
  lastScanAt: number;
  nextRefreshInMs: number;
  thoughts: string[];
};

const REFRESH_MIN = 10_000;
const REFRESH_MAX = 20_000;

/** Drives the simulated scan. Client-only (starts after mount). */
export function useMockScan(): ScanState {
  const [rows, setRows] = useState<MockStockAnalysis[]>(initial);
  const [thoughts, setThoughts] = useState<string[]>([`scanning ${SUPPORTED_STOCKS.length} tokenized stocks...`]);
  const [lastScanAt, setLastScanAt] = useState<number>(() => Date.now());
  const [nextAt, setNextAt] = useState<number>(() => Date.now() + REFRESH_MIN);
  const [, force] = useState(0);
  const deltas = useRef<Record<string, number>>({});

  // one scan tick: nudge scores gently, re-rank, restatus, new thoughts
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      setRows((prev) => {
        const drifted = prev.map((r) => {
          // gentle drift; headliners pulled softly toward their anchor so the
          // top of the board stays believable rather than random
          const anchor = HEADLINERS[r.symbol];
          const pull = anchor != null ? (anchor - r.score) * 0.08 : 0;
          const noise = (Math.random() - 0.5) * 3.2;
          const score = clamp(r.score + pull + noise, 5, 96);
          deltas.current[r.symbol] = score - r.score;
          return {
            ...r,
            score,
            momentum: clamp(r.momentum + (Math.random() - 0.5) * 5),
            volume: clamp(r.volume + (Math.random() - 0.5) * 6),
            volatility: clamp(r.volatility + (Math.random() - 0.5) * 5),
            liquidity: clamp(r.liquidity + (Math.random() - 0.5) * 3),
          };
        });
        drifted.sort((a, b) => b.score - a.score);
        const next = drifted.map((r, i) => ({ ...r, status: statusFor(i, r.score, deltas.current[r.symbol] ?? 0) }));
        // derive the next thought line from the freshly-ranked board
        const pool = THOUGHTS(next);
        const line = pool[Math.floor(Math.random() * pool.length)];
        setThoughts((t) => [...t.slice(-40), line]);
        return next;
      });
      setLastScanAt(Date.now());
      const gap = REFRESH_MIN + Math.random() * (REFRESH_MAX - REFRESH_MIN);
      setNextAt(Date.now() + gap);
      timer = setTimeout(tick, gap);
    };
    const first = REFRESH_MIN + Math.random() * (REFRESH_MAX - REFRESH_MIN);
    setNextAt(Date.now() + first);
    timer = setTimeout(tick, first);
    return () => clearTimeout(timer);
  }, []);

  // 1s ticker so the countdown re-renders
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const leader = rows[0];
  // confidence = how far the leader is ahead of #2, scaled into a believable band
  const gap = leader && rows[1] ? leader.score - rows[1].score : 0;
  const confidence = clamp(Math.round(72 + gap * 2.4), 55, 96);

  return {
    rows,
    leader,
    confidence,
    scanned: SUPPORTED_STOCKS.length,
    lastScanAt,
    nextRefreshInMs: Math.max(0, nextAt - Date.now()),
    thoughts,
  };
}

export { INITIAL_LEADER };
