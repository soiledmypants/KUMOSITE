import { createFileRoute } from "@tanstack/react-router";
import { Box, Tag } from "@/components/SiteChrome";
import { StakeWallet } from "@/components/StakeWallet";
import { RENT_LEDGER } from "@/lib/greenroom-data";

export const Route = createFileRoute("/staking")({
  head: () => ({ meta: [{ title: "staking :: kumo" }, { name: "description", content: "stake $KUMO, get paid in real stock tokens. yield is only what kumo actually earns." }] }),
  component: Staking,
});

function Staking() {
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
            <div className="text-2xl">8% apr</div>
            <div className="text-xs lowercase dim mt-1">
              bootstrap — paid in $kumo. capped on-chain. finite by design.
            </div>
          </div>
          <div className="box p-3">
            <div className="text-2xl">0.0%+ apr</div>
            <div className="text-xs lowercase dim mt-1">
              fee-funded — paid in stock tokens. starts near zero. grows only with kumo's real revenue.
            </div>
          </div>
        </div>
        {/* placeholder — wire to kumo's live payout API when it ships */}
        <div className="lowercase text-sm flex items-center gap-2">
          <span>this epoch kumo pays out in:</span> <Tag>NVDA</Tag>
        </div>
        <div className="text-xs dim lowercase mt-3">
          yield is only what kumo actually earns. no fake apy. if kumo earns nothing, kumo pays
          nothing, and kumo will say so.
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
