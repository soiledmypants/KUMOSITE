import { createFileRoute } from "@tanstack/react-router";
import { Box } from "@/components/SiteChrome";
import { useKumo, type StockRank } from "@/lib/kumo-api";

export const Route = createFileRoute("/stocks")({
  head: () => ({ meta: [{ title: "the chart room :: bibo" }, { name: "description", content: "bibo's live ta rankings for every tokenized stock on bnb chain." }] }),
  component: Stocks,
});

function scoreBar(score: number) {
  const filled = Math.max(0, Math.min(8, Math.round(score * 8)));
  return "█".repeat(filled) + "░".repeat(8 - filled);
}

function pct(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
}

function usd(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return "—";
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}m`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}k`;
  return `$${v.toFixed(2)}`;
}

function Stocks() {
  const { data: stocks, error, loading } = useKumo<StockRank[]>("/stocks/ranking", { refreshMs: 60_000 });
  return (
    <>
      <Box title="the chart room" meta={stocks ? `${stocks.length} stocks scored` : "warming up"}>
        <p className="lowercase leading-relaxed">
          bibo reads the charts so you don't have to. every tokenized stock on the chain, scored
          every five minutes — momentum, volume, liquidity, and a volatility penalty. the top of
          this table is what bibo buys for stakers whenever a round fires.
        </p>
      </Box>

      <Box title="ta rankings" meta="best first · refreshes with bibo">
        {loading ? (
          <div className="dim lowercase text-sm">
            bibo is running the numbers<span className="cursor-blink">█</span>
          </div>
        ) : null}
        {error ? <div className="dim lowercase text-sm">{error}</div> : null}
        {stocks && stocks.length === 0 ? (
          <div className="dim lowercase text-sm">no scores yet. bibo's history is still warming up.</div>
        ) : null}
        {stocks && stocks.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs lowercase whitespace-nowrap">
              <thead className="dim uppercase tracking-widest">
                <tr>
                  <th className="text-left py-1 pr-3">#</th>
                  <th className="text-left py-1 pr-3">symbol</th>
                  <th className="text-left py-1 pr-3">price</th>
                  <th className="text-left py-1 pr-3">ta score</th>
                  <th className="text-right py-1 pr-3">1h</th>
                  <th className="text-right py-1 pr-3">24h</th>
                  <th className="text-right py-1 pr-3">vol spike</th>
                  <th className="text-right py-1 pr-3">volatility</th>
                  <th className="text-right py-1">liquidity</th>
                </tr>
              </thead>
              <tbody>
                {stocks.map((s, i) => (
                  <tr key={s.address || s.symbol} className="border-t border-[#2596be]/30">
                    <td className="py-1 pr-3 dim">{String(i + 1).padStart(2, "0")}</td>
                    <td className="py-1 pr-3">{s.symbol}</td>
                    <td className="py-1 pr-3">{s.price_usd != null ? `$${s.price_usd.toFixed(2)}` : "—"}</td>
                    <td className="py-1 pr-3 font-mono">
                      [{scoreBar(s.ta_score)}] {s.ta_score.toFixed(2)}
                    </td>
                    <td className="py-1 pr-3 text-right">{pct(s.short_momentum_pct)}</td>
                    <td className="py-1 pr-3 text-right">{pct(s.long_momentum_pct)}</td>
                    <td className="py-1 pr-3 text-right">
                      {s.volume_spike != null && Number.isFinite(s.volume_spike) ? `×${s.volume_spike.toFixed(1)}` : "—"}
                    </td>
                    <td className="py-1 pr-3 text-right">
                      {s.volatility_pct != null && Number.isFinite(s.volatility_pct) ? `${s.volatility_pct.toFixed(1)}%` : "—"}
                    </td>
                    <td className="py-1 text-right">{usd(s.liquidity_usd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <div className="text-xs dim lowercase mt-3">
          a price of — means the pool is too shallow to price honestly, so bibo doesn't.
        </div>
      </Box>

      <div className="dim text-xs text-center lowercase">
        scores are not advice. bibo is not your advisor. bibo just really likes charts.
      </div>
    </>
  );
}
