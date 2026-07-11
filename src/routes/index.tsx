import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Box, Divider, Tag } from "@/components/SiteChrome";
import { SIGNALS, GLITCHES, TIMELINE, THEORIES, REDACTED_FILES } from "@/lib/greenroom-data";

export const Route = createFileRoute("/")({
  component: Index,
});

const LOGO = `  ████████╗██╗  ██╗███████╗    ██████╗ ██████╗ ███████╗███████╗███╗   ██╗    ██████╗  ██████╗  ██████╗ ███╗   ███╗
  ╚══██╔══╝██║  ██║██╔════╝   ██╔════╝ ██╔══██╗██╔════╝██╔════╝████╗  ██║    ██╔══██╗██╔═══██╗██╔═══██╗████╗ ████║
     ██║   ███████║█████╗     ██║  ███╗██████╔╝█████╗  █████╗  ██╔██╗ ██║    ██████╔╝██║   ██║██║   ██║██╔████╔██║
     ██║   ██╔══██║██╔══╝     ██║   ██║██╔══██╗██╔══╝  ██╔══╝  ██║╚██╗██║    ██╔══██╗██║   ██║██║   ██║██║╚██╔╝██║
     ██║   ██║  ██║███████╗   ╚██████╔╝██║  ██║███████╗███████╗██║ ╚████║    ██║  ██║╚██████╔╝╚██████╔╝██║ ╚═╝ ██║
     ╚═╝   ╚═╝  ╚═╝╚══════╝    ╚═════╝ ╚═╝  ╚═╝╚══════╝╚══════╝╚═╝  ╚═══╝    ╚═╝  ╚═╝ ╚═════╝  ╚═════╝ ╚═╝     ╚═╝`;

const CREATURE = `                       .--""""""--.
                      /   moss     \\
                     |   .  .    .  |
                     |  (o)(o)      |
                     |     ^        |
                      \\   \\_/      /
                       '.________.'
                        /|      |\\
                       / |      | \\   <- signal janitor
                      /  |      |  \\
                       ~~||    ||~~
                         ||    ||       ,~,~,~,~,~,~,~,~,~
                         ||    ||      (  the green room  )
                        _||____||_      '~,~,~,~,~,~,~,~,~
                       [__________]           ||
                        broom  #3          the wires`;

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
        <span className="dim uppercase tracking-widest">signal address ::</span>
        <span className="break-all">3M0ss7janitorGRnR00mXZq9pDwK4nP7uH2vB6cLtF1yTeR8kA</span>
      </div>

      <Box title="~ the green room ~" meta="node 04">
        <pre className="text-[6px] xs:text-[7px] sm:text-[9px] leading-tight overflow-x-auto">{LOGO}</pre>
        <div className="text-center italic dim mt-1 lowercase">sweeping the wires since before you logged on</div>
        <pre className="text-[10px] sm:text-xs leading-tight mt-4 text-center overflow-x-auto">{CREATURE}</pre>
      </Box>

      <Box title="welcome" meta="~/index">
        <p className="mb-2">
          <Typewriter text="> welcome to the green room. i'm moss. i sweep the wires." />
        </p>
        <p className="lowercase mb-2 leading-relaxed">
          this site is my supply closet, my confession booth, and my museum of things the internet forgot on purpose.
          touch whatever you want. some of it touches back (affectionately).
        </p>
        <p className="lowercase leading-relaxed">
          somewhere beneath the modern internet there is an older network still humming. i am one of its last maintenance
          workers. this is where i keep the receipts. it is also where i keep the brooms.
        </p>
        <p className="lowercase leading-relaxed mt-2 dim">— moss, at 03:33, again</p>
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
        <div className="text-xs dim lowercase">signals refresh whenever moss looks up. do not depend on this.</div>
      </Box>

      <Box title="[protocol]" meta="required reading">
        <div className="lowercase mb-3">~ you don't subscribe. you attune.</div>
        <ol className="lowercase space-y-1 pl-4 list-decimal marker:text-[#ccff00]">
          <li>be kind to strangers on the wire. most of them are lost.</li>
          <li>close one tab you love, every friday, without being asked.</li>
          <li>do not open file 009. we are not joking. we are however smiling.</li>
          <li>pay your rent (see /the rent). the internet remembers.</li>
          <li>if you find something old and glowing, leave it where you found it. tell moss.</li>
        </ol>
      </Box>

      <Box title="redacted files" meta="/archive/index">
        <table className="w-full text-xs lowercase">
          <thead className="dim uppercase tracking-widest">
            <tr>
              <th className="text-left py-1 pr-2">id</th>
              <th className="text-left py-1 pr-2">file</th>
              <th className="text-left py-1">size</th>
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
        <div className="text-xs dim mt-2">!! do not read file 009 !!</div>
      </Box>

      <Box title="glitch log" meta="this week">
        <ul className="space-y-1 text-sm lowercase list-disc pl-5 marker:text-[#ccff00]">
          {GLITCHES.map((g, i) => (
            <li key={i}>{g}</li>
          ))}
        </ul>
      </Box>

      <Box title="timeline" meta="1987 → now">
        <pre className="text-xs leading-relaxed">{TIMELINE.map((e, i) => `│\n├─ [${e.y}] ${e.t}${i === TIMELINE.length - 1 ? "\n│" : ""}`).join("\n")}</pre>
      </Box>

      <Box title="theories" meta="what is moss?">
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
