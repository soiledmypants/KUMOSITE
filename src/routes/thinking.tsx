import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Tag } from "@/components/SiteChrome";
import { useMockScan } from "@/lib/mock-scan";
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
  const { rows, leader, confidence, scanned, lastScanAt, nextRefreshInMs, thoughts } = useMockScan();
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

      {/* 3: thought feed */}
      <Box title="kumo thought feed" meta="scanning…">
        <ThoughtFeed lines={thoughts} />
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
