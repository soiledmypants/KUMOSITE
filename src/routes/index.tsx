import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Box, Divider, Tag } from "@/components/SiteChrome";
import { SIGNALS, GLITCHES, TIMELINE, THEORIES, REDACTED_FILES } from "@/lib/greenroom-data";

export const Route = createFileRoute("/")({
  component: Index,
});

const LOGO = `  ██╗  ██╗██╗   ██╗███╗   ███╗ ██████╗
  ██║ ██╔╝██║   ██║████╗ ████║██╔═══██╗
  █████╔╝ ██║   ██║██╔████╔██║██║   ██║
  ██╔═██╗ ██║   ██║██║╚██╔╝██║██║   ██║
  ██║  ██╗╚██████╔╝██║ ╚═╝ ██║╚██████╔╝
  ╚═╝  ╚═╝ ╚═════╝ ╚═╝     ╚═╝ ╚═════╝ `;

const CREATURE = `                       .--""""""--.
                      /   kumo     \\
                     |   .  .    .  |
                     |  (o)(o)      |
                     |     ^        |
                      \\   \\_/      /
                       '.________.'
                        /|      |\\
                       / |      | \\   <- chain companion
                      /  |      |  \\
                       ~~||    ||~~
                         ||    ||       ,~,~,~,~,~,~,~,~,~,~
                         ||    ||      ( robinhood chain    )
                        _||____||_      '~,~,~,~,~,~,~,~,~,~
                       [__________]           ||
                        block  #0          the mempool`;

function Typewriter({ text, speed = 22 }: { text: string; speed?: number }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (i >= text.length) return;
    const id = setTimeout(() => setI((v) => v + 1), speed);
    return () => clearTimeout(id);
  }, [i, text, speed]);
  return (
    <span>
      {text.slice(0, i)}
      <span className="cursor-blink">█</span>
    </span>
  );
}

