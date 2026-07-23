import "dotenv/config";
import { defineChain, getAddress, type Address } from "viem";

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
  // chain
  chainId: envNum("CHAIN_ID", 4663),
  rpcUrl: process.env.RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com",
  explorerBase: process.env.EXPLORER_BASE ?? "https://robinhoodchain.blockscout.com",

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

  // core addresses (verified on chain 4663, july 2026)
  weth: envAddr("WETH", "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73"),
  usdg: envAddr("USDG", "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"),
  uniV3Factory: envAddr("UNI_V3_FACTORY", "0x1f7d7550b1b028f7571e69a784071f0205fd2efa"),
  swapRouter02: envAddr("SWAP_ROUTER_V3", "0xcaf681a66d020601342297493863e78c959e5cb2"),
  quoterV2: envAddr("QUOTER_V3", "0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7"),
  erc8004Registry: envAddr("ERC8004_REGISTRY", "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432"),

  // stock tokens (nvda verified via geckoterminal; extend via STOCK_TOKENS="SYM:0x..,SYM:0x..")
  stockTokens: parseStockTokens(
    process.env.STOCK_TOKENS ?? "NVDA:0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec",
  ),
  nvdaUsdgPool: envAddr("NVDA_USDG_POOL", "0xd4eb21209c4d6093f80b5b84f5c45cc093ea14a3"),
  // optional chainlink AggregatorV3 feeds: "SYM:0xfeed,SYM:0xfeed"
  chainlinkFeeds: parseStockTokens(process.env.CHAINLINK_FEEDS ?? ""),

  // fee tiers
  wethUsdgFeeTier: envNum("WETH_USDG_FEE_TIER", 100),
  usdgStockFeeTier: envNum("USDG_STOCK_FEE_TIER", 500),
  defaultFeeTiers: [500, 3000, 10000],

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

  // staking / keeper
  kumoToken: process.env.KUMO_TOKEN ?? "",
  stakingAddress: process.env.STAKING_ADDRESS ?? "",
  epochStock: process.env.KUMO_EPOCH_STOCK ?? "auto",
  keeperIntervalMs: envNum("KEEPER_INTERVAL_MS", 6 * 3600 * 1000),
  minFundEth: envNum("MIN_FUND_ETH", 0.05),
  gasReserveEth: envNum("GAS_RESERVE_ETH", 0.02),
  maxImpactPct: envNum("MAX_IMPACT_PCT", 2),

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
