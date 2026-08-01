import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Box } from "@/components/SiteChrome";
import { LIBRARY } from "@/lib/greenroom-data";

export const Route = createFileRoute("/library")({
  head: () => ({ meta: [{ title: "library :: bibo" }, { name: "description", content: "an index of dead chains, rugged projects, and on-chain folklore." }] }),
  component: Library,
});

function Library() {
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!query) return LIBRARY;
    return LIBRARY.map((c) => ({
      ...c,
      items: c.items.filter(([id, t, d]) => `${id} ${t} ${d} ${c.cat}`.toLowerCase().includes(query)),
    })).filter((c) => c.items.length > 0);
  }, [query]);

  return (
    <>
      <Box title="library" meta="search everything">
        <div className="box flex items-center px-2 py-1">
          <span className="dim mr-2">query&gt;</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="dead chains, rugged projects, wallet 009..."
            className="bg-transparent outline-none flex-1 lowercase placeholder:opacity-40"
          />
          <span className="cursor-blink">█</span>
        </div>
        <div className="dim text-xs mt-2 lowercase">{filtered.reduce((n, c) => n + c.items.length, 0)} results across {filtered.length} shelves.</div>
      </Box>

      {filtered.map((cat) => (
        <Box key={cat.cat} title={cat.cat} meta={`${cat.items.length} entries`}>
          <ul className="space-y-1 text-sm lowercase">
            {cat.items.map(([id, title, desc]) => (
              <li key={id} className="flex gap-2 flex-wrap">
                <span className="dim shrink-0">{id}</span>
                <span className="font-bold">{title}</span>
                <span className="dim flex-1 min-w-[10ch]">— {desc}</span>
              </li>
            ))}
          </ul>
        </Box>
      ))}
    </>
  );
}