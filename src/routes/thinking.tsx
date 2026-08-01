import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Tag } from "@/components/SiteChrome";
import { useMockScan, type Phase } from "@/lib/mock-scan";
import type { MockStockAnalysis, StockStatus } from "@/lib/stock-universe";

export const Route = createFileRoute("/thinking")({
  head: () => ({
    meta: [
      { title: "kumo thinking :: kumo" },
      { name: "description", content: "watch kumo scan and rank every tokenized stock on robinhood chain in real time." },
    ],
  }),
  component: Thinking,
});

const STATUS_LABEL: Record<StockStatus, string> = {
  leading: "leading",
  watching: "watching",
  rising: "rising",
  cooling: "cooling",
  rejected: "rejected",
};

function bar(v: number) {
  const filled = Math.max(0, Math.min(8, Math.round((v / 100) * 8)));
  return "█".repeat(filled) + "░".repeat(8 - filled);
}
function short(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function StatusTag({ status }: { status: StockStatus }) {
  const on = status === "leading" || status === "rising";
  return <Tag tone={on ? "on" : "off"}>{STATUS_LABEL[status]}</Tag>;
}

function Copyable({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard?.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      className="link-kumo lowercase"
      title={text}
    >
      {copied ? "copied" : short(text)}
    </button>
  );
}

function ThoughtFeed({ lines }: { lines: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [lines]);
  return (
    <div
      ref={ref}
      className="bg-black/40 border border-[#ccff00]/30 h-40 overflow-y-auto p-2 text-[11px] sm:text-xs leading-relaxed"
    >
      {lines.map((l, i) => (
        <div key={i} className="lowercase">
          <span className="dim mr-2">kumo&gt;</span>
          {l}
          {i === lines.length - 1 ? <span className="cursor-blink">█</span> : null}
        </div>
      ))}
    </div>
  );
}

function Thinking() {
  const {
    rows, leader, liveLeader, runnerUp, gapPoints, confidence, scanned, lastScanAt, nextRefreshInMs,
    thoughts, phase, roundNumber, roundRemainingMs, leaderHistory, recentRounds,
  } = useMockScan();
  const [q, setQ] = useState("");

  const top5 = rows.slice(0, 5);
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => r.symbol.toLowerCase().includes(s) || r.name.toLowerCase().includes(s));
  }, [rows, q]);

  const nextSec = Math.ceil(nextRefreshInMs / 1000);
  const lastAgo = Math.max(0, Math.round((Date.now() - lastScanAt) / 1000));

  return (
    <>
      <Box title="kumo thinking" meta="simulated scan">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <span className="box-inv px-2 py-[2px] text-[10px] uppercase tracking-widest">simulated scan</span>
          <span className="dim text-xs lowercase">not real market analysis — kumo is rehearsing.</span>
        </div>
        <p className="lowercase leading-relaxed text-sm">
          kumo reads every tokenized stock on robinhood chain and keeps a running score for each. the
          board reshuffles as the numbers move. the top of it is who kumo would buy if a round fired
          right now.
        </p>
      </Box>

      {/* 1 + 4: leading pick + scan progress */}
      <div className="grid sm:grid-cols-2 gap-4">
        <Box title="leading this round" meta="current favorite">
          {leader ? (
            <div>
              <div className="text-2xl sm:text-3xl tracking-wide">{leader.name.toLowerCase()}</div>
              <div className="dim uppercase tracking-widest text-sm mt-1">
                {leader.symbol} · <StatusTag status="leading" />
              </div>
              <div className="mt-4">
                <div className="flex justify-between text-xs dim uppercase tracking-widest">
                  <span>conviction</span>
                  <span>{confidence}%</span>
                </div>
                <div className="font-mono text-lg">[{bar(confidence)}]</div>
              </div>
              <div className="text-xs dim lowercase mt-3">
                kumo's numbers point here right now. the pick can change before the round locks.
              </div>
            </div>
          ) : (
            <div className="dim lowercase">warming up…</div>
          )}
        </Box>

        <Box title="scan progress" meta="live">
          <div className="space-y-2 text-sm lowercase">
            <div className="flex justify-between">
              <span className="dim">stocks scanned</span>
              <span>{scanned}</span>
            </div>
            <div className="flex justify-between">
              <span className="dim">next refresh</span>
              <span>{nextSec}s</span>
            </div>
            <div className="flex justify-between">
              <span className="dim">last scan</span>
              <span>{lastAgo}s ago</span>
            </div>
            <div className="flex justify-between">
              <span className="dim">current leader</span>
              <span>{leader?.symbol ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="dim">confidence</span>
              <span>{confidence}%</span>
            </div>
          </div>
        </Box>
      </div>

      {/* decision lock */}
      <DecisionLock phase={phase} remainingMs={roundRemainingMs} roundNumber={roundNumber} leader={leader} />

      {/* why bullish + runner up */}
      <div className="grid sm:grid-cols-2 gap-4">
        <Box title="why i'm bullish" meta={leader?.symbol ?? "—"}>
          <WhyBullish leaderSymbol={leader?.symbol} phase={phase} />
        </Box>
        <Box title="runner up" meta="second place">
          <RunnerUp leader={liveLeader} runnerUp={runnerUp} gap={gapPoints} />
        </Box>
      </div>

      {/* 3: thought feed */}
      <Box title="kumo thought feed" meta="scanning…">
        <ThoughtFeed lines={thoughts} />
      </Box>

      {/* leader history */}
      <Box title="leader history" meta="last 10 decisions">
        <LeaderHistory marks={leaderHistory} />
      </Box>

      {/* 2: top ranked */}
      <Box title="top ranked" meta="best first · updates as kumo scans">
        <div className="overflow-x-auto">
          <table className="w-full text-xs lowercase whitespace-nowrap">
            <thead className="dim uppercase tracking-widest">
              <tr>
                <th className="text-left py-1 pr-3">#</th>
                <th className="text-left py-1 pr-3">stock</th>
                <th className="text-left py-1 pr-3">score</th>
                <th className="text-right py-1 pr-3">mom</th>
                <th className="text-right py-1 pr-3">vol</th>
                <th className="text-right py-1 pr-3">volat</th>
                <th className="text-right py-1 pr-3">liq</th>
                <th className="text-left py-1">status</th>
              </tr>
            </thead>
            <tbody>
              {top5.map((r, i) => (
                <Row key={r.contract} rank={i} r={r} />
              ))}
            </tbody>
          </table>
        </div>
      </Box>

      {/* recent rounds */}
      <Box title="recent purchases" meta="what kumo bought">
        <RecentRounds rounds={recentRounds} />
      </Box>

      {/* 5: searchable universe */}
      <Box title="stock universe" meta={`${rows.length} supported`}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="search symbol or company…"
          className="w-full bg-black border border-[#ccff00]/40 px-3 py-2 text-sm lowercase mb-3 outline-none focus:border-[#ccff00]"
        />
        <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
          <table className="w-full text-xs lowercase whitespace-nowrap">
            <thead className="dim uppercase tracking-widest sticky top-0 bg-black">
              <tr>
                <th className="text-left py-1 pr-3">company</th>
                <th className="text-left py-1 pr-3">symbol</th>
                <th className="text-left py-1 pr-3">contract</th>
                <th className="text-right py-1 pr-3">score</th>
                <th className="text-left py-1">status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.contract} className="border-t border-[#ccff00]/20">
                  <td className="py-1 pr-3">{r.name.toLowerCase()}</td>
                  <td className="py-1 pr-3">{r.symbol}</td>
                  <td className="py-1 pr-3"><Copyable text={r.contract} /></td>
                  <td className="py-1 pr-3 text-right">{Math.round(r.score)}</td>
                  <td className="py-1"><StatusTag status={r.status} /></td>
                </tr>
              ))}
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-3 dim text-center">nothing matches "{q}".</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Box>

      <div className="dim text-xs text-center lowercase">
        simulated scan. mock data, not real market analysis. kumo is not your advisor.
      </div>
    </>
  );
}

