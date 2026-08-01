// SIMULATED scan + decision engine for the "kumo thinking" panel. Everything
// here is fake — no price feeds, no chain reads, no trading. It produces a
// believable, gently evolving board plus a per-round decision lifecycle so the
// page feels like an agent thinking before each purchase. Swap this module for
// real scanner output later; stock-universe.ts stays as-is.
import { useEffect, useRef, useState } from "react";
import {
  SUPPORTED_STOCKS,
  type MockStockAnalysis,
  type StockStatus,
} from "./stock-universe";

function seed(symbol: string): number {
  let h = 0;
  for (let i = 0; i < symbol.length; i++) h = (h * 31 + symbol.charCodeAt(i)) >>> 0;
  return h;
}
const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

// close together on purpose so the leader believably swaps every couple of
// rounds (drives leader history + "takes first place"), MSFT still starts on top
const HEADLINERS: Record<string, number> = { MSFT: 86, NVDA: 84, META: 82, AMZN: 80, GOOGL: 78 };

function initial(): MockStockAnalysis[] {
  return SUPPORTED_STOCKS.map((s) => {
    const base = HEADLINERS[s.symbol] ?? 30 + (seed(s.symbol) % 42);
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

function convictionOf(rows: MockStockAnalysis[]): number {
  const gap = rows[0] && rows[1] ? rows[0].score - rows[1].score : 0;
  return clamp(Math.round(72 + gap * 2.4), 55, 96);
}

function fmtClock(ms: number): string {
  const d = new Date(ms);
  let h = d.getHours();
  const m = d.getMinutes();
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, "0")} ${ap}`;
}

// ---- decision round lifecycle ------------------------------------------------
export type Phase = "scanning" | "locking" | "locked" | "broadcast";
const ROUND_MS = 75_000; // full round
const LOCK_MS = 30_000; // last 30s = locking (leader frozen)
const LOCKED_HOLD_MS = 4_000; // "DECISION LOCKED / buying X"
const BROADCAST_HOLD_MS = 3_500; // "broadcast complete"

export type LeaderMark = { time: string; symbol: string; conviction: number; current?: boolean };
export type RoundRecord = { round: number; symbol: string; state: "bought" | "buying" };

const SEED_ROUNDS: RoundRecord[] = [
  { round: 43, symbol: "MSFT", state: "bought" },
  { round: 42, symbol: "META", state: "bought" },
  { round: 41, symbol: "NVDA", state: "bought" },
];
const START_ROUND = 44;

// contextual thought lines — machine voice, phase aware
function thoughtLine(rows: MockStockAnalysis[], phase: Phase, leaderChanged: string | null): string {
  const leader = rows[0]?.symbol ?? "—";
  const second = rows[1]?.symbol ?? "—";
  if (leaderChanged) return `${leaderChanged} takes first place...`;
  if (phase === "locking") {
    return pick([
      "decision nearly locked...",
      "preparing transaction...",
      `holding ${leader} as the pick...`,
      "confidence threshold exceeded...",
    ]);
  }
  if (phase === "locked") return `buying ${leader}...`;
  if (phase === "broadcast") return "broadcast complete.";
  return pick([
    "checking unusual volume...",
    "comparing ai sector strength...",
    "re-ranking top candidates...",
    `checking ${leader} liquidity...`,
    `${leader} momentum remains strong...`,
    `${second} pressing ${leader} for first...`,
    "cross-checking volume against liquidity...",
    "confidence threshold not yet met...",
    `${second} lost momentum...`,
    "scanning the board again...",
  ]);
}
function pick<T>(a: T[]): T {
  return a[Math.floor(Math.random() * a.length)];
}

export type ScanState = {
  rows: MockStockAnalysis[];
  leader: MockStockAnalysis; // frozen to the locked pick during lock phases
  liveLeader: MockStockAnalysis; // the true top row (unfrozen)
  runnerUp: MockStockAnalysis | null;
  gapPoints: number;
  confidence: number;
  scanned: number;
  lastScanAt: number;
  nextRefreshInMs: number;
  thoughts: string[];
  // decision engine
  phase: Phase;
  roundNumber: number;
  roundRemainingMs: number;
  leaderHistory: LeaderMark[];
  recentRounds: RoundRecord[];
};

const REFRESH_MIN = 10_000;
const REFRESH_MAX = 20_000;

export function useMockScan(): ScanState {
  const [rows, setRows] = useState<MockStockAnalysis[]>(initial);
  const [thoughts, setThoughts] = useState<string[]>([`scanning ${SUPPORTED_STOCKS.length} tokenized stocks...`]);
  const [lastScanAt, setLastScanAt] = useState<number>(() => Date.now());
  const [nextAt, setNextAt] = useState<number>(() => Date.now() + REFRESH_MIN);

  const [phase, setPhase] = useState<Phase>("scanning");
  const [roundNumber, setRoundNumber] = useState(START_ROUND);
  const [roundRemainingMs, setRoundRemainingMs] = useState(ROUND_MS);
  const [lockedLeader, setLockedLeader] = useState<MockStockAnalysis | null>(null);
  const [leaderHistory, setLeaderHistory] = useState<LeaderMark[]>([]);
  const [recentRounds, setRecentRounds] = useState<RoundRecord[]>(() => [...SEED_ROUNDS]);
  const [, force] = useState(0);

  const deltas = useRef<Record<string, number>>({});
  const rowsRef = useRef(rows);
  const phaseRef = useRef<Phase>("scanning");
  const roundStartRef = useRef<number>(Date.now());
  const subAtRef = useRef<number>(0);
  const lastLeaderRef = useRef<string>("");
  const lockedRef = useRef<MockStockAnalysis | null>(null);
  const roundNumRef = useRef<number>(START_ROUND);
  useEffect(() => { rowsRef.current = rows; }, [rows]);

  const pushThought = (line: string) => setThoughts((t) => [...t.slice(-40), line]);

  // score drift — paused while a decision is locking/locked so the board freezes
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      if (phaseRef.current === "scanning") {
        setRows((prev) => {
          const drifted = prev.map((r) => {
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
          return drifted.map((r, i) => ({ ...r, status: statusFor(i, r.score, deltas.current[r.symbol] ?? 0) }));
        });
        setLastScanAt(Date.now());
      }
      const gap = REFRESH_MIN + Math.random() * (REFRESH_MAX - REFRESH_MIN);
      setNextAt(Date.now() + gap);
      timer = setTimeout(tick, gap);
    };
    const first = REFRESH_MIN + Math.random() * (REFRESH_MAX - REFRESH_MIN);
    setNextAt(Date.now() + first);
    timer = setTimeout(tick, first);
    return () => clearTimeout(timer);
  }, []);

  // steady thought feed — every ~3.5s, phase aware
  useEffect(() => {
    const id = setInterval(() => {
      pushThought(thoughtLine(rowsRef.current, phaseRef.current, null));
    }, 3500);
    return () => clearInterval(id);
  }, []);

  // decision round machine — drives phase, leader history, recent rounds
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      const live = rowsRef.current[0];

      // leader-history + "takes first place" thought on a real change while scanning
      if (phaseRef.current === "scanning" && live && live.symbol !== lastLeaderRef.current) {
        const prev = lastLeaderRef.current;
        lastLeaderRef.current = live.symbol;
        setLeaderHistory((h) =>
          [...h.map((m) => ({ ...m, current: false })), { time: fmtClock(now), symbol: live.symbol, conviction: convictionOf(rowsRef.current), current: true }].slice(-10),
        );
        if (prev) pushThought(`${live.symbol} takes first place...`);
      }

      const remaining = Math.max(0, ROUND_MS - (now - roundStartRef.current));
      setRoundRemainingMs(remaining);
      const p = phaseRef.current;

      if (p === "scanning" && remaining <= LOCK_MS) {
        phaseRef.current = "locking"; setPhase("locking");
        lockedRef.current = live; setLockedLeader(live);
        pushThought("decision nearly locked...");
      } else if (p === "locking" && remaining <= 0) {
        phaseRef.current = "locked"; setPhase("locked"); subAtRef.current = now;
        const sym = (lockedRef.current ?? live)?.symbol ?? "—";
        setRecentRounds((r) => [{ round: roundNumRef.current, symbol: sym, state: "buying" }, ...r].slice(0, 7));
        pushThought(`confidence threshold exceeded. buying ${sym}...`);
      } else if (p === "locked" && now - subAtRef.current > LOCKED_HOLD_MS) {
        phaseRef.current = "broadcast"; setPhase("broadcast"); subAtRef.current = now;
        pushThought("broadcasting transaction...");
      } else if (p === "broadcast" && now - subAtRef.current > BROADCAST_HOLD_MS) {
        // complete: mark bought, advance the round, resume scanning
        const sym = (lockedRef.current ?? live)?.symbol ?? "—";
        setRecentRounds((r) => r.map((x) => (x.round === roundNumRef.current ? { ...x, symbol: sym, state: "bought" } : x)));
        roundNumRef.current += 1; setRoundNumber(roundNumRef.current);
        phaseRef.current = "scanning"; setPhase("scanning");
        roundStartRef.current = now;
        lockedRef.current = null; setLockedLeader(null);
        pushThought("broadcast complete. new round begins.");
      }
    }, 250);
    return () => clearInterval(id);
  }, []);

  // 1s heartbeat so countdowns re-render
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const liveLeader = rows[0];
  const leader = phase === "scanning" ? liveLeader : (lockedLeader ?? liveLeader);
  const runnerUp = rows[1] ?? null;
  const gapPoints = liveLeader && runnerUp ? liveLeader.score - runnerUp.score : 0;
  const confidence = convictionOf(rows);

  return {
    rows,
    leader,
    liveLeader,
    runnerUp,
    gapPoints,
    confidence,
    scanned: SUPPORTED_STOCKS.length,
    lastScanAt,
    nextRefreshInMs: Math.max(0, nextAt - Date.now()),
    thoughts,
    phase,
    roundNumber,
    roundRemainingMs,
    leaderHistory,
    recentRounds,
  };
}
