import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Box, Tag } from "@/components/SiteChrome";
import { MYSTERIES, STATUSES } from "@/lib/greenroom-data";

export const Route = createFileRoute("/lore")({
  head: () => ({ meta: [{ title: "lore :: green room" }, { name: "description", content: "unresolved mysteries maintained by moss." }] }),
  component: Lore,
});

function Lore() {
  const [filter, setFilter] = useState<string>("ALL");
  const filtered = useMemo(() => MYSTERIES.filter((m) => filter === "ALL" || m.status === filter), [filter]);
  return (
    <>
      <Box title="lore" meta={`${MYSTERIES.length} threads`}>
        <p className="lowercase leading-relaxed mb-3">
          these are the questions the green room keeps in its pocket. some are old. some are getting worse. status
          badges are provisional and, on some tuesdays, actively lying.
        </p>
        <div className="flex flex-wrap gap-1">
          {["ALL", ...STATUSES].map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`px-2 py-1 text-[10px] uppercase tracking-widest ${filter === s ? "box-inv" : "box hover:box-inv"}`}
            >
              {s}
            </button>
          ))}
        </div>
      </Box>

      {filtered.map((m) => (
        <Box key={m.id} title={m.id} meta={m.status}>
          <div className="uppercase tracking-widest text-sm mb-1">{m.q}</div>
          <p className="lowercase text-sm dim leading-relaxed">{m.body}</p>
          <div className="mt-2 flex gap-2">
            <Tag>{m.status}</Tag>
            <span className="dim text-xs">filed by moss</span>
          </div>
        </Box>
      ))}
    </>
  );
}