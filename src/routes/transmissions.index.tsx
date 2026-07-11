import { createFileRoute, Link } from "@tanstack/react-router";
import { Box, Tag } from "@/components/SiteChrome";
import { TRANSMISSIONS } from "@/lib/greenroom-data";

export const Route = createFileRoute("/transmissions/")({
  head: () => ({ meta: [{ title: "transmissions :: green room" }, { name: "description", content: "signals, transmissions, memory leaks, and observer reports." }] }),
  component: List,
});

function List() {
  return (
    <>
      <Box title="transmissions" meta="typed artifacts">
        <p className="lowercase leading-relaxed">
          not a blog. these are what falls off the wires while moss is sweeping. sometimes they're signals. sometimes
          they're memory leaks. one is an observer report. we don't ask which observer.
        </p>
      </Box>
      {TRANSMISSIONS.map((t) => (
        <Link
          key={t.id}
          to="/transmissions/$id"
          params={{ id: t.id }}
          className="block box p-3 hover:box-inv"
        >
          <div className="flex flex-wrap gap-2 items-center text-xs">
            <Tag>{t.type}</Tag>
            <span className="dim">{t.n}</span>
            <span className="dim ml-auto">{t.date}</span>
          </div>
          <div className="mt-1 uppercase tracking-widest text-sm">{t.title}</div>
          <div className="mt-1 text-xs lowercase dim">{t.teaser}</div>
        </Link>
      ))}
    </>
  );
}