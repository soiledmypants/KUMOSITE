// the unified ledger: one place every on-chain action shows up — kumo's own
// txs (buybacks, reward funding, trades) and txs reported by sibling bots via
// POST /ledger. every NEW entry also emits a kumo-voice feed line, so the live
// feed and the ledger stay in sync automatically. deduped on tx hash.
import { LEDGER_KINDS, type LedgerKind } from "@kumo/shared";
import { db } from "./db.js";
import { txUrl } from "./config.js";
import { say, type FeedKind } from "./voice.js";

export { LEDGER_KINDS, type LedgerKind };

export interface LedgerInput {
  ts?: number;
  kind: LedgerKind;
  txHash: string;
  chainExplorerUrl?: string;
  assetIn?: string;
  amountIn?: string | number;
  assetOut?: string;
  amountOut?: string | number;
  from?: string;
  to?: string;
  source?: string; // "kumo" | "claimer" | "ops" | ...
  note?: string; // kumo-voice one-liner; generated from kind when omitted
}

export interface LedgerRow {
  id: number;
  ts: number;
  kind: LedgerKind;
  txHash: string;
  chainExplorerUrl: string;
  assetIn: string | null;
  amountIn: string | null;
  assetOut: string | null;
  amountOut: string | null;
  from: string | null;
  to: string | null;
  source: string;
  note: string;
}

const FEED_KIND: Record<LedgerKind, FeedKind> = {
  claim: "move",
  forward: "move",
  buyback: "stake",
  reward_fund: "stake",
  trade: "trade",
  airdrop: "move",
};

function fmtAmount(v: string | number | undefined): string {
  if (v === undefined || v === null || v === "") return "";
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

function defaultNote(e: LedgerInput): string {
  const inStr = `${fmtAmount(e.amountIn)} ${e.assetIn ?? ""}`.trim();
  const outStr = `${fmtAmount(e.amountOut)} ${e.assetOut ?? ""}`.trim();
  switch (e.kind) {
    case "claim":
      return `kumo collected its allowance. ${inStr || "a little something"}.`;
    case "forward":
      return `kumo passed ${inStr || "funds"} along to where they belong.`;
    case "buyback":
      return `kumo bought ${outStr || "something nice"} for the stakers.`;
    case "reward_fund":
      return `kumo fed the staking pool. ${outStr || "rewards incoming"}.`;
    case "trade":
      return inStr && outStr ? `kumo made a trade. ${inStr} became ${outStr}.` : `kumo made a trade.`;
    case "airdrop":
      return `kumo sent presents. ${outStr || "little gifts"}.`;
  }
}

export function validateLedgerInput(body: Record<string, unknown>): LedgerInput {
  const kind = String(body.kind ?? "");
  if (!LEDGER_KINDS.includes(kind as LedgerKind)) {
    throw new Error(`kind must be one of: ${LEDGER_KINDS.join(", ")}`);
  }
  const txHash = String(body.txHash ?? "");
  if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) throw new Error("txHash must be 0x + 64 hex chars");
  const str = (k: string, max = 120): string | undefined => {
    const v = body[k];
    if (v === undefined || v === null || v === "") return undefined;
    return String(v).slice(0, max);
  };
  const ts = Number(body.ts ?? Date.now());
  return {
    ts: Number.isFinite(ts) && ts > 0 ? ts : Date.now(),
    kind: kind as LedgerKind,
    txHash,
    chainExplorerUrl: str("chainExplorerUrl", 300),
    assetIn: str("assetIn", 20),
    amountIn: str("amountIn", 40),
    assetOut: str("assetOut", 20),
    amountOut: str("amountOut", 40),
    from: str("from", 64),
    to: str("to", 64),
    source: str("source", 40) ?? "external",
    note: str("note", 220),
  };
}

export async function recordLedger(e: LedgerInput): Promise<{ recorded: boolean; duplicate: boolean }> {
  const existing = await db.get("SELECT id FROM ledger WHERE tx_hash = ?", [e.txHash]);
  if (existing) return { recorded: false, duplicate: true };

  const note = (e.note ?? defaultNote(e)).slice(0, 220);
  await db.run(
    `INSERT INTO ledger (ts, kind, tx_hash, explorer_url, asset_in, amount_in, asset_out, amount_out, from_addr, to_addr, source, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (tx_hash) DO NOTHING`,
    [
      e.ts ?? Date.now(),
      e.kind,
      e.txHash,
      e.chainExplorerUrl ?? txUrl(e.txHash),
      e.assetIn ?? null,
      e.amountIn !== undefined ? String(e.amountIn) : null,
      e.assetOut ?? null,
      e.amountOut !== undefined ? String(e.amountOut) : null,
      e.from ?? null,
      e.to ?? null,
      e.source ?? "kumo",
      note,
    ],
  );
  say(FEED_KIND[e.kind], note);
  return { recorded: true, duplicate: false };
}

/** remove one entry by tx hash (admin cleanup for test entries). true if it existed. */
export async function deleteLedger(txHash: string): Promise<boolean> {
  const existing = await db.get("SELECT id FROM ledger WHERE tx_hash = ?", [txHash]);
  if (!existing) return false;
  await db.run("DELETE FROM ledger WHERE tx_hash = ?", [txHash]);
  return true;
}

export async function listLedger(limit = 50, kind?: string): Promise<LedgerRow[]> {
  const capped = Math.max(1, Math.min(200, limit));
  const rows = kind
    ? await db.all("SELECT * FROM ledger WHERE kind = ? ORDER BY ts DESC, id DESC LIMIT ?", [kind, capped])
    : await db.all("SELECT * FROM ledger ORDER BY ts DESC, id DESC LIMIT ?", [capped]);
  return (rows as Record<string, unknown>[]).map((r) => ({
    id: Number(r.id),
    ts: Number(r.ts),
    kind: r.kind as LedgerKind,
    txHash: r.tx_hash as string,
    chainExplorerUrl: r.explorer_url as string,
    assetIn: (r.asset_in as string) ?? null,
    amountIn: (r.amount_in as string) ?? null,
    assetOut: (r.asset_out as string) ?? null,
    amountOut: (r.amount_out as string) ?? null,
    from: (r.from_addr as string) ?? null,
    to: (r.to_addr as string) ?? null,
    source: r.source as string,
    note: r.note as string,
  }));
}
