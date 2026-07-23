// usd price reads: chainlink AggregatorV3 when configured, uniswap v3 pool spot otherwise.
import { parseAbi, type Address } from "viem";
import { CONFIG } from "../config.js";
import { publicClient } from "../clients.js";
import { withRetry } from "../rpc.js";
import { db } from "../db.js";

const factoryAbi = parseAbi([
  "function getPool(address, address, uint24) view returns (address)",
]);
const poolAbi = parseAbi([
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
]);
const aggregatorAbi = parseAbi([
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function decimals() view returns (uint8)",
]);
const erc20Abi = parseAbi(["function decimals() view returns (uint8)"]);

const ZERO = "0x0000000000000000000000000000000000000000";
const poolCache = new Map<string, { pool: Address; base: Address } | null>();
const priceCache = new Map<string, { price: number; ts: number; stale?: boolean }>();
const PRICE_TTL_MS = 30_000;

async function findPool(token: Address): Promise<{ pool: Address; base: Address } | null> {
  const key = token.toLowerCase();
  if (poolCache.has(key)) return poolCache.get(key)!;
  const bases: Address[] = [CONFIG.usdg, CONFIG.weth];
  for (const base of bases) {
    for (const fee of [100, 500, 3000, 10000]) {
      try {
        const pool = await withRetry(
          () =>
            publicClient.readContract({
              address: CONFIG.uniV3Factory,
              abi: factoryAbi,
              functionName: "getPool",
              args: [token, base, fee],
            }),
          "factory.getPool",
          { retries: 1 },
        );
        if (pool && pool.toLowerCase() !== ZERO) {
          const found = { pool, base };
          poolCache.set(key, found);
          return found;
        }
      } catch {
        // keep trying tiers
      }
    }
  }
  poolCache.set(key, null);
  return null;
}

async function tokenDecimals(token: Address): Promise<number> {
  const row = await db.get<{ decimals: number }>("SELECT decimals FROM tokens WHERE address = ?", [
    token.toLowerCase(),
  ]);
  if (row) return Number(row.decimals);
  try {
    return await withRetry(
      () => publicClient.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }),
      "decimals",
      { retries: 1 },
    );
  } catch {
    return 18;
  }
}

/** spot price of `token` denominated in `base` units, from a v3 pool's slot0 */
async function poolSpot(token: Address, pool: Address, base: Address): Promise<number | null> {
  try {
    const [slot0, token0] = await Promise.all([
      withRetry(() => publicClient.readContract({ address: pool, abi: poolAbi, functionName: "slot0" }), "slot0", { retries: 1 }),
      withRetry(() => publicClient.readContract({ address: pool, abi: poolAbi, functionName: "token0" }), "token0", { retries: 1 }),
    ]);
    const sqrt = Number(slot0[0]) / 2 ** 96;
    let priceT0inT1 = sqrt * sqrt; // token1 per token0, raw units
    const [d0, d1] =
      token0.toLowerCase() === token.toLowerCase()
        ? [await tokenDecimals(token), await tokenDecimals(base)]
        : [await tokenDecimals(base), await tokenDecimals(token)];
    priceT0inT1 = priceT0inT1 * 10 ** (d0 - d1);
    return token0.toLowerCase() === token.toLowerCase() ? priceT0inT1 : 1 / priceT0inT1;
  } catch {
    return null;
  }
}

export async function ethUsd(): Promise<number | null> {
  const cached = priceCache.get("eth");
  if (cached && Date.now() - cached.ts < PRICE_TTL_MS) return cached.price;
  const found = await findPool(CONFIG.weth);
  if (!found || found.base.toLowerCase() !== CONFIG.usdg.toLowerCase()) return null;
  const p = await poolSpot(CONFIG.weth, found.pool, found.base);
  if (p !== null) priceCache.set("eth", { price: p, ts: Date.now() });
  return p;
}

export interface PriceResult {
  price: number;
  source: "chainlink" | "pool";
  stale: boolean; // chainlink only: >1h since update (markets closed)
}

export async function priceUsd(token: Address, symbol?: string): Promise<PriceResult | null> {
  const key = token.toLowerCase();
  const cached = priceCache.get(key);
  if (cached && Date.now() - cached.ts < PRICE_TTL_MS) {
    return { price: cached.price, source: "pool", stale: cached.stale ?? false };
  }

  // chainlink feed if configured for this symbol
  const feed = symbol
    ? CONFIG.chainlinkFeeds.find((f) => f.symbol === symbol.toUpperCase())?.address
    : undefined;
  if (feed) {
    try {
      const [round, dec] = await Promise.all([
        withRetry(
          () => publicClient.readContract({ address: feed, abi: aggregatorAbi, functionName: "latestRoundData" }),
          "chainlink.latestRoundData",
          { retries: 1 },
        ),
        withRetry(
          () => publicClient.readContract({ address: feed, abi: aggregatorAbi, functionName: "decimals" }),
          "chainlink.decimals",
          { retries: 1 },
        ),
      ]);
      const price = Number(round[1]) / 10 ** dec;
      const stale = Date.now() / 1000 - Number(round[3]) > 3600;
      priceCache.set(key, { price, ts: Date.now(), stale });
      return { price, source: "chainlink", stale };
    } catch {
      // fall through to pool
    }
  }

  const found = await findPool(token);
  if (!found) return null;
  const inBase = await poolSpot(token, found.pool, found.base);
  if (inBase === null) return null;
  let usd = inBase;
  if (found.base.toLowerCase() === CONFIG.weth.toLowerCase()) {
    const eu = await ethUsd();
    if (eu === null) return null;
    usd = inBase * eu;
  }
  priceCache.set(key, { price: usd, ts: Date.now() });
  return { price: usd, source: "pool", stale: false };
}
