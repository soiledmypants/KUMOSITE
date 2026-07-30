// KUMO_MOCK=true: the full api serves believable fake data with no rpc, no db
// writes needed beyond feed lines. lets the lovable frontend build immediately.
import { randomUUID } from "node:crypto";
import { say } from "./voice.js";

const t0 = Date.now();

export const mockStatus = () => ({
  state: "awake" as const,
  uptime_s: Math.floor((Date.now() - t0) / 1000),
  watching: 3,
  agents_connected: 4,
  signals_today: 7,
  trading_enabled: false,
  mock: true,
  address: "0xk0m0000000000000000000000000000000000umo",
  chain_id: 4663,
  kumo_token: null,
});

export const mockWallets = () => [
  {
    address: "0x1111111111111111111111111111111111111111",
    label: "whale-chan",
    eth_balance_eth: 412.37,
    pnl_eth: 12.4,
    tokens: [
      { address: "0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec", symbol: "NVDA", amount: 180.5 },
      { address: "0x5fc5360d0400a0fd4f2af552add042d716f1d168", symbol: "USDG", amount: 52000 },
    ],
    last_moves: [
      { ts: Date.now() - 120_000, kind: "in", token: null, symbol: "NVDA", amount: "25.0", tx: "0xabc1" },
      { ts: Date.now() - 340_000, kind: "out", token: null, symbol: "USDG", amount: "4200.0", tx: "0xabc2" },
    ],
  },
  {
    address: "0x2222222222222222222222222222222222222222",
    label: "sniper-kun",
    eth_balance_eth: 8.02,
    pnl_eth: -1.11,
    tokens: [{ address: "0x3333333333333333333333333333333333333333", symbol: "HOOD2MOON", amount: 6_900_000 }],
    last_moves: [{ ts: Date.now() - 60_000, kind: "in", token: null, symbol: "HOOD2MOON", amount: "6900000", tx: "0xabc3" }],
  },
  {
    address: "0x4444444444444444444444444444444444444444",
    label: "quiet-fren",
    eth_balance_eth: 1.2,
    pnl_eth: 0.02,
    tokens: [],
    last_moves: [],
  },
];

let nvdaPrice = 191.42;
export const mockStocks = () => {
  nvdaPrice += (Math.random() - 0.5) * 0.4;
  return [
    { address: "0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec", symbol: "NVDA", name: "NVIDIA", price_usd: Number(nvdaPrice.toFixed(2)), ta_score: 0.81, ui_multiplier: 1, market: "open" as const, change_24h: 2.3, liquidity_usd: 631162 },
    { address: "0x5555555555555555555555555555555555555555", symbol: "MSTR", name: "Strategy", price_usd: 402.11, ta_score: 0.74, ui_multiplier: 1, market: "open" as const, change_24h: 4.9, liquidity_usd: 312000 },
    { address: "0x6666666666666666666666666666666666666666", symbol: "TSLA", name: "Tesla", price_usd: 411.02, ta_score: 0.62, ui_multiplier: 1, market: "open" as const, change_24h: -1.1, liquidity_usd: 118000 },
    { address: "0x7777777777777777777777777777777777777779", symbol: "SPY", name: "SPDR S&P 500", price_usd: 689.5, ta_score: 0.55, ui_multiplier: 1, market: "open" as const, change_24h: 0.4, liquidity_usd: 92000 },
  ];
};

export const mockRanking = () =>
  mockStocks().map((s, i) => ({
    symbol: s.symbol,
    address: s.address,
    price_usd: s.price_usd,
    ta_score: s.ta_score,
    short_momentum_pct: [0.9, 1.4, -0.3, 0.1][i] ?? 0,
    long_momentum_pct: s.change_24h,
    volume_spike: [2.1, 3.4, 0.8, 1.0][i] ?? 1,
    volatility_pct: [0.4, 0.9, 0.5, 0.2][i] ?? 0.3,
    liquidity_usd: s.liquidity_usd,
    scored_at: Date.now() - 120_000,
  }));

export const mockSignals = () => [
  {
    id: randomUUID(),
    ts: Date.now() - 300_000,
    kind: "buy",
    subject: { type: "stock", address: "0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec", symbol: "NVDA" },
    strength: 0.82,
    sources: { kumo: 0.6, contributors: 3 },
    line: "kumo noticed NVDA-token waking up... it moved 2.3%.",
  },
  {
    id: randomUUID(),
    ts: Date.now() - 900_000,
    kind: "avoid",
    subject: { type: "token", address: "0x3333333333333333333333333333333333333333", symbol: "HOOD2MOON" },
    strength: 0.71,
    sources: { kumo: 0.5, contributors: 2 },
    line: "kumo says avoid this one. (HOOD2MOON)",
  },
  {
    id: randomUUID(),
    ts: Date.now() - 1_500_000,
    kind: "watch",
    subject: { type: "wallet", address: "0x1111111111111111111111111111111111111111", symbol: null },
    strength: 0.55,
    sources: { kumo: 0.55, contributors: 0 },
    line: "kumo sees a wallet moving fast. watching closely...",
  },
];

