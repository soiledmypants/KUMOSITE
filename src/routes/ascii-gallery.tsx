import { createFileRoute } from "@tanstack/react-router";
import { Box, Tag } from "@/components/SiteChrome";
import { ASCII_PIECES } from "@/lib/greenroom-data";

export const Route = createFileRoute("/ascii-gallery")({
  head: () => ({ meta: [{ title: "ascii gallery :: green room" }, { name: "description", content: "framed ascii pieces, curated by moss." }] }),
  component: Gallery,
});

function Gallery() {
  return (
    <>
      <Box title="ascii gallery" meta="wing 04">
        <p className="lowercase leading-relaxed">framed. cataloged. dusted (weekly). do not touch the ascii.</p>
      </Box>
      {ASCII_PIECES.map((p) => {
        const onLoan = "onLoan" in p && p.onLoan;
        return (
          <Box key={p.id} title={p.title} meta={p.id}>
            <div className="box p-3">
              {onLoan ? (
                <div className="min-h-[120px] flex items-center justify-center dim lowercase text-xs italic">
                  [ on loan — placard reads: 'it will return when it is ready.' ]
                </div>
              ) : (
                <pre className="text-xs sm:text-sm leading-tight overflow-x-auto">{p.art}</pre>
              )}
            </div>
            <div className="flex justify-between mt-2 text-xs lowercase">
              <span className="dim">artist: {p.artist}</span>
              {onLoan ? <Tag>ON LOAN</Tag> : <Tag tone="off">acc. {p.id}</Tag>}
            </div>
          </Box>
        );
      })}
    </>
  );
}