function fmtCountdown(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function DecisionLock({
  phase,
  remainingMs,
  roundNumber,
  leader,
}: {
  phase: Phase;
  remainingMs: number;
  roundNumber: number;
  leader?: MockStockAnalysis;
}) {
  const sym = leader?.symbol ?? "—";
  const pct = Math.max(0, Math.min(100, 100 - (remainingMs / 75000) * 100));

  if (phase === "locked") {
    return (
      <Box title="decision lock" meta={`round ${roundNumber}`}>
        <div className="box-inv p-4 text-center jitter">
          <div className="text-lg sm:text-2xl tracking-widest">✓ decision locked</div>
          <div className="lowercase mt-1">buying {sym}<span className="cursor-blink">█</span></div>
        </div>
      </Box>
    );
  }
  if (phase === "broadcast") {
    return (
      <Box title="decision lock" meta={`round ${roundNumber}`}>
        <div className="box p-4 text-center">
          <div className="text-lg sm:text-2xl tracking-widest">✓ broadcast complete</div>
          <div className="lowercase dim mt-1">bought {sym}. next round loading…</div>
        </div>
      </Box>
    );
  }
  const locking = phase === "locking";
  return (
    <Box title="decision lock" meta={`round ${roundNumber}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className={`tracking-widest uppercase text-sm ${locking ? "flicker" : "dim"}`}>
          {locking ? "locking decision..." : "scanning — decision open"}
        </div>
        <div className="text-2xl font-mono">{fmtCountdown(remainingMs)}</div>
      </div>
      <div className="h-2 bg-[#ccff00]/15 mt-3">
        <div
          className={`h-full ${locking ? "bg-[#ccff00]" : "bg-[#ccff00]/60"} transition-all duration-1000`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="text-xs dim lowercase mt-2">
        {locking ? (
          <>leader frozen at <span className="text-[#ccff00]">{sym}</span>. no more changes this round.</>
        ) : (
          <>current pick: <span className="text-[#ccff00]">{sym}</span>. can still change until it locks.</>
        )}
      </div>
    </Box>
  );
}

const BULLISH_POOL = [
  "liquidity improving",
  "buying pressure increasing",
  "volatility stabilizing",
  "confidence rising",
  "scoring above market average",
  "momentum holding firm",
  "volume confirming the move",
  "spread tightening",
  "sector strength aligned",
  "no cooling detected",
];
function WhyBullish({ leaderSymbol, phase }: { leaderSymbol?: string; phase: Phase }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((n) => n + 1), 2600);
    return () => clearInterval(id);
  }, []);
  // show a rolling window of 5 reasons
  const lines = Array.from({ length: 5 }, (_, k) => BULLISH_POOL[(i + k) % BULLISH_POOL.length]);
  return (
    <div className="text-sm lowercase">
      <div className="dim mb-2">
        {phase === "locking" || phase === "locked"
          ? `${leaderSymbol ?? "—"} is the pick. here's why:`
          : `${leaderSymbol ?? "—"} leads. here's why:`}
      </div>
      <div className="space-y-1 font-mono text-xs sm:text-sm">
        {lines.map((l, k) => (
          <div key={k} className={k === 0 ? "" : "dim"}>
            <span className="dim mr-2">&gt;</span>{l}
          </div>
        ))}
      </div>
    </div>
  );
}

function RunnerUp({
  leader,
  runnerUp,
  gap,
}: {
  leader?: MockStockAnalysis;
  runnerUp: MockStockAnalysis | null;
  gap: number;
}) {
  if (!runnerUp || !leader) return <div className="dim lowercase text-sm">warming up…</div>;
  const lead = Math.round(leader.score);
  const run = Math.round(runnerUp.score);
  const w = (v: number) => `${Math.max(6, Math.min(100, v))}%`;
  return (
    <div className="text-sm lowercase">
      <div className="text-xl tracking-wide">{runnerUp.symbol}</div>
      <div className="dim text-xs mt-1">
        lost by <span className="text-[#ccff00]">{gap.toFixed(1)} points</span>
      </div>
      <div className="mt-3 space-y-2 font-mono text-xs">
        <div>
          <div className="flex justify-between"><span>{leader.symbol}</span><span>{lead}</span></div>
          <div className="h-2 bg-[#ccff00]/15 mt-1">
            <div className="h-full bg-[#ccff00] transition-all duration-1000" style={{ width: w(lead) }} />
          </div>
        </div>
        <div>
          <div className="flex justify-between"><span>{runnerUp.symbol}</span><span>{run}</span></div>
          <div className="h-2 bg-[#ccff00]/15 mt-1">
            <div className="h-full bg-[#ccff00]/50 transition-all duration-1000" style={{ width: w(run) }} />
          </div>
        </div>
      </div>
    </div>
  );
}

function LeaderHistory({ marks }: { marks: { time: string; symbol: string; conviction: number; current?: boolean }[] }) {
  if (marks.length === 0) {
    return <div className="dim lowercase text-sm">kumo is forming its first read<span className="cursor-blink">█</span></div>;
  }
  const ordered = [...marks].reverse(); // newest first
  return (
    <div className="space-y-0">
      {ordered.map((m, i) => (
        <div key={`${m.time}-${m.symbol}-${i}`}>
          <div className={`flex items-center justify-between py-1 ${i === 0 ? "fade-in" : ""}`}>
            <div className="flex items-baseline gap-3">
              <span className="dim text-xs w-16">{m.time}</span>
              <span className="tracking-wide">{m.symbol}</span>
              {i === 0 ? <Tag>current leader</Tag> : null}
            </div>
            <span className="text-xs dim lowercase">conviction {m.conviction}%</span>
          </div>
          {i < ordered.length - 1 ? <div className="dim text-center text-xs leading-none">↓</div> : null}
        </div>
      ))}
    </div>
  );
}

function RecentRounds({ rounds }: { rounds: { round: number; symbol: string; state: "bought" | "buying" }[] }) {
  return (
    <div className="space-y-2">
      {rounds.map((r) => (
        <div key={r.round} className="flex items-center justify-between border-t border-[#ccff00]/20 py-2 first:border-t-0">
          <div className="lowercase">
            <span className="dim mr-2">round {r.round}</span>
            {r.state === "buying" ? (
              <span>buying {r.symbol}<span className="cursor-blink">█</span></span>
            ) : (
              <span>bought {r.symbol}</span>
            )}
          </div>
          {r.state === "bought" ? (
            <Link to="/ledger" className="link-kumo text-xs lowercase">view ledger</Link>
          ) : (
            <Tag>in progress</Tag>
          )}
        </div>
      ))}
    </div>
  );
}

function Row({ rank, r }: { rank: number; r: MockStockAnalysis }) {
  return (
    <tr className="border-t border-[#ccff00]/30">
      <td className="py-1 pr-3 dim">{String(rank + 1).padStart(2, "0")}</td>
      <td className="py-1 pr-3">
        <span className="mr-2">{r.symbol}</span>
        <span className="dim hidden sm:inline">{r.name.toLowerCase()}</span>
      </td>
      <td className="py-1 pr-3 font-mono">[{bar(r.score)}] {Math.round(r.score)}</td>
      <td className="py-1 pr-3 text-right">{Math.round(r.momentum)}</td>
      <td className="py-1 pr-3 text-right">{Math.round(r.volume)}</td>
      <td className="py-1 pr-3 text-right">{Math.round(r.volatility)}</td>
      <td className="py-1 pr-3 text-right">{Math.round(r.liquidity)}</td>
      <td className="py-1"><StatusTag status={r.status} /></td>
    </tr>
  );
}
