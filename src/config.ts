import { defineChain, getAddress, parseEther, parseGwei } from "viem";

/** Normalise any hex string to a checksummed 0x-address (validates length/hex). */
function addr(value: string): `0x${string}` {
  return getAddress(value.trim());
}

/** Required env address — the bot refuses to boot without it. */
function requiredAddr(key: string): `0x${string}` {
  const raw = process.env[key];
  if (!raw || raw.trim().length === 0) {
    throw new Error(`${key} env var is required. Set it in .env (copy .env.example).`);
  }
  return addr(raw);
}

/** Optional env address — null when unset. */
function optionalAddr(key: string): `0x${string}` | null {
  const raw = process.env[key];
  if (!raw || raw.trim().length === 0) return null;
  return addr(raw);
}

export const CONFIG = {
  // Chain / network (Robinhood Chain mainnet).
  rpcUrl: process.env.RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com",
  chainId: 4663,
  explorerBase: process.env.EXPLORER_BASE ?? "https://robinhoodchain.blockscout.com",

  // Stats HTTP server.
  serverPort: Number(process.env.PORT ?? "8787"),

  // Cadence.
  intervalMinutes: Number(process.env.INTERVAL_MINUTES ?? "10"),

  // DRY_RUN defaults ON: every read runs, every send is logged instead of sent.
  dryRun: (process.env.DRY_RUN ?? "true").toLowerCase() !== "false",

  // The pons launchpad token whose creator fees this bot claims.
  tokenAddress: requiredAddr("TOKEN_ADDRESS"),

  // PonsLaunchLocker deployments (verified on Blockscout). LOCKER_ADDRESS skips the auto-probe.
  lockerOverride: optionalAddr("LOCKER_ADDRESS"),
  lockers: {
    current: addr("0x736D76699C26D0d966744cAe304C000d471f7F35"), // block 8991118+, protocol 30%
    legacy: addr("0x31ca5E101941A93A7DD6d0497928700625CF54B5"), // block 8600612+, protocol 10%
  },

  // Canonical WETH on RHC — fees arrive as WETH ERC20, never native ETH.
  weth: addr(process.env.WETH ?? "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73"),

  // Routing: TREASURY_PCT% of forwarded ETH to treasury, remainder to kumo.
  treasuryWallet: requiredAddr("TREASURY_WALLET"),
  kumoWallet: optionalAddr("KUMO_WALLET"),
  treasuryPct: Number(process.env.TREASURY_PCT ?? "0"),

  // Thresholds, all in wei.
  claimMinWei: parseEther(process.env.CLAIM_MIN_ETH ?? "0.01"), // on the NET WETH share of claimable
  gasReserveWei: parseEther(process.env.GAS_RESERVE_ETH ?? "0.02"), // ETH kept in the hot wallet
  maxForwardWei: parseEther(process.env.MAX_FORWARD_ETH ?? "1"), // per-cycle forward cap
  forwardMinWei: parseEther(process.env.FORWARD_MIN_ETH ?? "0.001"), // skip dust forwards

  // Gas policy.
  gas: {
    maxFeePerGasGwei: Number(process.env.MAX_FEE_GWEI ?? "50"),
    maxPriorityFeePerGasGwei: Number(process.env.MAX_PRIORITY_GWEI ?? "2"),
    gasBumpPct: Number(process.env.GAS_BUMP_PCT ?? "25"),
    txWaitMs: Number(process.env.TX_WAIT_MS ?? "90000"),
  },
} as const;

// Boot-time routing assertions — fail fast, before any client or server exists.
if (!Number.isInteger(CONFIG.treasuryPct) || CONFIG.treasuryPct < 0 || CONFIG.treasuryPct > 100) {
  throw new Error(`TREASURY_PCT must be an integer 0-100, got "${process.env.TREASURY_PCT}"`);
}
if (CONFIG.treasuryPct < 100 && !CONFIG.kumoWallet) {
  throw new Error(
    `KUMO_WALLET is required while TREASURY_PCT < 100 ` +
      `(currently ${CONFIG.treasuryPct}% treasury / ${100 - CONFIG.treasuryPct}% kumo).`,
  );
}
if (!Number.isFinite(CONFIG.intervalMinutes) || CONFIG.intervalMinutes <= 0) {
  throw new Error(`INTERVAL_MINUTES must be a positive number, got "${process.env.INTERVAL_MINUTES}"`);
}

/** viem chain definition for Robinhood Chain. */
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

/** EIP-1559 gas caps derived from config, as wei bigints. */
export function baseGasCaps(): { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint } {
  return {
    maxFeePerGas: parseGwei(String(CONFIG.gas.maxFeePerGasGwei)),
    maxPriorityFeePerGas: parseGwei(String(CONFIG.gas.maxPriorityFeePerGasGwei)),
  };
}

/** Bump both gas caps by `pct` percent (used to un-stick a pending tx). */
export function bumpGasCaps(
  caps: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint },
  pct: number,
): { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint } {
  const factor = BigInt(100 + Math.round(pct));
  return {
    maxFeePerGas: (caps.maxFeePerGas * factor) / 100n,
    maxPriorityFeePerGas: (caps.maxPriorityFeePerGas * factor) / 100n,
  };
}

/** Clickable explorer link for a tx hash. */
export function explorerTx(hash: string): string {
  return `${CONFIG.explorerBase}/tx/${hash}`;
}
