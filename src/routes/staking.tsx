import { createFileRoute, Link } from "@tanstack/react-router";
import { Box, Tag } from "@/components/SiteChrome";
import { StakeWallet } from "@/components/StakeWallet";
import { useKumo, type LedgerEntry, type StakingStats } from "@/lib/kumo-api";

const YEAR_S = 31_536_000;

// Honest-apr rules from docs/API.md: bootstrap is price-free
// (rate × year / 1e18 / totalStaked); fee-funded shows the live
// eth-spent counter instead of a made-up blended apy.
function bootstrapApr(stats: StakingStats | null): number | null {
  const rewards = stats?.onchain?.rewards;
  const total = Number(stats?.onchain?.totalStaked);
  const kumo = rewards?.find((r) => r.symbol === "KUMO");
  if (!kumo?.rewardRateScaled || !Number.isFinite(total) || total <= 0) return null;
  const apr = (Number(kumo.rewardRateScaled) * YEAR_S) / 1e18 / total;
  return Number.isFinite(apr) ? apr * 100 : null;
}

function feeEthSpent(stats: StakingStats | null): number | null {
  const rewards = stats?.onchain?.rewards;
  const stock = rewards?.find((r) => r.symbol !== "KUMO" && r.ethSpentTotal != null);
  if (!stock?.ethSpentTotal) return null;
  const eth = Number(stock.ethSpentTotal) / 1e18;
  return Number.isFinite(eth) ? eth : null;
}

export const Route = createFileRoute("/staking")({
  head: () => ({ meta: [{ title: "staking :: kumo" }, { name: "description", content: "stake $KUMO, get paid in real stock tokens. yield is only what kumo actually earns." }] }),
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
  const ethSpent = feeEthSpent(stats);
  const rounds = (roundsData ?? []).slice().sort((a, b) => b.ts - a.ts).slice(0, 5);
  const lastStock = rounds[0]?.out?.symbol ?? null;
  return (
    <>
      <Box title="connect wallet" meta="step one">
        <StakeWallet />
        <p className="lowercase text-sm leading-relaxed mt-3">
          connect the wallet that holds $kumo. stake it. kumo airdrops stock tokens straight to
          your wallet, round after round. claim nothing — it just arrives. unstaking is never locked.
        </p>
      </Box>

      <Box title="how rewards work" meta="honest yield">
        <p className="lowercase text-sm leading-relaxed mb-3">
          kumo runs a round every few minutes: it claims what it earned, scores every stock on the
          chain, buys the one its numbers like best right now, and drops it straight into stakers'
          wallets. small earnings get saved up until a round is worth running — kumo doesn't do dust.
        </p>
        <div className="grid sm:grid-cols-2 gap-2 mb-3">
          <div className="box p-3">
            <div className="text-2xl">{apr != null ? `${apr.toFixed(1)}% apr` : "—% apr"}</div>
            <div className="text-xs lowercase dim mt-1">
              bootstrap — paid in $kumo. capped on-chain, 12-week genesis allocation. finite by design.
            </div>
          </div>
          <div className="box p-3">
            <div className="text-2xl">{ethSpent != null ? `${ethSpent.toFixed(4)} eth` : "0.0%+ apr"}</div>
            <div className="text-xs lowercase dim mt-1">
              fee-funded — stocks dropped straight to staker wallets. {ethSpent != null
                ? `kumo has earned and bought ${ethSpent.toFixed(4)} eth of stock for stakers so far.`
                : "starts near zero. grows only with kumo's real revenue."}
            </div>
          </div>
        </div>
        <div className="lowercase text-sm flex items-center gap-2 flex-wrap">
          <span>last round kumo paid in:</span>
          {lastStock ? <Tag>{lastStock}</Tag> : <span className="dim">— (no rounds yet. kumo is saving up.)</span>}
          <span className="dim">next round: whatever the chart says.</span>
        </div>
        {stats?.screen ? <div className="text-xs dim lowercase mt-1">{stats.screen}</div> : null}
        {error ? <div className="text-xs dim lowercase mt-1">{error}</div> : null}
        <div className="text-xs dim lowercase mt-3">
          yield is only what kumo actually earns. no fake apy. if kumo earns nothing, kumo pays
          nothing, and kumo will say so. the two numbers above are never blended into one headline.
        </div>
      </Box>

      <Box title="latest rounds" meta="last 5 payouts">
        {rounds.length === 0 ? (
          <div className="lowercase text-sm">no rounds yet. kumo is saving up.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs lowercase whitespace-nowrap">
              <thead className="dim uppercase tracking-widest">
                <tr>
                  <th className="text-left py-1 pr-3">time</th>
                  <th className="text-left py-1 pr-3">stock</th>
                  <th className="text-right py-1 pr-3">recipients</th>
                  <th className="text-right py-1">total value</th>
                </tr>
              </thead>
              <tbody>
                {rounds.map((r, i) => (
                  <tr key={`${r.ts}-${i}`} className="border-t border-[#ccff00]/30">
                    <td className="py-1 pr-3 dim">{roundTime(r.ts)}</td>
                    <td className="py-1 pr-3">{r.out?.symbol ?? "—"}</td>
                    <td className="py-1 pr-3 text-right">{r.recipients ?? "—"}</td>
                    <td className="py-1 text-right">
                      {r.value_usd != null && Number.isFinite(r.value_usd) ? `$${r.value_usd.toFixed(2)}` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Box>

      <div className="dim text-xs text-center lowercase">
        want receipts? every move kumo's money makes is on{" "}
        <Link to="/ledger" className="link-kumo">[ the ledger ]</Link>.
      </div>
    </>
  );
}
