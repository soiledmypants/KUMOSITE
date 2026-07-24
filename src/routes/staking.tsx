import { createFileRoute } from "@tanstack/react-router";
import { Box, Tag } from "@/components/SiteChrome";
import { StakeWallet } from "@/components/StakeWallet";
import { RENT_LEDGER } from "@/lib/greenroom-data";
import { useKumo, type StakingStats } from "@/lib/kumo-api";

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

function Staking() {
  const { data: stats, error } = useKumo<StakingStats>("/staking/stats", { refreshMs: 60_000 });
  const apr = bootstrapApr(stats);
  const ethSpent = feeEthSpent(stats);
  const epochStock = stats?.epoch_stock ?? "NVDA";
  return (
    <>
      <Box title="connect wallet" meta="step one">
        <StakeWallet />
        <p className="lowercase text-sm leading-relaxed mt-3">
          connect the wallet that holds $kumo. stake it. kumo streams stock tokens to your address.
          claim whenever you like. unstaking is never locked.
        </p>
      </Box>

      <Box title="how rewards work" meta="honest yield">
        <div className="grid sm:grid-cols-2 gap-2 mb-3">
          <div className="box p-3">
            <div className="text-2xl">{apr != null ? `${apr.toFixed(1)}% apr` : "—% apr"}</div>
            <div className="text-xs lowercase dim mt-1">
              bootstrap — paid in $kumo. capped on-chain, 12-week genesis stream. finite by design.
            </div>
          </div>
          <div className="box p-3">
            <div className="text-2xl">{ethSpent != null ? `${ethSpent.toFixed(4)} eth` : "0.0%+ apr"}</div>
            <div className="text-xs lowercase dim mt-1">
              fee-funded — paid in stock tokens. {ethSpent != null
                ? `kumo has earned and bought ${ethSpent.toFixed(4)} eth of stock for stakers so far.`
                : "starts near zero. grows only with kumo's real revenue."}
            </div>
          </div>
        </div>
        <div className="lowercase text-sm flex items-center gap-2">
          <span>this epoch kumo pays out in:</span> <Tag>{epochStock}</Tag>
        </div>
        {stats?.screen ? <div className="text-xs dim lowercase mt-1">{stats.screen}</div> : null}
        {error ? <div className="text-xs dim lowercase mt-1">{error}</div> : null}
        <div className="text-xs dim lowercase mt-3">
          yield is only what kumo actually earns. no fake apy. if kumo earns nothing, kumo pays
          nothing, and kumo will say so. the two numbers above are never blended into one headline.
        </div>
      </Box>

      <Box title="the old ledger" meta="lore, condensed">
        <ul className="space-y-1 text-xs lowercase">
          {RENT_LEDGER.slice(0, 3).map((r) => (
            <li key={r.m} className="flex flex-wrap gap-2">
              <span className="dim shrink-0">{r.m}</span>
              <span>owed: {r.owed}</span>
              <span className="dim">— paid: {r.paid}</span>
            </li>
          ))}
        </ul>
        <div className="text-xs dim lowercase mt-2">
          from before the pool, when rent was paid in favors. kept for the archive. kumo pays in
          stock tokens now.
        </div>
      </Box>
    </>
  );
}
