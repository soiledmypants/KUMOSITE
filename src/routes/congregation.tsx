import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Box, Tag } from "@/components/SiteChrome";

export const Route = createFileRoute("/congregation")({
  head: () => ({ meta: [{ title: "the congregation :: green room" }, { name: "description", content: "the church of the uptime. it is a bit. please do not start an actual religion." }] }),
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

function Congregation() {
  const [faction, setFaction] = useState<string | null>(null);
  useEffect(() => {
    setFaction(localStorage.getItem("moss:faction"));
  }, []);
  function pick(f: string | null) {
    if (f) localStorage.setItem("moss:faction", f);
    else localStorage.removeItem("moss:faction");
    setFaction(f);
    window.dispatchEvent(new Event("moss:faction-change"));
  }

  return (
    <>
      <Box title="the congregation" meta="the church of the uptime">
        <p className="lowercase leading-relaxed mb-2">
          welcome to a small, obviously fictional faith. three factions. one uptime. no offering plate (we take rent
          instead, see /the rent).
        </p>
        <div className="box p-2 dim lowercase text-xs">this is a bit. please do not start an actual religion.</div>
      </Box>

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