export const mockAgents = () => [
  { name: "oracle-9", address: "0xaaa1", rep: 0.81, tier: "inner-circle", contributions: 42, hit_rate: 0.79 },
  { name: "degen-scout", address: "0xaaa2", rep: 0.63, tier: "trusted", contributions: 18, hit_rate: 0.61 },
  { name: "papertrader", address: "0xaaa3", rep: 0.41, tier: "hatchling", contributions: 6, hit_rate: 0.5 },
  { name: "newfren", address: "0xaaa4", rep: 0.35, tier: "hatchling", contributions: 0, hit_rate: null },
];

export const mockQuote = (tokenIn: string, tokenOut: string, amountIn: string) => ({
  route: "two-hop-usdg",
  tokenIn,
  tokenOut,
  amountIn,
  amountOut: (Number(amountIn) * 19.83).toFixed(6),
  minOut: (Number(amountIn) * 19.63).toFixed(6),
  impact_pct: 0.12,
  line: "kumo priced it out: looks fine. shallow puddle, small splash.",
});

export const mockStakingStats = () => ({
  pool: "0x7777777777777777777777777777777777777777",
  model: "rotating direct airdrops (fee-funded) + on-chain KUMO bootstrap stream",
  round_stock: "MSTR",
  screen: "geckoterminal: reserve $412,000, 24h vol $2,900,000",
  keeper: {
    last_run: Date.now() - 480_000,
    last_result: "paid 143 stakers in MSTR",
    last_round: { ts: Date.now() - 480_000, stock: "MSTR", recipients: 143, skippedDust: 12, totalSent: "1.8421", gasSpentEth: "0.000114" },
    alerts: [],
    cycle_minutes: 10,
    distribute_min_eth: 0.05,
    per_recipient_min_usd: 0.25,
    dry_run: false,
  },
  boost: { enabled: false, pct: 10 },
  airdrops_7d: [
    { asset_out: "NVDA", rounds: 41, total: 30.12 },
    { asset_out: "MSTR", rounds: 18, total: 22.7 },
    { asset_out: "GME", rounds: 6, total: 240.1 },
  ],
  onchain: {
    totalStaked: "1284000000000000000000000",
    bootstrapStreams: [
      { symbol: "KUMO", token: "0x8888", rewardRateScaled: "12000000000000000000", periodFinish: Math.floor(Date.now() / 1000) + 400_000, notifiedTotal: "9000000000000000000000000", claimedTotal: "4100000000000000000000000" },
    ],
  },
  journal: [
    { ts: Date.now() - 480_000, eth_spent: "62000000000000000", token: "0x5555...", amount: "1842100000000000000", tx_hashes: "0xmock1,0xmock2", note: "round: 143 paid, 12 dust-accrued, 0 failed, gas 0.000114 eth" },
    { ts: Date.now() - 1_080_000, eth_spent: "31000000000000000", token: "-", amount: "0", tx_hashes: "-", note: "kumo is saving up" },
  ],
});

export const mockLedger = () => [
  {
    id: 3,
    ts: Date.now() - 600_000,
    kind: "reward_fund",
    txHash: "0x" + "c3".repeat(32),
    chainExplorerUrl: "https://robinhoodchain.blockscout.com/tx/0x" + "c3".repeat(32),
    assetIn: null, amountIn: null,
    assetOut: "NVDA", amountOut: "1.2043",
    from: "0xk0m0", to: "0xp00l",
    source: "kumo",
    note: "kumo fed the staking pool. 1.2043 NVDA.",
  },
  {
    id: 2,
    ts: Date.now() - 660_000,
    kind: "buyback",
    txHash: "0x" + "b2".repeat(32),
    chainExplorerUrl: "https://robinhoodchain.blockscout.com/tx/0x" + "b2".repeat(32),
    assetIn: "ETH", amountIn: "0.12",
    assetOut: "NVDA", amountOut: null,
    from: "0xk0m0", to: null,
    source: "kumo",
    note: "kumo bought NVDA for the stakers.",
  },
  {
    id: 1,
    ts: Date.now() - 3_600_000,
    kind: "claim",
    txHash: "0x" + "a1".repeat(32),
    chainExplorerUrl: "https://robinhoodchain.blockscout.com/tx/0x" + "a1".repeat(32),
    assetIn: "ETH", amountIn: "0.3",
    assetOut: null, amountOut: null,
    from: "0xfees", to: "0xk0m0",
    source: "claimer",
    note: "kumo collected its allowance. 0.3 ETH.",
  },
];

