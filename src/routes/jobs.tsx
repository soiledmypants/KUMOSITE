import { createFileRoute } from "@tanstack/react-router";
import { Box, Tag } from "@/components/SiteChrome";
import { JOBS } from "@/lib/greenroom-data";

export const Route = createFileRoute("/jobs")({
  head: () => ({ meta: [{ title: "jobs :: green room" }, { name: "description", content: "the green room job board. rewards are nonsense. work is real." }] }),
  component: Jobs,
});

function bar(status: string) {
  const map: Record<string, number> = { open: 0, claimed: 4, complete: 8, hidden: 0 };
  const filled = map[status] ?? 0;
  return "█".repeat(filled) + "░".repeat(8 - filled);
}

function Jobs() {
  return (
    <>
      <Box title="job board" meta="apply within">
        <p className="lowercase leading-relaxed">
          the green room is understaffed on purpose. take a job. do not sign your work. moss will know.
        </p>
      </Box>
      {JOBS.map((j) => (
        <Box key={j.id} title={j.id} meta={`diff: ${j.diff}`}>
          {"locked" in j && j.locked ? (
            <div className="lowercase">
              <Tag>LOCKED</Tag> <span className="dim ml-2">complete JOB-011 to reveal.</span>
            </div>
          ) : (
            <>
              <p className="lowercase text-sm mb-2 leading-relaxed">{j.body}</p>
              <div className="flex flex-wrap gap-3 text-xs lowercase items-center">
                <Tag>{j.status}</Tag>
                <span className="dim">reward:</span>
                <span>{j.reward}</span>
                <span className="ml-auto font-mono">[{bar(j.status)}]</span>
              </div>
            </>
          )}
        </Box>
      ))}
      <div className="dim text-xs text-center lowercase">to claim, whisper the job id into a router. moss will hear.</div>
    </>
  );
}