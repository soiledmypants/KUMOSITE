import { createFileRoute } from "@tanstack/react-router";
import { Box } from "@/components/SiteChrome";
import { GLOSSARY, CHANGELOG } from "@/lib/greenroom-data";

export const Route = createFileRoute("/protocol")({
  head: () => ({ meta: [{ title: "protocol :: kumo" }, { name: "description", content: "the laws, glossary, and changelog of kumo." }] }),
  component: Protocol,
});

const LAWS = [
  "the green room is a place, not a service. you visit; you do not consume.",
  "you don't subscribe. you attune.",
  "packets are people, kind of. treat them as such.",
  "close one tab you love every friday. it is a small offering.",
  "do not open file 009.",
  "if you find a webring, add a link. take a link. leave a link. the ring is not yours; you are the ring's.",
  "keep it lowercase. capitals are for headings and emergencies.",
  "moss is not a mascot. moss is a coworker.",
  "when in doubt, sweep.",
];

function Protocol() {
  return (
    <>
      <Box title="the protocol" meta="v0.9.7-unstable">
        <p className="lowercase leading-relaxed">
          this is the whole thing. the laws, the words we use, and the log of how we got here. moss revises it in
          pencil, mostly.
        </p>
      </Box>
      <Box title="laws of the green room" meta={`${LAWS.length} entries`}>
        <ol className="lowercase space-y-1 pl-6 list-decimal marker:text-[#ccff00]">
          {LAWS.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ol>
      </Box>
      <Box title="glossary" meta="terms in use">
        <dl className="space-y-2 text-sm lowercase">
          {GLOSSARY.map(([w, d]) => (
            <div key={w}>
              <dt className="uppercase tracking-widest text-xs">{w}</dt>
              <dd className="dim">— {d}</dd>
            </div>
          ))}
        </dl>
      </Box>
      <Box title="changelog" meta="pencil edits">
        <ul className="space-y-1 text-sm lowercase">
          {CHANGELOG.map(([v, d, n]) => (
            <li key={v} className="flex flex-wrap gap-2">
              <span className="box-inv px-1 text-[10px] uppercase tracking-widest">{v}</span>
              <span className="dim shrink-0">{d}</span>
              <span className="flex-1 min-w-0">{n}</span>
            </li>
          ))}
        </ul>
      </Box>
    </>
  );
}