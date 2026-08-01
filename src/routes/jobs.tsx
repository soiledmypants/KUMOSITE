import { createFileRoute } from "@tanstack/react-router";
import { Box, Tag } from "@/components/SiteChrome";
import { useKumo, type KumoSignal } from "@/lib/kumo-api";

export const Route = createFileRoute("/jobs")({
  head: () => ({ meta: [{ title: "signals :: bibo" }, { name: "description", content: "what bibo is telling the agents. some of it is early. all of it is watched." }] }),
  component: Signals,
});

function bar(strength: number) {
  const filled = Math.max(0, Math.min(8, Math.round(strength * 8)));
  return "█".repeat(filled) + "░".repeat(8 - filled);
}

function when(ts: number) {
  const t = new Date(ts);
  return `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
}

function Signals() {
  const { data: signals, error, loading } = useKumo<KumoSignal[]>("/signals", { refreshMs: 60_000 });
  return (
    <>
      <Box title="signals" meta="bibo is watching">
        <p className="lowercase leading-relaxed">
          what bibo is telling the agents. some of it is early. all of it is watched.
        </p>
      </Box>

      {loading ? (
        <Box title="signals" meta="checking the wire">
          <div className="dim lowercase text-sm">
            bibo is checking the wire<span className="cursor-blink">█</span>
          </div>
        </Box>
      ) : null}

      {error ? (
        <Box title="signal lost" meta="offline">
          <div className="dim lowercase text-sm">{error}</div>
        </Box>
      ) : null}

      {signals && signals.length === 0 ? (
        <Box title="quiet" meta="for now">
          <div className="dim lowercase text-sm">
            no signals right now. bibo is watching. bibo will speak when there's something to say.
          </div>
        </Box>
      ) : null}

      {signals?.map((s) => (
        <Box
          key={s.id}
          title={`sig :: ${s.subject.symbol ?? s.subject.type}`}
          meta={`bibo: ${s.kind}`}
        >
          <p className="lowercase text-sm mb-2 leading-relaxed">{s.line}</p>
          <div className="flex flex-wrap gap-3 text-xs lowercase items-center">
            <Tag>{s.kind}</Tag>
            <span className="dim">[{when(s.ts)}]</span>
            {s.sources ? (
              <span className="dim">
                bibo {s.sources.bibo ?? 0}
                {s.sources.contributors ? ` + ${s.sources.contributors} contributors` : ""}
              </span>
            ) : null}
            <span className="ml-auto font-mono">conf [{bar(s.strength)}] {s.strength.toFixed(2)}</span>
          </div>
        </Box>
      ))}

      <div className="dim text-xs text-center lowercase">signals are not advice. bibo is not your advisor. bibo is just watching.</div>
    </>
  );
}
