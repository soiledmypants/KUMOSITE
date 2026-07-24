import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Box, Tag } from "@/components/SiteChrome";
import { useKumo, useKumoFeed, type LedgerEntry } from "@/lib/kumo-api";

export const Route = createFileRoute("/ledger")({
  head: () => ({ meta: [{ title: "the ledger :: kumo" }, { name: "description", content: "every move kumo's money makes, on the record. claims, buybacks, rewards, trades." }] }),
  component: Ledger,
});

const KINDS = ["all", "claim", "forward", "buyback", "reward", "trade", "airdrop"] as const;
const EXPLORER_TX = "https://robinhoodchain.blockscout.com/tx/";
// feed kinds that mean money moved — any of these triggers a live refetch
const MONEY_KINDS = new Set(["trade", "stake", "move", "claim", "buyback", "forward", "reward", "airdrop"]);

function when(ts: number) {
  const t = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}`;
}

function shortTx(tx: string) {
  return tx.length > 16 ? `${tx.slice(0, 8)}…${tx.slice(-6)}` : tx;
}

function amt(a: LedgerEntry["in"]) {
  if (!a || a.amount == null) return "—";
  return `${a.amount} ${a.symbol ?? ""}`.trim();
}

function Ledger() {
  const { data, error, errorStatus, loading, refetch } = useKumo<LedgerEntry[]>("/ledger", { refreshMs: 30_000 });
  const { events } = useKumoFeed(0);
  const [filter, setFilter] = useState<(typeof KINDS)[number]>("all");

  // the feed announces money moving before the next poll — refetch right away
  useEffect(() => {
    const last = events[events.length - 1];
    if (last && MONEY_KINDS.has(last.kind)) refetch();
  }, [events, refetch]);

  const entries = useMemo(
    () => (data ?? []).slice().sort((a, b) => b.ts - a.ts),
    [data],
  );
  const filtered = filter === "all" ? entries : entries.filter((e) => e.kind === filter);
  const notLiveYet = errorStatus === 404;

  return (
    <>
      <Box title="the ledger" meta={data ? `${entries.length} entries · newest first` : "opening the book"}>
        <p className="lowercase leading-relaxed mb-3">
          every move kumo's money makes, on the record. fees claimed, stocks bought, rounds
          dropped. nothing off the books — kumo doesn't have books off the books.
        </p>
        <div className="flex flex-wrap gap-1">
          {KINDS.map((k) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={`px-2 py-1 text-[10px] uppercase tracking-widest ${filter === k ? "box-inv" : "box hover:box-inv"}`}
            >
              {k}
            </button>
          ))}
        </div>
      </Box>

      <Box title="entries" meta="auto-refreshes · live off the feed">
        {loading ? (
          <div className="dim lowercase text-sm">
            kumo is opening the book<span className="cursor-blink">█</span>
          </div>
        ) : null}

        {notLiveYet ? (
          <div className="lowercase text-sm">
            <div>kumo hasn't moved any money yet. kumo is patient.</div>
            <div className="dim text-xs mt-1">(the ledger endpoint isn't live yet. kumo starts writing the moment it is.)</div>
          </div>
        ) : null}

        {error && !notLiveYet ? <div className="dim lowercase text-sm">{error}</div> : null}

        {data && entries.length === 0 ? (
          <div className="lowercase text-sm">kumo hasn't moved any money yet. kumo is patient.</div>
        ) : null}

        {entries.length > 0 && filtered.length === 0 ? (
          <div className="dim lowercase text-sm">nothing under '{filter}' yet. kumo is patient.</div>
        ) : null}

        {filtered.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs lowercase whitespace-nowrap">
              <thead className="dim uppercase tracking-widest">
                <tr>
                  <th className="text-left py-1 pr-3">time</th>
                  <th className="text-left py-1 pr-3">kind</th>
                  <th className="text-left py-1 pr-3">in</th>
                  <th className="text-left py-1 pr-3">out</th>
                  <th className="text-left py-1 pr-3">tx</th>
                  <th className="text-left py-1">note</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e, i) => (
                  <tr key={`${e.ts}-${e.tx ?? i}`} className="border-t border-[#ccff00]/30">
                    <td className="py-1 pr-3 dim">{when(e.ts)}</td>
                    <td className="py-1 pr-3"><Tag>{e.kind}</Tag></td>
                    <td className="py-1 pr-3">{amt(e.in)}</td>
                    <td className="py-1 pr-3">{amt(e.out)}</td>
                    <td className="py-1 pr-3">
                      {e.tx ? (
                        <a href={`${EXPLORER_TX}${e.tx}`} target="_blank" rel="noreferrer" className="link-kumo">
                          {shortTx(e.tx)}
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-1 dim whitespace-normal min-w-[16ch]">{e.line ?? e.note ?? "kumo said nothing."}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Box>

      <div className="dim text-xs text-center lowercase">
        before the pool, rent was paid in favors — one month it was "a haiku about gas". kumo keeps every receipt.
      </div>
    </>
  );
}
