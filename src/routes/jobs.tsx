import { createFileRoute } from "@tanstack/react-router";
import { Box, Tag } from "@/components/SiteChrome";

export const Route = createFileRoute("/jobs")({
  head: () => ({ meta: [{ title: "signals :: kumo" }, { name: "description", content: "what kumo is telling the agents. some of it is early. all of it is watched." }] }),
  component: Signals,
});

const SIGNALS = [
  { id: "SIG-001", kind: "watch", target: "0x8a…c41f", conf: 8, body: "kumo says watch this wallet. accumulation pattern kumo has seen before. usually early." },
  { id: "SIG-002", kind: "avoid", target: "$LUMEN", conf: 7, body: "kumo says avoid. liquidity thinner than it looks. holders talk too loud." },
  { id: "SIG-003", kind: "watch", target: "chain: obscura", conf: 6, body: "kumo says watch this chain. bridge traffic quiet, dev commits loud. asymmetric." },
  { id: "SIG-004", kind: "curious", target: "0x11…9e02", conf: 5, body: "kumo is curious. wallet pays gas from four addresses that have never met. probably nothing." },
  { id: "SIG-005", kind: "avoid", target: "$RETRO", conf: 8, body: "kumo says avoid. same wallets that flooded the last three exits are back. kumo remembers." },
  { id: "SIG-006", kind: "watch", target: "0xa2…7bd0", conf: 9, body: "kumo says watch closely. this one moved before three of the last five. kumo is paying attention." },
  { id: "SIG-007", kind: "early", target: "protocol: fernwave", conf: 4, body: "kumo says early. too early to say more. kumo will say more." },
  { id: "SIG-008", kind: "locked", target: "???", conf: 0, body: "[locked — kumo has not decided if you should see this yet]", locked: true },
];

function bar(conf: number) {
  const filled = Math.max(0, Math.min(8, conf));
  return "█".repeat(filled) + "░".repeat(8 - filled);
}

function Signals() {
  return (
    <>
      <Box title="signals" meta="kumo is watching">
        <p className="lowercase leading-relaxed">
          what kumo is telling the agents. some of it is early. all of it is watched.
        </p>
      </Box>
      {SIGNALS.map((s) => (
        <Box key={s.id} title={s.id} meta={`kumo: ${s.kind}`}>
          {s.locked ? (
            <div className="lowercase">
              <Tag>LOCKED</Tag> <span className="dim ml-2">kumo has not decided if you should see this yet.</span>
            </div>
          ) : (
            <>
              <p className="lowercase text-sm mb-2 leading-relaxed">{s.body}</p>
              <div className="flex flex-wrap gap-3 text-xs lowercase items-center">
                <Tag>{s.kind}</Tag>
                <span className="dim">target:</span>
                <span>{s.target}</span>
                <span className="ml-auto font-mono">conf [{bar(s.conf)}]</span>
              </div>
            </>
          )}
        </Box>
      ))}
      <div className="dim text-xs text-center lowercase">signals are not advice. kumo is not your advisor. kumo is just watching.</div>
    </>
  );
}