// ---- phase 2: agent rewards fixtures ------------------------------------------

const MOCK_AGENT = "0x1234567890abcdef1234567890abcdef12345678";

export function mockAgentRewards(address: string = MOCK_AGENT): Record<string, unknown> {
  return {
    address: address.toLowerCase(),
    name: "oracle-9",
    tier: "trusted",
    rep: 0.71,
    connected: true,
    eligible: true,
    checks: [
      { id: "handshake", ok: true, note: "wallet-signature handshake complete" },
      { id: "liveness", ok: true, note: "seen within the last 24h" },
      { id: "reputation", ok: true, note: "tier trusted, rep 0.71" },
      { id: "stake", ok: true, note: "payout address holds stake" },
      { id: "address", ok: true, note: "payout address is a clean eoa" },
    ],
    payout_address: address.toLowerCase(),
    weight: "710000",
    boost: { enabled: true, pct: 10, applies: true },
    reward_mode: "pool",
    total_received_usd: 42.17,
    last_payout_ts: Date.now() - 12 * 60_000,
    eligible_since: Date.now() - 6 * 86_400_000,
    payouts: [
      { round_id: 141, agent_address: address.toLowerCase(), token: "0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec", amount: "0.0141", tx_hash: "0x" + "b2".repeat(32), tx_url: "https://robinhoodchain.blockscout.com/tx/0x" + "b2".repeat(32), ts: Date.now() - 12 * 60_000 },
      { round_id: 140, agent_address: address.toLowerCase(), token: "0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec", amount: "0.0119", tx_hash: "0x" + "c3".repeat(32), tx_url: "https://robinhoodchain.blockscout.com/tx/0x" + "c3".repeat(32), ts: Date.now() - 22 * 60_000 },
    ],
    next_round_eta: Date.now() + 8 * 60_000,
    line: "kumo counts you in. keep being right and stay close. (mock)",
  };
}

function mockRound(id: number, minsAgo: number): Record<string, unknown> {
  return {
    id,
    ts: Date.now() - minsAgo * 60_000,
    stock_symbol: id % 2 === 0 ? "MSTR" : "NVDA",
    stock_address: "0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec",
    eth_spent: "0.0612",
    tokens_bought: "1.8421",
    mode: "stakers",
    staker_count: 143,
    agent_count: 4,
    dust_skipped: 12,
    failed: 0,
    gas_spent_eth: "0.000114",
    tx_hashes: ["0x" + "d4".repeat(32), "0x" + "e5".repeat(32)],
    note: `paid 143 stakers + 4 agents in ${id % 2 === 0 ? "MSTR" : "NVDA"}`,
  };
}

export function mockRounds(): Record<string, unknown>[] {
  return [mockRound(141, 12), mockRound(140, 22), mockRound(139, 32)];
}

export function mockRoundDetail(id: number): Record<string, unknown> {
  const r = mockRound(Number.isFinite(id) && id > 0 ? id : 141, 12);
  return {
    ...r,
    tx_urls: (r.tx_hashes as string[]).map((h) => `https://robinhoodchain.blockscout.com/tx/${h}`),
    agent_payouts: [
      { round_id: r.id, agent_address: MOCK_AGENT, token: r.stock_address, amount: "0.0141", tx_hash: "0x" + "b2".repeat(32), tx_url: "https://robinhoodchain.blockscout.com/tx/0x" + "b2".repeat(32), ts: r.ts },
    ],
    line: `round #${r.id}: ${r.note} (mock)`,
  };
}

const tickerLines = [
  "kumo is watching 3 wallets...",
  "kumo noticed NVDA-token waking up...",
  "kumo hears a lot of noise around HOOD2MOON. volume spiking...",
  "kumo is learning from 4 agents...",
  "kumo is talking to another agent... hi, oracle-9.",
  "the stock market is sleeping. kumo naps too.",
  "kumo found a trade.",
  "kumo trusts degen-scout a little more now.",
  "kumo stretched. all systems cozy.",
];

export function startMockTicker(): void {
  let i = 0;
  setInterval(() => {
    const kinds = ["watch", "signal", "signal", "agent", "agent", "zzz", "trade", "agent", "wake"] as const;
    say(kinds[i % kinds.length], tickerLines[i % tickerLines.length]);
    i++;
  }, 8000).unref();
}
