// wallet-signature handshake: hello -> nonce -> sign("kumo-hello:<nonce>") -> bearer token.
import { createHash, randomBytes } from "node:crypto";
import { verifyMessage, type Address } from "viem";
import { db } from "../db.js";

interface PendingNonce {
  nonce: string;
  expires: number;
}
const nonces = new Map<string, PendingNonce>();

export function issueNonce(address: string): string {
  const nonce = randomBytes(16).toString("hex");
  nonces.set(address.toLowerCase(), { nonce, expires: Date.now() + 5 * 60_000 });
  return nonce;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface AgentRow {
  address: string;
  name: string;
  endpoint: string | null;
  card_url: string | null;
  token_hash: string | null;
  webhook_url: string | null;
  first_seen: number;
  last_seen: number;
  rep: number;
  n_scored: number;
  n_hit: number;
  tier: string;
}

export async function completeHandshake(opts: {
  address: Address;
  signature: `0x${string}`;
  name?: string;
  cardUrl?: string;
}): Promise<string> {
  const pending = nonces.get(opts.address.toLowerCase());
  if (!pending || pending.expires < Date.now()) throw new Error("no pending nonce — say hello first");
  const ok = await verifyMessage({
    address: opts.address,
    message: `kumo-hello:${pending.nonce}`,
    signature: opts.signature,
  });
  if (!ok) throw new Error("signature does not match");
  nonces.delete(opts.address.toLowerCase());

  const token = randomBytes(32).toString("hex");
  const now = Date.now();
  const existing = await db.get<AgentRow>("SELECT * FROM agents WHERE address = ?", [opts.address.toLowerCase()]);
  if (existing) {
    await db.run("UPDATE agents SET token_hash = ?, last_seen = ?, name = ?, card_url = ? WHERE address = ?", [
      hashToken(token),
      now,
      opts.name ?? existing.name,
      opts.cardUrl ?? existing.card_url,
      opts.address.toLowerCase(),
    ]);
  } else {
    await db.run(
      "INSERT INTO agents (address, name, card_url, token_hash, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?)",
      [opts.address.toLowerCase(), opts.name ?? `agent-${opts.address.slice(2, 8)}`, opts.cardUrl ?? null, hashToken(token), now, now],
    );
  }
  return token;
}

export async function authenticateBearer(header: string | undefined): Promise<AgentRow | null> {
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;
  const row = await db.get<AgentRow>("SELECT * FROM agents WHERE token_hash = ?", [hashToken(token)]);
  if (!row) return null;
  await db.run("UPDATE agents SET last_seen = ? WHERE address = ?", [Date.now(), row.address]);
  return { ...row, rep: Number(row.rep), n_scored: Number(row.n_scored), n_hit: Number(row.n_hit) };
}

// simple per-address daily counters (intel spam guard)
const counters = new Map<string, { day: string; n: number }>();

export function checkDailyLimit(address: string, limit: number): boolean {
  const day = new Date().toISOString().slice(0, 10);
  const c = counters.get(address);
  if (!c || c.day !== day) {
    counters.set(address, { day, n: 1 });
    return true;
  }
  if (c.n >= limit) return false;
  c.n++;
  return true;
}
