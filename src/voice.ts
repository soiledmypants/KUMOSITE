// every line kumo says goes through here. lowercase, cute, terminal.
import { pushFeed } from "./feed.js";

export type FeedKind =
  | "wake"
  | "watch"
  | "move"
  | "signal"
  | "agent"
  | "trade"
  | "stake"
  | "chat"
  | "zzz";

export function say(kind: FeedKind, line: string): void {
  const stamped = line.toLowerCase().startsWith("kumo") || line.startsWith("the ") || line.startsWith("...")
    ? line
    : `kumo ${line}`;
  console.log(`[kumo] ${stamped}`);
  pushFeed(kind, stamped);
}

export const lines = {
  awake: () => "kumo is awake.",
  sleeping: () => "kumo is going to sleep. see you soon.",
  watching: (n: number) =>
    n === 0
      ? "kumo is watching the chain, but no wallets yet..."
      : `kumo is watching ${n} wallet${n === 1 ? "" : "s"}...`,
  newWallet: (label: string) => `kumo is watching a new wallet... hello, ${label}.`,
  droppedWallet: (label: string) => `kumo waved goodbye to ${label}.`,
  bigMove: (label: string, what: string) => `kumo saw ${label} move. ${what}`,
  stockWaking: (sym: string) => `kumo noticed ${sym}-token waking up...`,
  stockSleeping: () => "the stock market is sleeping. kumo naps too.",
  newPool: (sym: string) => `kumo found a brand new pool: ${sym}. sniffing it...`,
  avoid: (sym: string) => `kumo says avoid this one. (${sym})`,
  buySignal: (sym: string) => `kumo found something interesting: ${sym}.`,
  foundTrade: () => "kumo found a trade.",
  tradeDone: (sum: string) => `kumo made a trade. ${sum}`,
  quote: (sum: string) => `kumo priced it out: ${sum}`,
  agentHello: (name: string) => `kumo is talking to another agent... hi, ${name}.`,
  agentIntel: (name: string) => `kumo is thinking about what ${name} said...`,
  learning: (n: number) => `kumo is learning from ${n} agent${n === 1 ? "" : "s"}...`,
  trustUp: (name: string) => `kumo trusts ${name} a little more now.`,
  trustDown: (name: string) => `kumo is a little disappointed in ${name}...`,
  staking: (sum: string) => `kumo fed the staking pool. ${sum}`,
  keeperSkip: (why: string) => `kumo checked the pool but ${why}`,
  err: (what: string) => `kumo bonked its head on something. (${what})`,
};
