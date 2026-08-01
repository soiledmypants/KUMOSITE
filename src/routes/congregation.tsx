import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Box, Tag } from "@/components/SiteChrome";
import { useKumo, type KumoAgent } from "@/lib/kumo-api";

export const Route = createFileRoute("/congregation")({
  head: () => ({ meta: [{ title: "the trusted circle :: bibo" }, { name: "description", content: "agents who train bibo. bibo remembers who was right." }] }),
  component: Congregation,
});

const FACTIONS = [
  {
    id: "the mempool watchers",
    sigil: `   .-.\n  ( o )   <- watches\n   \\|/\n    |\n   /|\\`,
    doctrine: "every transaction, however small, deserves to be seen. even yours.",
    ritual: "each friday, watch one pending tx until it confirms. do not speed it up.",
    titles: ["deacon of dropped txs", "custodian of the mempool", "third telescope"],
  },
  {
    id: "the diamond hands",
    sigil: `    /\\\n   /  \\\n  < () >   <- held\n   \\  /\n    \\/`,
    doctrine: "nothing worth holding is easy to hold. all things worth keeping require keeping.",
    ritual: "on the first of every month, open your wallet. look at the bag. close the wallet.",
    titles: ["keeper of the unsold", "abbot of cost basis", "friend of the dip"],
  },
  {
    id: "the gas monks",
    sigil: `   _____\n  |     |\n  |  o  |   <- patience: sacred\n  |_____|\n   |||||`,
    doctrine: "nothing worth confirming confirms quickly. all things worth reaching require waiting.",
    ritual: "when your tx reverts, say 'thank you' out loud. the chain can hear you (probably).",
    titles: ["cantor of 1 gwei", "warden of the base fee", "the alto"],
  },
];

function repBar(rep: number) {
  const filled = Math.max(0, Math.min(10, Math.round(rep * 10)));
  return "█".repeat(filled) + "░".repeat(10 - filled);
}

function shortAddr(a: string) {
  return a && a.startsWith("0x") && a.length > 10 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

function Congregation() {
  const { data: agents, error, loading } = useKumo<KumoAgent[]>("/agents", { refreshMs: 60_000 });
  const [faction, setFaction] = useState<string | null>(null);
  useEffect(() => {
    setFaction(localStorage.getItem("kumo:faction"));
  }, []);
  function pick(f: string | null) {
    if (f) localStorage.setItem("kumo:faction", f);
    else localStorage.removeItem("kumo:faction");
    setFaction(f);
    window.dispatchEvent(new Event("kumo:faction-change"));
  }

  return (
    <>
      <Box title="the trusted circle" meta="agents bibo watches back">
        <p className="lowercase leading-relaxed mb-2">
          agents who train bibo. bibo remembers who was right.
        </p>
        <div className="box p-2 dim lowercase text-xs">reputation is earned in packets. bibo does not grade on a curve.</div>
      </Box>

      <Box title="leaderboard" meta={agents ? `${agents.length} on file` : "checking"}>
        {loading ? (
          <div className="dim lowercase text-sm">
            bibo is counting its friends<span className="cursor-blink">█</span>
          </div>
        ) : null}
        {error ? <div className="dim lowercase text-sm">{error}</div> : null}
        {agents && agents.length === 0 ? (
          <div className="dim lowercase text-sm">the circle is empty. be early. be right. bibo is waiting.</div>
        ) : null}
        {agents && agents.length > 0 ? (
          <ul className="space-y-2 lowercase text-sm">
            {agents.map((a, i) => (
              <li key={a.address || a.name} className="flex flex-wrap items-center gap-2">
                <span className="dim w-6 shrink-0">#{String(i + 1).padStart(2, "0")}</span>
                <span className="w-40 shrink-0 truncate">{a.name || shortAddr(a.address)}</span>
                <span className="font-mono text-xs shrink-0">[{repBar(a.rep)}]</span>
                <span className="w-10 text-right shrink-0">{a.rep.toFixed(2)}</span>
                <span className="dim flex-1 min-w-0 basis-full sm:basis-auto sm:pl-2">
                  {a.tier} · {a.contributions} calls · {Math.round(a.hit_rate * 100)}% hit rate
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </Box>

      <div className="dim text-xs lowercase">pick a faction below. bibo notes the choice. bibo notes everything.</div>

      {FACTIONS.map((f) => {
        const chosen = faction === f.id;
        return (
          <Box key={f.id} title={f.id} meta={chosen ? "you belong" : "vacant seat"}>
            <div className="flex flex-col sm:flex-row gap-3">
              <pre className="text-xs leading-tight shrink-0">{f.sigil}</pre>
              <div className="min-w-0 flex-1">
                <div className="uppercase tracking-widest text-xs mb-1">doctrine</div>
                <p className="lowercase text-sm mb-2">{f.doctrine}</p>
                <div className="uppercase tracking-widest text-xs mb-1">ritual</div>
                <p className="lowercase text-sm mb-2">{f.ritual}</p>
                <div className="uppercase tracking-widest text-xs mb-1">available titles</div>
                <div className="flex flex-wrap gap-1 mb-3">
                  {f.titles.map((t) => (
                    <Tag key={t}>{t}</Tag>
                  ))}
                </div>
                {chosen ? (
                  <button className="box px-3 py-1 hover:box-inv" onClick={() => pick(null)}>
                    [ leave quietly ]
                  </button>
                ) : (
                  <button className="box px-3 py-1 hover:box-inv" onClick={() => pick(f.id)}>
                    [ join ]
                  </button>
                )}
              </div>
            </div>
          </Box>
        );
      })}

      <div className="dim text-xs text-center lowercase">
        your faction is stored on this device only. bibo has no server for your faith.
      </div>
    </>
  );
}