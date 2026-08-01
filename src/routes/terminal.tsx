import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Box } from "@/components/SiteChrome";
import { JOBS, MYSTERIES, SIGNALS, CREATURES, FORTUNES } from "@/lib/greenroom-data";
import { kumoFetch, LINES } from "@/lib/kumo-api";

export const Route = createFileRoute("/terminal")({
  head: () => ({ meta: [{ title: "terminal :: bibo@rhc" }, { name: "description", content: "an interactive terminal maintained by bibo." }] }),
  component: Terminal,
});

const HELP = [
  "available commands:",
  "  help       list commands",
  "  about      about bibo",
  "  clear      clear the screen",
  "  ascii      print a creature from the archive",
  "  lore       print a random chain mystery",
  "  jobs       list open jobs",
  "  signal     print a recent chain event",
  "  whoami     ask the chain",
  "  archive    stats from the archive",
  "  fortune    an on-chain fortune",
  "",
  "anything else — just talk. bibo answers.",
  "there is one command i am not listing.",
];

const LOCAL_COMMANDS = new Set([
  "help", "about", "clear", "ascii", "lore", "jobs", "signal", "whoami", "archive", "fortune", "watch",
]);

type Line = { kind: "in" | "out"; text: string };

function pick<T>(xs: readonly T[]): T {
  return xs[Math.floor(Math.random() * xs.length)] as T;
}

function run(cmd: string): string {
  const c = cmd.trim().toLowerCase();
  if (!c) return "";
  switch (c) {
    case "help":
      return HELP.join("\n");
    case "about":
      return "bibo :: v0.9.7-unstable\na tiny on-chain companion on bnb chain. do not ask about wallet 009.";
    case "ascii":
      return pick(CREATURES);
    case "lore": {
      const m = pick(MYSTERIES);
      return `${m.id} [${m.status}]\n${m.q}\n\n${m.body}`;
    }
    case "jobs":
      return JOBS.filter((j) => j.status === "open" && !("locked" in j && j.locked))
        .map((j) => `${j.id}  ${j.diff.padEnd(9)}  reward: ${j.reward}`)
        .join("\n");
    case "signal":
      return pick(SIGNALS);
    case "whoami":
      return "you are a guest of bibo's terminal. the chain has been expecting you (affectionately).";
    case "archive":
      return `mysteries: ${MYSTERIES.length}\nopen jobs: ${JOBS.filter((j) => j.status === "open").length}\ncold wallets: 3 (winston, other, and the one we don't talk about)`;
    case "fortune":
      return pick(FORTUNES);
    case "watch":
      return "* bibo looks up *\n\nyou found the undocumented command. take this: a small green flame,\nkept in the ledger under your block number. you are, quietly, in the book.\n\ntell no one. or do. it's fine either way. bibo saw.";
    case "clear":
      return "__CLEAR__";
    default:
      return `zsh: command not found: ${c}. try 'help'. or don't. bibo is chill.`;
  }
}

function Terminal() {
  const [lines, setLines] = useState<Line[]>([
    { kind: "out", text: "bibo's terminal v0.9.7-unstable" },
    { kind: "out", text: "bibo is listening. type 'help' for commands — or just talk to bibo." },
    { kind: "out", text: "" },
  ]);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [hIdx, setHIdx] = useState<number>(-1);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [lines]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const cmd = input;
    const c = cmd.trim().toLowerCase();
    setHistory((h) => [cmd, ...h]);
    setHIdx(-1);
    setInput("");
    if (!c) return;

    if (LOCAL_COMMANDS.has(c)) {
      const out = run(cmd);
      if (out === "__CLEAR__") setLines([]);
      else setLines((L) => [...L, { kind: "in", text: cmd }, { kind: "out", text: out }, { kind: "out", text: "" }]);
      return;
    }

    // everything else goes straight to bibo
    setLines((L) => [...L, { kind: "in", text: cmd }, { kind: "out", text: LINES.thinking }]);
    let reply: string;
    try {
      const res = await kumoFetch<{ reply: string }>("/chat", {
        method: "POST",
        body: JSON.stringify({ message: cmd }),
        timeoutMs: 20_000,
      });
      reply = res.reply || "bibo said nothing. bibo says a lot by saying nothing.";
    } catch (err) {
      reply = err instanceof Error ? err.message : LINES.retry;
    }
    setLines((L) => {
      const i = L.map((l) => l.text).lastIndexOf(LINES.thinking);
      if (i === -1) return [...L, { kind: "out", text: reply }, { kind: "out", text: "" }];
      const next = [...L];
      next[i] = { kind: "out", text: reply };
      return [...next, { kind: "out", text: "" }];
    });
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      const next = Math.min(hIdx + 1, history.length - 1);
      if (history[next] != null) {
        setHIdx(next);
        setInput(history[next]!);
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = Math.max(hIdx - 1, -1);
      setHIdx(next);
      setInput(next === -1 ? "" : history[next]!);
    }
  }

  return (
    <>
      <Box title="terminal" meta="bibo@rhc">
        <div
          className="bg-black p-3 min-h-[60vh] text-sm cursor-text"
          onClick={() => inputRef.current?.focus()}
        >
          {lines.map((l, i) =>
            l.kind === "in" ? (
              <div key={i}>
                <span className="dim">bibo@rhc:~$</span> {l.text}
              </div>
            ) : (
              <pre key={i} className="whitespace-pre-wrap leading-snug">{l.text}</pre>
            ),
          )}
          <form onSubmit={submit} className="flex gap-2">
            <span className="dim shrink-0">bibo@rhc:~$</span>
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKey}
              autoFocus
              spellCheck={false}
              className="bg-transparent outline-none flex-1"
            />
            <span className="cursor-blink">█</span>
          </form>
          <div ref={endRef} />
        </div>
      </Box>
      <div className="dim text-xs text-center lowercase">↑/↓ for history · 'help' for commands · everything else goes straight to bibo</div>
    </>
  );
}