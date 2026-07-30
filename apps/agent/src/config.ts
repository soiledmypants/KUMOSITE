import dotenv from "dotenv";
import { defineChain, getAddress, type Address } from "viem";
import { ADDRESSES, CHAIN_ID, RPC_URL, EXPLORER_BASE, FEE_TIERS } from "@kumo/shared";

// workspace-aware env loading: apps/agent/.env first, then the monorepo root
// .env (first value wins — dotenv never overwrites what's already set).
dotenv.config({ path: [".env", "../../.env"] });

function addr(v: string): Address {
  return getAddress(v);
}

function envAddr(name: string, fallback: string): Address {
  return addr(process.env[name] ?? fallback);
}

function envNum(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`env ${name} is not a number: ${raw}`);
  return n;
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return raw === "true" || raw === "1";
}

export const CONFIG = {
  // chain (defaults live in @kumo/shared — the single copy)
  chainId: envNum("CHAIN_ID", CHAIN_ID),
  rpcUrl: process.env.RPC_URL ?? RPC_URL,
  explorerBase: process.env.EXPLORER_BASE ?? EXPLORER_BASE,

  // server
  port: envNum("PORT", 8787),
  publicUrl: process.env.PUBLIC_URL ?? `http://localhost:${envNum("PORT", 8787)}`,
  corsOrigins: (process.env.CORS_ORIGINS ?? "*").split(",").map((s) => s.trim()),
  adminKey: process.env.KUMO_ADMIN_KEY ?? "",

  // modes
  mock: envBool("KUMO_MOCK", false),

  // persistence: DATABASE_URL -> postgres, else sqlite file
  databaseUrl: process.env.DATABASE_URL ?? "",
  dataDir: process.env.DATA_DIR ?? "data",

  // core addresses (verified on chain 4663, july 2026 — defaults in @kumo/shared)
  weth: envAddr("WETH", ADDRESSES.weth),
  usdg: envAddr("USDG", ADDRESSES.usdg),
  uniV3Factory: envAddr("UNI_V3_FACTORY", ADDRESSES.uniV3Factory),
  swapRouter02: envAddr("SWAP_ROUTER_V3", ADDRESSES.swapRouter02),
  quoterV2: envAddr("QUOTER_V3", ADDRESSES.quoterV2),
  erc8004Registry: envAddr("ERC8004_REGISTRY", ADDRESSES.erc8004Registry),

  // stock tokens (nvda verified via geckoterminal; extend via STOCK_TOKENS="SYM:0x..,SYM:0x..")
  stockTokens: parseStockTokens(process.env.STOCK_TOKENS ?? `NVDA:${ADDRESSES.nvda}`),
  nvdaUsdgPool: envAddr("NVDA_USDG_POOL", ADDRESSES.nvdaUsdgPool),
  // optional chainlink AggregatorV3 feeds: "SYM:0xfeed,SYM:0xfeed"
  chainlinkFeeds: parseStockTokens(process.env.CHAINLINK_FEEDS ?? ""),

  // fee tiers
  wethUsdgFeeTier: envNum("WETH_USDG_FEE_TIER", FEE_TIERS.wethUsdg),
  usdgStockFeeTier: envNum("USDG_STOCK_FEE_TIER", FEE_TIERS.usdgStock),
  defaultFeeTiers: [...FEE_TIERS.defaults],

  // trading
  tradingEnabled: envBool("TRADING_ENABLED", false),
  tradeMaxEth: envNum("TRADE_MAX_ETH", 0.05),
  tradeDailyMaxEth: envNum("TRADE_DAILY_MAX_ETH", 0.25),
  slippagePct: envNum("SLIPPAGE_PCT", 1),
  routingFeeBps: envNum("ROUTING_FEE_BPS", 30),

  // scanners
  walletScanMs: envNum("WALLET_SCAN_MS", 30_000),
  stockScanMs: envNum("STOCK_SCAN_MS", 300_000), // ta cycle: every 5 min
  stockDiscoveryMs: envNum("STOCK_DISCOVERY_MS", 6 * 3600 * 1000),
  memecoinScanMs: envNum("MEMECOIN_SCAN_MS", 45_000),
  scanChunkBlocks: envNum("SCAN_CHUNK_BLOCKS", 2000),
  scanMaxChunksPerCycle: envNum("SCAN_MAX_CHUNKS_PER_CYCLE", 25),

  // signals / reputation
  signalTtlS: envNum("SIGNAL_TTL_S", 6 * 3600),
  earlyAccessLeadS: envNum("EARLY_ACCESS_LEAD_S", 300),
  intelDailyLimit: envNum("INTEL_DAILY_LIMIT", 30),
  repScoreIntervalMs: envNum("REP_SCORE_INTERVAL_MS", 60_000),

  // staking / keeper — rapid rotating payout cycle
  kumoToken: process.env.KUMO_TOKEN ?? "",
  stakingAddress: process.env.STAKING_ADDRESS ?? "",
  epochStock: process.env.KUMO_EPOCH_STOCK ?? "auto", // manual round-pick override
  cycleMinutes: envNum("CYCLE_MINUTES", 10),
  distributeMinEth: envNum("DISTRIBUTE_MIN_ETH", envNum("MIN_FUND_ETH", 0.05)),
  perRecipientMinUsd: envNum("PER_RECIPIENT_MIN_USD", 0.25),
  boostEnabled: envBool("BOOST_ENABLED", false), // connected-agent boost is designed but ships OFF
  boostPct: envNum("BOOST_PCT", 10),
  gasReserveEth: envNum("GAS_RESERVE_ETH", 0.02),
  maxImpactPct: envNum("MAX_IMPACT_PCT", 2),
  keeperDryRun: envBool("KEEPER_DRY_RUN", false), // true -> scheduled cycles plan only, never send

  // pons fee claiming (ported from ops-panel; inactive until KUMO_TOKEN is set
  // and CLAIM_ENABLED=true). CLAIMER_PRIVATE_KEY falls back to PRIVATE_KEY.
  claimEnabled: envBool("CLAIM_ENABLED", false),
  claimDryRun: envBool("CLAIM_DRY_RUN", true), // plan + log, send nothing, until flipped
  claimIntervalMinutes: envNum("CLAIM_INTERVAL_MINUTES", 10),
  claimMinEth: envNum("CLAIM_MIN_ETH", 0.01),
  claimGasReserveEth: envNum("CLAIM_GAS_RESERVE_ETH", 0.005),
  claimMaxForwardEth: envNum("CLAIM_MAX_FORWARD_ETH", 1),
  claimTreasuryWallet: process.env.CLAIM_TREASURY_WALLET ?? "",
  claimTreasuryPct: envNum("CLAIM_TREASURY_PCT", 0),
  ponsLocker: process.env.PONS_LOCKER ?? "auto", // auto = current->legacy probe, or explicit 0x…

  // chat
  anthropicKey: process.env.ANTHROPIC_API_KEY ?? "",
  chatModel: process.env.CHAT_MODEL ?? "claude-haiku-4-5-20251001",

  // tx
  txWaitMs: envNum("TX_WAIT_MS", 90_000),
  gasBumpPct: envNum("GAS_BUMP_PCT", 25),
} as const;

function parseStockTokens(raw: string): { symbol: string; address: Address }[] {
  if (!raw.trim()) return [];
  return raw
    .split(",")
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const [symbol, address] = pair.split(":");
      if (!symbol || !address) throw new Error(`bad token entry: ${pair}`);
      return { symbol: symbol.trim().toUpperCase(), address: addr(address.trim()) };
    });
}

export const robinhoodChain = defineChain({
  id: CONFIG.chainId,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [CONFIG.rpcUrl] },
  },
  blockExplorers: {
    default: { name: "RHC Blockscout", url: CONFIG.explorerBase },
  },
});

export function txUrl(hash: string): string {
  return `${CONFIG.explorerBase}/tx/${hash}`;
}

export function addrUrl(address: string): string {
  return `${CONFIG.explorerBase}/address/${address}`;
}

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;
