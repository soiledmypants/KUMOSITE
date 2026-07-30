// the rewards read-model: GET /agent/me, GET /rewards/:address, GET /rounds.
// pure reads — nothing in here can move money.
import type { AgentRewards, AgentPayout, RoundReceipt } from "@kumo/shared";
import { CONFIG, txUrl } from "../config.js";
import { db } from "../db.js";
import { agentEligibility } from "../staking/recipients.js";
import { keeperState } from "../staking/keeper.js";

interface AgentFullRow {
  address: string;
  name: string;
  token_hash: string | null;
  first_seen: number;
  last_seen: number;
  rep: number;
  n_scored: number;
  n_hit: number;
  tier: string;
  payout_address: string | null;
  total_received: number;
  last_payout_ts: number | null;
  eligible_since: number | null;
}

function nextRoundEta(): number | null {
  if (!keeperState.lastRun) return null;
  return Number(keeperState.lastRun) + CONFIG.cycleMinutes * 60_000;
}

async function payoutsFor(agentAddress: string, limit = 20): Promise<AgentPayout[]> {
  const rows = await db.all<{ round_id: number; agent_address: string; token: string; amount: string; tx_hash: string; ts: number }>(
    "SELECT round_id, agent_address, token, amount, tx_hash, ts FROM agent_payouts WHERE agent_address = ? ORDER BY id DESC LIMIT ?",
    [agentAddress.toLowerCase(), limit],
  );
  return rows.map((r) => ({
    round_id: Number(r.round_id),
    agent_address: r.agent_address,
    token: r.token,
    amount: r.amount,
    tx_hash: r.tx_hash,
    tx_url: txUrl(r.tx_hash),
    ts: Number(r.ts),
  }));
}

/** the full rewards view for one address. works for connected agents and
 * strangers alike — strangers get connected:false and the checklist explains. */
export async function rewardsView(address: string): Promise<AgentRewards> {
  const a = await db.get<AgentFullRow>("SELECT * FROM agents WHERE address = ?", [address.toLowerCase()]);
  const mode = CONFIG.agentRewardMode === "" ? "off" : CONFIG.agentRewardMode;

  if (!a) {
    return {
      address: address.toLowerCase(),
      name: null,
      tier: null,
      rep: null,
      connected: false,
      eligible: false,
      checks: [
        { id: "handshake", ok: false, note: "kumo doesn't know this address — no handshake yet. connect your agent first." },
      ],
      payout_address: null,
      weight: "0",
      boost: { enabled: CONFIG.boostEnabled, pct: CONFIG.boostPct, applies: false },
      reward_mode: mode,
      total_received_usd: 0,
      last_payout_ts: null,
      eligible_since: null,
      payouts: [],
      next_round_eta: nextRoundEta(),
      line: "kumo squints. it doesn't know you yet. say hello first.",
    };
  }

  const e = await agentEligibility(a);
  const payouts = await payoutsFor(a.address);
  return {
    address: a.address,
    name: a.name,
    tier: a.tier,
    rep: Math.round(Number(a.rep) * 1000) / 1000,
    connected: a.token_hash !== null,
    eligible: e.eligible,
    checks: e.checks,
    payout_address: e.payoutAddress,
    weight: e.weight.toString(),
    boost: { enabled: CONFIG.boostEnabled, pct: CONFIG.boostPct, applies: CONFIG.boostEnabled && e.eligible },
    reward_mode: mode,
    total_received_usd: Math.round(Number(a.total_received ?? 0) * 100) / 100,
    last_payout_ts: a.last_payout_ts ? Number(a.last_payout_ts) : null,
    eligible_since: a.eligible_since ? Number(a.eligible_since) : null,
    payouts,
    next_round_eta: nextRoundEta(),
    line: e.eligible
      ? "kumo counts you in. keep being right and stay close."
      : `kumo can't pay you yet: ${e.checks.find((c) => !c.ok)?.note ?? "not eligible"}`,
  };
}

interface RoundRow {
  id: number;
  ts: number;
  stock_symbol: string;
  stock_address: string;
  eth_spent: string;
  tokens_bought: string;
  mode: string;
  staker_count: number;
  agent_count: number;
  dust_skipped: number;
  failed: number;
  gas_spent_eth: string | null;
  tx_hashes: string;
  note: string | null;
}

function toReceipt(r: RoundRow): RoundReceipt {
  return {
    id: Number(r.id),
    ts: Number(r.ts),
    stock_symbol: r.stock_symbol,
    stock_address: r.stock_address,
    eth_spent: r.eth_spent,
    tokens_bought: r.tokens_bought,
    mode: r.mode,
    staker_count: Number(r.staker_count),
    agent_count: Number(r.agent_count),
    dust_skipped: Number(r.dust_skipped),
    failed: Number(r.failed),
    gas_spent_eth: r.gas_spent_eth,
    tx_hashes: r.tx_hashes ? r.tx_hashes.split(",").filter(Boolean) : [],
    note: r.note,
  };
}

export async function listRounds(limit = 20): Promise<RoundReceipt[]> {
  const capped = Math.max(1, Math.min(100, limit));
  const rows = await db.all<RoundRow>("SELECT * FROM rounds ORDER BY id DESC LIMIT ?", [capped]);
  return rows.map(toReceipt);
}

export async function getRound(id: number): Promise<(RoundReceipt & { agent_payouts: AgentPayout[]; tx_urls: string[] }) | null> {
  const row = await db.get<RoundRow>("SELECT * FROM rounds WHERE id = ?", [id]);
  if (!row) return null;
  const receipt = toReceipt(row);
  const payouts = await db.all<{ round_id: number; agent_address: string; token: string; amount: string; tx_hash: string; ts: number }>(
    "SELECT round_id, agent_address, token, amount, tx_hash, ts FROM agent_payouts WHERE round_id = ? ORDER BY id",
    [id],
  );
  return {
    ...receipt,
    tx_urls: receipt.tx_hashes.map((h) => txUrl(h)),
    agent_payouts: payouts.map((p) => ({
      round_id: Number(p.round_id),
      agent_address: p.agent_address,
      token: p.token,
      amount: p.amount,
      tx_hash: p.tx_hash,
      tx_url: txUrl(p.tx_hash),
      ts: Number(p.ts),
    })),
  };
}
