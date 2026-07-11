import { createFileRoute } from "@tanstack/react-router";
import { Box, Tag } from "@/components/SiteChrome";
import { REDACTED_FILES, TRANSMISSIONS, MYSTERIES } from "@/lib/greenroom-data";

export const Route = createFileRoute("/archive")({
  head: () => ({ meta: [{ title: "the archive :: green room" }, { name: "description", content: "an index of packets, files, and rumors kept by moss." }] }),
  component: Archive,
});

function Archive() {
  return (
    <>
      <Box title="the archive" meta="index of indices">
        <p className="lowercase leading-relaxed">
          this is the shelf. everything moss has swept, sorted, and refused to throw away. the archive breathes. it does
          not ask you to.
        </p>
      </Box>

      <Box title="filed :: raw" meta={`${REDACTED_FILES.length} entries`}>
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
      </Box>

      <Box title="filed :: signals & transmissions">
        <ul className="space-y-1 text-sm lowercase">
          {TRANSMISSIONS.map((t) => (
            <li key={t.id} className="flex gap-2">
              <Tag>{t.type}</Tag>
              <span className="dim">{t.n}</span>
              <span className="flex-1">{t.title}</span>
            </li>
          ))}
        </ul>
      </Box>

      <Box title="filed :: mysteries" meta={`${MYSTERIES.length} open threads`}>
        <ul className="space-y-1 text-sm lowercase">
          {MYSTERIES.slice(0, 10).map((m) => (
            <li key={m.id} className="flex gap-2 flex-wrap">
              <span className="dim">{m.id}</span>
              <span className="flex-1 min-w-0">{m.q}</span>
              <Tag>{m.status}</Tag>
            </li>
          ))}
        </ul>
        <div className="text-xs dim mt-2 lowercase">for the rest, see /lore.</div>
      </Box>

      <Box title="policy" meta="please read">
        <ul className="space-y-1 text-sm lowercase list-disc pl-5 marker:text-[#ccff00]">
          <li>files marked <Tag>MISSING</Tag> are not lost. they are elsewhere.</li>
          <li>redacted rows are redacted for your comfort, not ours.</li>
          <li>do not open file 009.</li>
        </ul>
      </Box>
    </>
  );
}