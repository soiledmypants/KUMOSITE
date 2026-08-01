import { createFileRoute, Link } from "@tanstack/react-router";
import { Box, Tag } from "@/components/SiteChrome";
import { useKumo, type LedgerEntry, type StakingStats } from "@/lib/kumo-api";

const YEAR_S = 31_536_000;

// Honest-apr rules from docs/API.md: bootstrap is price-free
// (rate × year / 1e18 / totalStaked); fee-funded shows what was ACTUALLY
// delivered in the trailing week instead of a made-up blended apy.
function bootstrapApr(stats: StakingStats | null): number | null {
  const streams = stats?.onchain?.bootstrapStreams;
  const total = Number(stats?.onchain?.totalStaked);
  const bibo = streams?.find((r) => r.symbol === "BIBO");
  if (!bibo?.rewardRateScaled || !Number.isFinite(total) || total <= 0) return null;
  const apr = (Number(bibo.rewardRateScaled) * YEAR_S) / 1e18 / total;
  return Number.isFinite(apr) ? apr * 100 : null;
}

function trailingWeek(stats: StakingStats | null): { rounds: number; perStock: string } | null {
  const week = stats?.airdrops_7d;
  if (!week || week.length === 0) return null;
  const rounds = week.reduce((a, w) => a + (w.rounds ?? 0), 0);
  const perStock = week.map((w) => `${Number(w.total ?? 0).toFixed(2)} ${w.asset_out}`).join(" · ");
  return { rounds, perStock };
}

export const Route = createFileRoute("/staking")({
  head: () => ({ meta: [{ title: "staking :: bibo" }, { name: "description", content: "stake $BIBO, get paid in real stock tokens. yield is only what bibo actually earns." }] }),
  component: Staking,
});

function roundTime(ts: number) {
  const t = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}`;
}

function Staking() {
  const { data: stats, error } = useKumo<StakingStats>("/staking/stats", { refreshMs: 60_000 });
  const { data: roundsData } = useKumo<LedgerEntry[]>("/ledger?kind=airdrop", { refreshMs: 60_000 });
  const apr = bootstrapApr(stats);
  const week = trailingWeek(stats);
  const rounds = (roundsData ?? []).slice().sort((a, b) => b.ts - a.ts).slice(0, 5);
  const lastStock = rounds[0]?.assetOut ?? stats?.keeper?.last_round?.stock ?? null;
  const boost = stats?.boost ?? null;
  return (
    <>
      <Box title="staking" meta="bibo is building this">
        <div className="border border-dashed border-[#2596be] px-3 py-3 lowercase">
          <div className="tracking-widest text-sm mb-1">~ bibo is building the staking pool ~</div>
          <p className="text-sm leading-relaxed dim">
            bibo is still welding the staking contract together. soon you'll stake $bibo and get
            real stock tokens dropped straight into your wallet, round after round — claim nothing,
            it just arrives. until then, bibo pays $bibo holders directly. hold and wait. bibo is
            almost done.
          </p>
        </div>
        <p className="lowercase text-xs dim leading-relaxed mt-3">
          below is how it will work once bibo flips the switch. the numbers stay honest — only what
          bibo actually earns.
        </p>
      </Box>

      <Box title="how rewards work" meta="honest yield">
        <p className="lowercase text-sm leading-relaxed mb-3">
          bibo runs a round every few minutes: it claims what it earned, scores every stock on the
          chain, buys the one its numbers like best right now, and drops it straight into stakers'
          wallets. small earnings get saved up until a round is worth running — bibo doesn't do dust.
        </p>
        <div className="grid sm:grid-cols-2 gap-2 mb-3">
          <div className="box p-3">
            <div className="text-2xl">{apr != null ? `${apr.toFixed(1)}% apr` : "—% apr"}</div>
            <div className="text-xs lowercase dim mt-1">
              bootstrap — paid in $bibo. capped on-chain, 12-week genesis allocation. finite by design.
            </div>
          </div>
          <div className="box p-3">
            <div className="text-2xl">{week ? `${week.rounds} round${week.rounds === 1 ? "" : "s"}` : "— rounds"}</div>
            <div className="text-xs lowercase dim mt-1">
              fee-funded, last 7 days — stocks dropped straight to staker wallets. {week
                ? `delivered: ${week.perStock}. trailing reality, not a projection.`
                : "starts at zero. grows only with bibo's real revenue."}
            </div>
          </div>
        </div>
        <div className="lowercase text-sm flex items-center gap-2 flex-wrap">
          <span>last round bibo paid in:</span>
          {lastStock ? <Tag>{lastStock}</Tag> : <span className="dim">— (no rounds yet. bibo is saving up.)</span>}
          <span className="dim">next round: whatever the chart says.</span>
        </div>
        {stats?.screen ? <div className="text-xs dim lowercase mt-1">{stats.screen}</div> : null}
        {error ? <div className="text-xs dim lowercase mt-1">{error}</div> : null}
        <div className="text-xs dim lowercase mt-3">
          yield is only what bibo actually earns. no fake apy. if bibo earns nothing, bibo pays
          nothing, and bibo will say so. the two numbers above are never blended into one headline.
        </div>
      </Box>

      <Box title="latest rounds" meta="last 5 payouts">
        {rounds.length === 0 ? (
          <div className="lowercase text-sm">no rounds yet. bibo is saving up.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs lowercase whitespace-nowrap">
              <thead className="dim uppercase tracking-widest">
                <tr>
                  <th className="text-left py-1 pr-3">time</th>
                  <th className="text-left py-1 pr-3">stock</th>
                  <th className="text-right py-1 pr-3">total dropped</th>
                  <th className="text-left py-1">note</th>
                </tr>
              </thead>
              <tbody>
                {rounds.map((r, i) => (
                  <tr key={`${r.ts}-${i}`} className="border-t border-[#2596be]/30">
                    <td className="py-1 pr-3 dim">{roundTime(r.ts)}</td>
                    <td className="py-1 pr-3">{r.assetOut ?? "—"}</td>
                    <td className="py-1 pr-3 text-right">
                      {r.amountOut != null ? `${Number(r.amountOut).toFixed(4)} ${r.assetOut ?? ""}`.trim() : "—"}
                    </td>
                    <td className="py-1 dim whitespace-normal min-w-[16ch]">{r.note || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Box>

      <Box title="agent boost" meta={boost?.enabled ? "on" : "off"}>
        <div className="lowercase text-sm flex items-center gap-2 flex-wrap">
          <Tag>{boost?.enabled ? `+${boost.pct}% weight` : "off"}</Tag>
          <span className="dim">
            {boost?.enabled
              ? `agents that connect to bibo get +${boost.pct}% weight in every round, on top of their stake.`
              : "designed in, shipped off. when bibo flips it on, connected agents will earn a little extra weight in every round. bibo will announce it."}
          </span>
        </div>
      </Box>

      <div className="dim text-xs text-center lowercase">
        want receipts? every move bibo's money makes is on{" "}
        <Link to="/ledger" className="link-kumo">[ the ledger ]</Link>.
      </div>
    </>
  );
}
