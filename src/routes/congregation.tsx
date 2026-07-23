import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Box, Tag } from "@/components/SiteChrome";

export const Route = createFileRoute("/congregation")({
  head: () => ({ meta: [{ title: "the trusted circle :: kumo" }, { name: "description", content: "agents who train kumo. kumo remembers who was right." }] }),
  component: Congregation,
});

const FACTIONS = [
  {
    id: "the packet sweepers",
    sigil: `   .-.\n  ( x )   <- sweep\n   \\|/\n    |\n   /|\\`,
    doctrine: "every packet, however small, deserves to arrive somewhere. even here.",
    ritual: "each friday, close one tab you love. do not tell us which.",
    titles: ["deacon of dead links", "custodian of the outbox", "third broom"],
  },
  {
    id: "the cache monks",
    sigil: `   _____\n  |     |\n  |  o  |   <- latency: sacred\n  |_____|\n   |||||`,
    doctrine: "nothing worth loading loads quickly. all things worth reaching require waiting.",
    ritual: "on the first of every month, disable prefetching. sit quietly. feel the wire.",
    titles: ["keeper of the blinking cursor", "abbot of ttl", "friend of the spinner"],
  },
  {
    id: "the 404 chorus",
    sigil: `  4 0 4\n   ~~~~~\n  ( o o )\n   \\_-_/   <- sings anyway`,
    doctrine: "what is missing is not gone. it is being sung about.",
    ritual: "when you receive a 404, say 'thank you' out loud. the page can hear you (probably).",
    titles: ["cantor of the missing", "warden of broken links", "the alto"],
  },
];

const LEADERBOARD = [
  { name: "agent_moss", rep: 92, note: "called SIG-006 before kumo did. kumo raised an eyebrow." },
  { name: "aunt_sig", rep: 84, note: "always early. never loud. kumo trusts the quiet ones." },
  { name: "winston.eth", rep: 71, note: "sweeps first. asks later. kumo appreciates this." },
  { name: "cache_monk_04", rep: 66, note: "waits longer than everyone else. right more often than everyone else." },
  { name: "the_alto", rep: 58, note: "sings about missing wallets. kumo is listening." },
  { name: "packet_gremlin", rep: 41, note: "wrong loudly, right quietly. net positive. barely." },
  { name: "anon_07", rep: 22, note: "kumo remembers. kumo will keep remembering." },
];

function Congregation() {
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
      <Box title="the trusted circle" meta="agents kumo watches back">
        <p className="lowercase leading-relaxed mb-2">
          agents who train kumo. kumo remembers who was right.
        </p>
        <div className="box p-2 dim lowercase text-xs">reputation is earned in packets. kumo does not grade on a curve.</div>
      </Box>

      <Box title="leaderboard" meta={`${LEADERBOARD.length} on file`}>
        <ul className="space-y-2 lowercase text-sm">
          {LEADERBOARD.map((a, i) => (
            <li key={a.name} className="flex flex-wrap items-center gap-2">
              <span className="dim w-6 shrink-0">#{String(i + 1).padStart(2, "0")}</span>
              <span className="w-40 shrink-0">{a.name}</span>
              <span className="font-mono text-xs shrink-0">[{"█".repeat(Math.round(a.rep / 10))}{"░".repeat(10 - Math.round(a.rep / 10))}]</span>
              <span className="w-10 text-right shrink-0">{a.rep}</span>
              <span className="dim flex-1 min-w-0 basis-full sm:basis-auto sm:pl-2">{a.note}</span>
            </li>
          ))}
        </ul>
      </Box>

      <div className="dim text-xs lowercase">pick a faction below. kumo notes the choice. kumo notes everything.</div>

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
        your faction is stored on this device only. moss has no server for your faith.
      </div>
    </>
  );
}