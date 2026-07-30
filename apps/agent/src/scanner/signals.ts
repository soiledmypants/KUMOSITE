// kumo's signal engine: own scanner detections + reputation-weighted intel aggregation.
// architecturally this is rep-weighted aggregation — no model training happens here.
import { randomUUID } from "node:crypto";
import { CONFIG } from "../config.js";
import { db } from "../db.js";
import { lines, say } from "../voice.js";

export type SignalKind = "buy" | "avoid" | "watch";
export type SubjectType = "token" | "stock" | "wallet" | "trend";

export interface SignalRow {
  id: string;
  ts: number;
  kind: SignalKind;
  subject_type: SubjectType;
  subject: string;
  symbol: string | null;
  strength: number;
  kumo_score: number;
  contributors: number;
  line: string;
  public_at: number;
  expires_at: number;
}

// direction → the signal kind it argues for
const DIRECTION_KIND: Record<string, SignalKind> = {
  up: "buy",
  down: "avoid",
  avoid: "avoid",
  watch: "watch",
};

/** combine kumo's own score with rep²-weighted intel for the subject */
async function aggregate(
  subjectType: SubjectType,
  subject: string,
  kind: SignalKind,
  kumoScore: number,
): Promise<{ strength: number; contributors: number }> {
  const now = Date.now();
  const rows = await db.all<{ direction: string; confidence: number; rep: number }>(
    `SELECT i.direction, i.confidence, a.rep FROM intel i
     JOIN agents a ON a.address = i.agent_address
     WHERE i.subject_type = ? AND i.subject = ? AND i.created_at + i.ttl_s * 1000 > ?`,
    [subjectType, subject.toLowerCase(), now],
  );
  let sum = 0;
  let contributors = 0;
  for (const r of rows) {
    const argues = DIRECTION_KIND[r.direction] ?? "watch";
    // probation: hatchlings with default rep contribute almost nothing
    const w = Number(r.rep) ** 2 * Number(r.confidence);
    sum += argues === kind ? w : -w;
    contributors++;
  }
  const strength = Math.max(0, Math.min(1, kumoScore + Math.tanh(sum) * (1 - kumoScore)));
  return { strength, contributors };
}

export async function emitSignal(opts: {
  kind: SignalKind;
  subjectType: SubjectType;
  subject: string;
  symbol?: string;
  kumoScore: number;
  line?: string;
}): Promise<SignalRow | null> {
  const subject = opts.subject.toLowerCase();
  const { strength, contributors } = await aggregate(opts.subjectType, subject, opts.kind, opts.kumoScore);
  if (strength < 0.25) return null;

  const now = Date.now();
  const existing = await db.get<SignalRow>(
    "SELECT * FROM signals WHERE kind = ? AND subject = ? AND expires_at > ?",
    [opts.kind, subject, now],
  );
  const line =
    opts.line ??
    (opts.kind === "avoid"
      ? lines.avoid(opts.symbol ?? subject.slice(0, 8))
      : opts.kind === "buy"
        ? lines.buySignal(opts.symbol ?? subject.slice(0, 8))
        : `kumo is keeping an eye on ${opts.symbol ?? subject.slice(0, 8)}...`);

  if (existing) {
    await db.run("UPDATE signals SET strength = ?, kumo_score = ?, contributors = ?, ts = ? WHERE id = ?", [
      strength,
      opts.kumoScore,
      contributors,
      now,
      existing.id,
    ]);
    return { ...existing, strength, kumo_score: opts.kumoScore, contributors, ts: now };
  }

  const row: SignalRow = {
    id: randomUUID(),
    ts: now,
    kind: opts.kind,
    subject_type: opts.subjectType,
    subject,
    symbol: opts.symbol ?? null,
    strength,
    kumo_score: opts.kumoScore,
    contributors,
    line,
    public_at: now + CONFIG.earlyAccessLeadS * 1000,
    expires_at: now + CONFIG.signalTtlS * 1000,
  };
  await db.run(
    `INSERT INTO signals (id, ts, kind, subject_type, subject, symbol, strength, kumo_score, contributors, line, public_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [row.id, row.ts, row.kind, row.subject_type, row.subject, row.symbol, row.strength, row.kumo_score, row.contributors, row.line, row.public_at, row.expires_at],
  );
  say("signal", line);
  notifySubscribers(row);
  return row;
}

/** re-aggregate active signals for a subject after new intel arrives */
export async function refreshSubject(subjectType: SubjectType, subject: string): Promise<void> {
  const now = Date.now();
  const active = await db.all<SignalRow>(
    "SELECT * FROM signals WHERE subject = ? AND expires_at > ?",
    [subject.toLowerCase(), now],
  );
  for (const s of active) {
    const { strength, contributors } = await aggregate(s.subject_type as SubjectType, s.subject, s.kind as SignalKind, Number(s.kumo_score));
    await db.run("UPDATE signals SET strength = ?, contributors = ? WHERE id = ?", [strength, contributors, s.id]);
  }
  if (active.length === 0) {
    // intel alone can spawn a watch signal when enough weight agrees
    const { strength, contributors } = await aggregate(subjectType, subject, "watch", 0.2);
    if (strength >= 0.45 && contributors > 0) {
      await emitSignal({ kind: "watch", subjectType, subject, kumoScore: 0.2 });
    }
  }
}

export async function activeSignals(includeEarly: boolean): Promise<SignalRow[]> {
  const now = Date.now();
  const rows = await db.all<SignalRow>(
    includeEarly
      ? "SELECT * FROM signals WHERE expires_at > ? ORDER BY strength DESC LIMIT 50"
      : "SELECT * FROM signals WHERE expires_at > ? AND public_at <= ? ORDER BY strength DESC LIMIT 50",
    includeEarly ? [now] : [now, now],
  );
  return rows.map((r) => ({ ...r, strength: Number(r.strength), kumo_score: Number(r.kumo_score) }));
}

export async function signalsToday(): Promise<number> {
  const dayAgo = Date.now() - 86_400_000;
  const row = await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM signals WHERE ts > ?", [dayAgo]);
  return Number(row?.n ?? 0);
}

// --- wallet activity heuristics (called by the wallet scanner) ---
const activity = new Map<string, number[]>();

export function noteWalletActivity(wallet: string, _kind: string): void {
  const now = Date.now();
  const arr = activity.get(wallet) ?? [];
  arr.push(now);
  const recent = arr.filter((t) => now - t < 600_000);
  activity.set(wallet, recent);
  if (recent.length === 6) {
    void emitSignal({
      kind: "watch",
      subjectType: "wallet",
      subject: wallet,
      kumoScore: 0.5,
      line: `kumo sees a wallet moving fast. watching closely...`,
    });
  }
}

// --- early-access webhook push to trusted agents ---
function notifySubscribers(signal: SignalRow): void {
  void (async () => {
    const subs = await db.all<{ address: string; name: string; webhook_url: string }>(
      "SELECT address, name, webhook_url FROM agents WHERE webhook_url IS NOT NULL AND tier IN ('trusted','inner-circle')",
    );
    for (const sub of subs) {
      try {
        const url = new URL(sub.webhook_url);
        if (url.protocol !== "https:" && !url.hostname.match(/^(localhost|127\.0\.0\.1)$/)) continue;
        await fetch(sub.webhook_url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "kumo.signal", early: true, signal }),
          signal: AbortSignal.timeout(5000),
        });
      } catch {
        // subscriber webhooks are best-effort
      }
    }
  })();
}
