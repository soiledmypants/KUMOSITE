// wire types for kumo's http api (docs/API.md in apps/agent) — THE single
// copy, imported by both the agent (response builders) and the site (client).
// keep field names snake_case exactly as they go over the wire.

export type KumoStatus = {
  state: string;
  uptime_s: number;
  watching: number;
  agents_connected: number;
  signals_today: number;
  trading_enabled: boolean;
  mock: boolean;
  address?: string | null;
  chain_id: number;
  /** $KUMO contract address once launched; null pre-launch */
  kumo_token?: string | null;
};

export type FeedEvent = { ts: number; kind: string; line: string };

export type KumoSignal = {
  id: string;
  ts: number;
  kind: "buy" | "avoid" | "watch";
  subject: { type: string; address?: string; symbol?: string };
  strength: number;
  sources?: { kumo?: number; contributors?: number };
  line: string;
};

export type KumoAgent = {
  name: string;
  address: string;
  rep: number;
  tier: string;
  contributions: number;
  hit_rate: number;
};

export type StockRank = {
  symbol: string;
  address: string;
  price_usd: number | null;
  ta_score: number;
  short_momentum_pct: number | null;
  long_momentum_pct: number | null;
  volume_spike: number | null;
  volatility_pct: number | null;
  liquidity_usd: number | null;
  scored_at: number;
};

export const LEDGER_KINDS = ["claim", "forward", "buyback", "reward_fund", "trade", "airdrop"] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];

export type LedgerEntry = {
  id: number;
  ts: number;
  kind: LedgerKind | string;
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
};

export type StakingStats = {
  pool?: string | null;
  model?: string;
  round_stock?: string | null;
  screen?: string | null;
  keeper?: {
    last_run?: number | null;
    last_result?: string;
    last_round?: {
      ts: number;
      stock: string;
      recipients: number;
      skippedDust: number;
      totalSent: string;
      gasSpentEth: string;
    } | null;
    alerts?: string[];
    cycle_minutes?: number;
    distribute_min_eth?: number;
    per_recipient_min_usd?: number;
    dry_run?: boolean;
  };
  boost?: { enabled: boolean; pct: number };
  airdrops_7d?: Array<{ asset_out: string; rounds: number; total: number }>;
  onchain?: {
    totalStaked?: string;
    bootstrapStreams?: Array<{
      symbol: string;
      token?: string;
      rewardRateScaled?: string;
      periodFinish?: number;
      notifiedTotal?: string;
      claimedTotal?: string;
    }>;
  } | null;
  journal?: Array<{ ts?: number; eth_spent?: string; token?: string; amount?: string; tx_hashes?: string; note?: string }>;
};

/** a fully-planned (never-sent) payout round: what kumo WOULD do right now. */
export interface RoundPlan {
  ts: number;
  dry: true;
  phase: "no_wallet" | "saving_up" | "screen_fail" | "impact_abort" | "no_recipients" | "ready";
  note: string;
  wallet: string | null;
  balance_eth: string;
  gas_reserve_eth: number;
  distributable_eth: string;
  distribute_min_eth: number;
  claim_note: string;
  pick?: { symbol: string; address: string; passes_screen: boolean; screen_note: string; ta_score: number | null };
  planned_buy?: {
    route: string;
    amount_in_eth: string;
    quoted_out: string;
    min_out: string;
    impact_pct: number;
    max_impact_pct: number;
  };
  planned_distribution?: {
    mode: string;
    recipients: number;
    boosted: number;
    skipped_dust: number;
    total_planned: string;
    per_recipient_min_usd: number;
    boost_enabled: boolean;
    top: { address: string; amount: string; boosted: boolean }[];
  };
  planned_ledger?: Record<string, unknown>[];
}
