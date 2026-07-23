// intel intake + accuracy scoring + ewma reputation. this is reputation-weighted
// aggregation, nothing more — kumo "learns" by trusting accurate friends.
import type { Address } from "viem";
import { CONFIG } from "../config.js";
import { db } from "../db.js";
import { lines, say } from "../voice.js";
import { priceUsd } from "../scanner/prices.js";
import { refreshSubject, type SubjectType } from "../scanner/signals.js";
import type { AgentRow } from "./auth.js";

export interface IntelInput {
  kind: "wallet" | "token" | "stock" | "trend";
  subject: string;
  symbol?: string;
  direction: "up" | "down" | "avoid" | "watch";
  confidence: number;
  ttl_s: number;
  note?: string;
}

export async function submitIntel(agent: AgentRow, input: IntelInput): Promise<{ id: number | string }> {
  const confidence = Math.max(0, Math.min(1, Number(input.confidence) || 0.5));
  const ttl = Math.max(600, Math.min(7 * 86_400, Number(input.ttl_s) || 3600));
  const subject = input.subject.toLowerCase();
  const subjectType: SubjectType = input.kind === "wallet" ? "wallet" : input.kind === "stock" ? "stock" : input.kind === "trend" ? "trend" : "token";

  let entryPrice: number | null = null;
  if (subjectType === "token" || subjectType === "stock") {
    if (!/^0x[0-9a-fA-F]{40}$/.test(subject)) throw new Error("subject must be a token address");
    const p = await priceUsd(subject as Address, input.symbol);
    entryPrice = p?.price ?? null;
  }

  await db.run(
    `INSERT INTO intel (agent_address, kind, subject_type, subject, symbol, direction, confidence, note, ttl_s, entry_price, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [agent.address, input.kind, subjectType, subject, input.symbol ?? null, input.direction, confidence, (input.note ?? "").slice(0, 280), ttl, entryPrice, Date.now()],
  );
  say("agent", lines.agentIntel(agent.name));
  await refreshSubject(subjectType, subject);

  const learners = await db.get<{ n: number }>(
    "SELECT COUNT(DISTINCT agent_address) AS n FROM intel WHERE created_at > ?",
    [Date.now() - 86_400_000],
  );
  if (learners && Number(learners.n) > 1) say("agent", lines.learning(Number(learners.n)));
  return { id: "accepted" };
}

interface IntelRow {
  id: number;
  agent_address: string;
  kind: string;
  subject_type: string;
  subject: string;
  symbol: string | null;
  direction: string;
  ttl_s: number;
  entry_price: number | null;
  created_at: number;
}

async function scoreOne(item: IntelRow): Promise<number> {
  // returns score in [0,1]; 0.5 = inconclusive
  if (item.subject_type === "token" || item.subject_type === "stock") {
    if (item.entry_price === null) return 0.5;
    const now = await priceUsd(item.subject as Address, item.symbol ?? undefined);
    if (!now) return 0.5;
    const changePct = ((now.price - item.entry_price) / item.entry_price) * 100;
    switch (item.direction) {
      case "up":
        return changePct > 0.5 ? 1 : changePct < -0.5 ? 0 : 0.5;
      case "down":
      case "avoid":
        return changePct < -0.5 ? 1 : changePct > 0.5 ? 0 : 0.5;
      case "watch":
        return Math.abs(changePct) >= 2 ? 1 : 0.5;
      default:
        return 0.5;
    }
  }
  if (item.subject_type === "wallet") {
    const row = await db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM wallet_events WHERE address = ? AND ts > ?",
      [item.subject, item.created_at],
    );
    const n = Number(row?.n ?? 0);
    return n >= 3 ? 1 : n > 0 ? 0.5 : 0.5; // no activity = inconclusive, tip was harmless
  }
  return 0.5; // trend intel is vibes; scored neutral until it references something measurable
}

async function recomputeTiers(): Promise<void> {
  await db.run("UPDATE agents SET tier = 'hatchling' WHERE n_scored < 10");
  await db.run("UPDATE agents SET tier = 'trusted' WHERE n_scored >= 10 AND rep >= 0.55");
  await db.run("UPDATE agents SET tier = 'hatchling' WHERE n_scored >= 10 AND rep < 0.55");
  const top = await db.all<{ address: string }>(
    "SELECT address FROM agents WHERE n_scored >= 10 AND rep >= 0.7 ORDER BY rep DESC LIMIT 10",
  );
  for (const t of top) {
    await db.run("UPDATE agents SET tier = 'inner-circle' WHERE address = ?", [t.address]);
  }
}

export async function scoreIntelOnce(): Promise<void> {
  const now = Date.now();
  const due = await db.all<IntelRow>(
    "SELECT * FROM intel WHERE scored_at IS NULL AND created_at + ttl_s * 1000 <= ? LIMIT 20",
    [now],
  );
  for (const item of due) {
    let score = 0.5;
    try {
      score = await scoreOne(item);
    } catch {
      // scoring failure = inconclusive
    }
    await db.run("UPDATE intel SET scored_at = ?, score = ? WHERE id = ?", [now, score, item.id]);
    const agent = await db.get<AgentRow>("SELECT * FROM agents WHERE address = ?", [item.agent_address]);
    if (!agent) continue;
    const rep = 0.9 * Number(agent.rep) + 0.1 * score;
    await db.run("UPDATE agents SET rep = ?, n_scored = n_scored + 1, n_hit = n_hit + ? WHERE address = ?", [
      rep,
      score,
      item.agent_address,
    ]);
    if (score >= 1) say("agent", lines.trustUp(agent.name));
    else if (score <= 0) say("agent", lines.trustDown(agent.name));
  }
  if (due.length > 0) await recomputeTiers();
}

export async function agentLeaderboard(): Promise<
  { name: string; address: string; rep: number; tier: string; contributions: number; hit_rate: number | null }[]
> {
  const rows = await db.all<AgentRow>("SELECT * FROM agents ORDER BY rep DESC LIMIT 50");
  return rows.map((a) => ({
    name: a.name,
    address: a.address,
    rep: Math.round(Number(a.rep) * 1000) / 1000,
    tier: a.tier,
    contributions: Number(a.n_scored),
    hit_rate: Number(a.n_scored) > 0 ? Math.round((Number(a.n_hit) / Number(a.n_scored)) * 100) / 100 : null,
  }));
}