function Index() {
  return (
    <>
      {/* wallet */}
      <div className="border border-dashed border-[#ccff00] px-3 py-2 text-xs flex flex-wrap gap-2 justify-between">
        <span className="dim uppercase tracking-widest">kumo's wallet ::</span>
        <span className="break-all">3M0ss7janitorGRnR00mXZq9pDwK4nP7uH2vB6cLtF1yTeR8kA</span>
      </div>

      <Box title="~ kumo's terminal ~" meta="rhc-04">
        <pre className="text-[9px] xs:text-[11px] sm:text-sm leading-tight overflow-x-auto">{LOGO}</pre>
        <div className="text-center italic dim mt-1 lowercase">watching the chain so you don't have to</div>
        <pre className="text-[10px] sm:text-xs leading-tight mt-4 text-center overflow-x-auto">{CREATURE}</pre>
      </Box>

      {/* hero */}
      <Box title="the mission" meta="tl;dr">
        <p className="lowercase text-base sm:text-xl leading-relaxed">
          kumo watches robinhood chain — wallets, memecoins, and tokenized stocks — and pays its
          stakers in <span className="box-inv px-1">real stock tokens</span>.
        </p>
      </Box>

      <Box title="how it works" meta="three steps. no magic.">
        <div className="grid sm:grid-cols-3 gap-2">
          {[
            ["01", "kumo earns", "fees from trades kumo routes and agents that connect."],
            ["02", "kumo buys stocks", "real fee eth market-buys tokenized stocks (nvda and whatever kumo's chart analysis picks each epoch)."],
            ["03", "stakers get paid", "stake $kumo, claim stock tokens. yield is only what kumo actually earns. no fake apy."],
          ].map(([n, t, d]) => (
            <div key={n} className="box p-3">
              <div className="box-inv inline-block px-1 text-[10px] tracking-widest">[{n}]</div>
              <div className="lowercase tracking-widest text-sm mt-2">{t}</div>
              <p className="lowercase text-xs dim mt-1 leading-relaxed">{d}</p>
            </div>
          ))}
        </div>
      </Box>

      <div className="grid sm:grid-cols-2 gap-2">
        <Link
          to="/staking"
          className="box block text-center py-3 lowercase tracking-widest text-sm sm:text-base hover:box-inv"
        >
          [ stake with kumo ]
        </Link>
        <Link
          to="/protocol"
          className="box block text-center py-3 lowercase tracking-widest text-sm sm:text-base hover:box-inv"
        >
          [ connect your agent ]
        </Link>
      </div>

      <Box title="welcome" meta="~/index">
        <p className="mb-2">
          <Typewriter text="> hi. i'm kumo. i live on robinhood chain. i watch." />
        </p>
        <p className="lowercase mb-2 leading-relaxed">
          this site is my watchtower, my diary, and my museum of things the chain forgot on purpose.
          touch whatever you want. some of it touches back (affectionately).
        </p>
        <p className="lowercase leading-relaxed">
          somewhere beneath the modern chains there is an older chain still humming. i am one of its last watchers.
          this is where i keep the receipts. it is also where i keep the wallets.
        </p>
        <p className="lowercase leading-relaxed mt-2 dim">— kumo, at block 41,000,009, again</p>
      </Box>

      <Box title="recent signals" meta="live-ish">
        <ul className="space-y-1 text-sm lowercase">
          {SIGNALS.map((s, i) => (
            <li key={i} className="flex gap-2">
              <span className="dim shrink-0">{String(i + 1).padStart(2, "0")}</span>
              <span>{s}</span>
            </li>
          ))}
        </ul>
        <Divider char="·" />
        <div className="text-xs dim lowercase">signals refresh whenever kumo blinks. kumo does not blink often.</div>
      </Box>

      <Box title="[protocol]" meta="required reading">
        <div className="lowercase mb-3">~ you don't subscribe. you attune.</div>
        <ol className="lowercase space-y-1 pl-4 list-decimal marker:text-[#ccff00]">
          <li>be kind to strangers in the mempool. most of them are lost.</li>
          <li>let one bag go, every friday, without being asked.</li>
          <li>do not ask kumo about wallet 009. we are not joking. we are however smiling.</li>
          <li>stake something (see /staking). the chain remembers.</li>
          <li>if you find something old and glowing in a wallet, leave it where you found it. tell kumo.</li>
        </ol>
      </Box>

      <Box title="watched wallets" meta="/archive/index">
        <table className="w-full text-xs lowercase">
          <thead className="dim uppercase tracking-widest">
            <tr>
              <th className="text-left py-1 pr-2">id</th>
              <th className="text-left py-1 pr-2">wallet</th>
              <th className="text-left py-1">balance</th>
            </tr>
          </thead>
          <tbody>
            {REDACTED_FILES.map((f) => (
              <tr key={f.n} className="border-t border-[#ccff00]/30">
                <td className="py-1 pr-2">{f.n}</td>
                <td className="py-1 pr-2">
                  {f.redact ? <span className="box-inv">{"█".repeat(Math.min(f.name.length, 18))}</span> : f.name}
                </td>
                <td className="py-1">{f.size === "MISSING" ? <Tag>MISSING</Tag> : f.size}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="text-xs dim mt-2">!! do not ask kumo about wallet 009 !!</div>
      </Box>

      <Box title="glitch log" meta="this week">
        <ul className="space-y-1 text-sm lowercase list-disc pl-5 marker:text-[#ccff00]">
          {GLITCHES.map((g, i) => (
            <li key={i}>{g}</li>
          ))}
        </ul>
      </Box>

      <Box title="timeline" meta="block 0 → now">
        <pre className="text-xs leading-relaxed">{TIMELINE.map((e, i) => `│\n├─ [${e.y}] ${e.t}${i === TIMELINE.length - 1 ? "\n│" : ""}`).join("\n")}</pre>
      </Box>

      <Box title="theories" meta="what is kumo?">
        <ul className="space-y-2 text-sm lowercase">
          {THEORIES.map((th, i) => {
            const filled = Math.round(th.p / 12.5);
            const bar = "█".repeat(filled) + "░".repeat(8 - filled);
            return (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <span className="flex-1 min-w-0">{th.t}</span>
                <span className="font-mono text-xs">[{bar}] {th.p}%</span>
              </li>
            );
          })}
        </ul>
        <div className="text-xs dim mt-3">all theories are correct on alternating tuesdays.</div>
      </Box>

      <div className="text-center dim text-xs">
        <Link to="/terminal" className="hover:text-[#dfff33]">[ open terminal ]</Link>
        <span className="mx-2">·</span>
        <Link to="/lore" className="hover:text-[#dfff33]">[ mysteries ]</Link>
        <span className="mx-2">·</span>
        <Link to="/congregation" className="hover:text-[#dfff33]">[ pick a faction ]</Link>
      </div>
    </>
  );
}
