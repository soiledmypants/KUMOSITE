// full stock-token discovery for chain 4663.
//
// the docs.robinhood.com/chain/contracts table ("generated live from the
// on-chain asset registry") is rendered from https://api.robinhood.com/rhj/assets
// — that endpoint IS the registry's public face, so we read it directly instead
// of scraping html. chainlink feeds come from chainlink's own reference data
// directory for this chain. STOCK_TOKENS env entries are merged as extras, and
// previously-discovered rows in the db act as the offline fallback.
import { parseAbi, type Address, getAddress } from "viem";
import { CONFIG } from "../config.js";
import { publicClient } from "../clients.js";
import { withRetry } from "../rpc.js";
import { db } from "../db.js";
import { say } from "../voice.js";
import { ethUsd, poolSpot } from "./prices.js";

const ASSETS_URL = process.env.RH_ASSETS_URL ?? "https://api.robinhood.com/rhj/assets";
const CHAINLINK_RDD_URL =
  process.env.CHAINLINK_RDD_URL ?? "https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json";

const factoryAbi = parseAbi(["function getPool(address, address, uint24) view returns (address)"]);
const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
]);

const ZERO = "0x0000000000000000000000000000000000000000";
const FEE_TIERS = [100, 500, 3000, 10000];

export interface DiscoveredStock {
  symbol: string;
  name: string;
  address: Address;
  decimals: number;
  pool: Address | null;
  poolBase: Address | null; // USDG or WETH
  chainlinkFeed: Address | null;
  liquidityUsd: number;
  uiMultiplier: number;
  taScore: number | null;
}

// in-memory registry so sync callers (resolveToken, guard allowlist) can use it
const bySymbol = new Map<string, DiscoveredStock>();
const byAddress = new Map<string, DiscoveredStock>();

export function allStocks(): DiscoveredStock[] {
  return [...byAddress.values()];
}

export function stockBySymbol(symbol: string): DiscoveredStock | undefined {
  return bySymbol.get(symbol.toUpperCase());
}

export function stockByAddress(address: string): DiscoveredStock | undefined {
  return byAddress.get(address.toLowerCase());
}

interface RhAsset {
  tokenSymbol: string;
  tokenName: string;
  status: string;
  currentMultiplier: string;
  deployments: { contractAddress: string; chainId: number }[];
}

async function fetchAssets(): Promise<{ symbol: string; name: string; address: Address; multiplier: number }[]> {
  const res = await fetch(ASSETS_URL, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`assets api ${res.status}`);
  const data = (await res.json()) as { assets?: RhAsset[] };
  const out: { symbol: string; name: string; address: Address; multiplier: number }[] = [];
  for (const a of data.assets ?? []) {
    if (a.status !== "ASSET_STATUS_ACTIVE") continue;
    const dep = a.deployments?.find((d) => d.chainId === CONFIG.chainId);
    if (!dep || !a.tokenSymbol) continue;
    out.push({
      symbol: a.tokenSymbol.toUpperCase(),
      name: (a.tokenName ?? a.tokenSymbol).replace(/\s*•\s*Robinhood Token$/i, ""),
      address: getAddress(dep.contractAddress),
      multiplier: Number(a.currentMultiplier) || 1,
    });
  }
  if (out.length === 0) throw new Error("assets api returned no active chain-4663 assets");
  return out;
}

/** chainlink RDD: "Robinhood TSLA / USD" or "Robinhood SGOV-USD" -> proxy address */
async function fetchChainlinkFeeds(): Promise<Map<string, Address>> {
  const feeds = new Map<string, Address>();
  try {
    const res = await fetch(CHAINLINK_RDD_URL, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return feeds;
    const data = (await res.json()) as { name?: string; proxyAddress?: string }[];
    for (const f of data) {
      if (!f.name || !f.proxyAddress) continue;
      const m = f.name.match(/^Robinhood\s+([A-Z0-9.]+)\s*(?:\/|-)\s*USD$/i);
      if (m) feeds.set(m[1].toUpperCase(), getAddress(f.proxyAddress));
    }
  } catch {
    // feed directory unreachable — pool pricing covers us
  }
  // env overrides win
  for (const f of CONFIG.chainlinkFeeds) feeds.set(f.symbol, f.address);
  return feeds;
}

/** value BOTH sides of a pool: base balance + token balance x pool spot.
    v3 inventory is often heavily skewed, so base-side x2 badly underestimates. */
async function poolLiquidityUsd(
  token: Address,
  tokenDecimals: number,
  pool: Address,
  base: Address,
  ethUsdPrice: number | null,
): Promise<number> {
  const baseUsdPer = base.toLowerCase() === CONFIG.usdg.toLowerCase() ? 1 : (ethUsdPrice ?? 0);
  try {
    const [baseBal, tokenBal] = await Promise.all([
      withRetry(
        () => publicClient.readContract({ address: base, abi: erc20Abi, functionName: "balanceOf", args: [pool] }),
        "discovery.baseBal",
        { retries: 1 },
      ),
      withRetry(
        () => publicClient.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [pool] }),
        "discovery.tokenBal",
        { retries: 1 },
      ),
    ]);
    const baseUsd = (Number(baseBal) / 1e18) * baseUsdPer;
    let tokenUsd = 0;
    const spot = await poolSpot(token, pool, base); // token price in base units
    if (spot !== null && Number.isFinite(spot) && spot > 0 && spot < 1e12) {
      tokenUsd = (Number(tokenBal) / 10 ** tokenDecimals) * spot * baseUsdPer;
      if (!Number.isFinite(tokenUsd) || tokenUsd > 1e10) tokenUsd = 0; // garbage spot guard
    }
    return baseUsd + tokenUsd;
  } catch {
    return 0;
  }
}

/** deepest USDG/WETH v3 pool for a token + a usd liquidity estimate */
async function deepestPool(
  token: Address,
  tokenDecimals: number,
  ethUsdPrice: number | null,
): Promise<{ pool: Address; base: Address; liquidityUsd: number } | null> {
  let best: { pool: Address; base: Address; liquidityUsd: number } | null = null;
  for (const base of [CONFIG.usdg, CONFIG.weth]) {
    for (const fee of FEE_TIERS) {
      try {
        const pool = await withRetry(
          () =>
            publicClient.readContract({
              address: CONFIG.uniV3Factory,
              abi: factoryAbi,
              functionName: "getPool",
              args: [token, base, fee],
            }),
          "discovery.getPool",
          { retries: 1 },
        );
        if (!pool || pool.toLowerCase() === ZERO) continue;
        const usd = await poolLiquidityUsd(token, tokenDecimals, pool, base, ethUsdPrice);
        if (!best || usd > best.liquidityUsd) best = { pool, base, liquidityUsd: usd };
      } catch {
        // tier absent or rpc hiccup
      }
    }
  }
  return best;
}

async function upsertStock(s: DiscoveredStock): Promise<void> {
  const existing = await db.get<{ address: string }>("SELECT address FROM tokens WHERE address = ?", [
    s.address.toLowerCase(),
  ]);
  if (existing) {
    await db.run(
      `UPDATE tokens SET symbol = ?, kind = 'stock', decimals = ?, name = ?, pool = ?, pool_base = ?, chainlink_feed = ?, liquidity_usd = ?, ui_multiplier = ?, updated_at = ? WHERE address = ?`,
      [s.symbol, s.decimals, s.name, s.pool?.toLowerCase() ?? null, s.poolBase?.toLowerCase() ?? null, s.chainlinkFeed?.toLowerCase() ?? null, s.liquidityUsd, s.uiMultiplier, Date.now(), s.address.toLowerCase()],
    );
  } else {
    await db.run(
      `INSERT INTO tokens (address, symbol, kind, decimals, name, pool, pool_base, chainlink_feed, liquidity_usd, ui_multiplier, updated_at)
       VALUES (?, ?, 'stock', ?, ?, ?, ?, ?, ?, ?, ?)`,
      [s.address.toLowerCase(), s.symbol, s.decimals, s.name, s.pool?.toLowerCase() ?? null, s.poolBase?.toLowerCase() ?? null, s.chainlinkFeed?.toLowerCase() ?? null, s.liquidityUsd, s.uiMultiplier, Date.now()],
    );
  }
}

function register(s: DiscoveredStock): void {
  bySymbol.set(s.symbol, s);
  byAddress.set(s.address.toLowerCase(), s);
}

/** load previously-discovered stocks from the db (offline fallback + fast boot) */
export async function loadStocksFromDb(): Promise<number> {
  const rows = await db.all<{
    address: string; symbol: string; name: string | null; decimals: number; pool: string | null; pool_base: string | null;
    chainlink_feed: string | null; liquidity_usd: number | null; ui_multiplier: number; ta_score: number | null;
  }>("SELECT * FROM tokens WHERE kind = 'stock'");
  for (const r of rows) {
    register({
      symbol: r.symbol.toUpperCase(),
      name: r.name ?? r.symbol,
      address: getAddress(r.address),
      decimals: Number(r.decimals ?? 18),
      pool: r.pool ? getAddress(r.pool) : null,
      poolBase: r.pool_base ? getAddress(r.pool_base) : null,
      chainlinkFeed: r.chainlink_feed ? getAddress(r.chainlink_feed) : null,
      liquidityUsd: Number(r.liquidity_usd ?? 0),
      uiMultiplier: Number(r.ui_multiplier ?? 1),
      taScore: r.ta_score === null ? null : Number(r.ta_score),
    });
  }
  return rows.length;
}

/** full discovery pass: assets api + chainlink feeds + deepest pools */
export async function discoverStocks(): Promise<void> {
  let assets: Awaited<ReturnType<typeof fetchAssets>>;
  try {
    assets = await fetchAssets();
  } catch (err) {
    say("watch", `kumo couldn't reach the asset registry (${(err as Error).message.slice(0, 60)}). using what it remembers.`);
    return; // db-loaded registry stays in effect
  }

  // env extras/overrides ride along
  for (const t of CONFIG.stockTokens) {
    if (!assets.some((a) => a.address.toLowerCase() === t.address.toLowerCase())) {
      assets.push({ symbol: t.symbol, name: t.symbol, address: t.address, multiplier: 1 });
    }
  }

  const feeds = await fetchChainlinkFeeds();
  const eu = await ethUsd().catch(() => null);
  const newSymbols: string[] = [];

  // small concurrency to be gentle on the rpc (each asset costs up to 9 reads)
  const BATCH = 5;
  for (let i = 0; i < assets.length; i += BATCH) {
    await Promise.all(
      assets.slice(i, i + BATCH).map(async (a) => {
        const known = byAddress.get(a.address.toLowerCase());
        let decimals = 18;
        try {
          decimals = await withRetry(
            () => publicClient.readContract({ address: a.address, abi: erc20Abi, functionName: "decimals" }),
            "discovery.decimals",
            { retries: 0 },
          );
        } catch {
          // assume 18
        }
        // re-resolve pools only when unknown or previously poolless; refresh liquidity when known
        let pool = known?.pool ?? null;
        let poolBase = known?.poolBase ?? null;
        let liquidityUsd = known?.liquidityUsd ?? 0;
        if (!pool) {
          const found = await deepestPool(a.address, decimals, eu);
          if (found) {
            pool = found.pool;
            poolBase = found.base;
            liquidityUsd = found.liquidityUsd;
          }
        } else {
          const refreshed = await poolLiquidityUsd(a.address, decimals, pool, poolBase!, eu);
          if (refreshed > 0) liquidityUsd = refreshed;
        }
        const stock: DiscoveredStock = {
          symbol: a.symbol,
          name: a.name,
          address: a.address,
          decimals,
          pool,
          poolBase,
          chainlinkFeed: feeds.get(a.symbol) ?? null,
          liquidityUsd,
          uiMultiplier: a.multiplier,
          taScore: known?.taScore ?? null,
        };
        if (!known) newSymbols.push(a.symbol);
        register(stock);
        await upsertStock(stock);
      }),
    );
  }

  if (newSymbols.length > 0) {
    say(
      "watch",
      byAddress.size === newSymbols.length
        ? `kumo discovered ${newSymbols.length} stock-tokens on the chain. so many to watch...`
        : `kumo discovered ${newSymbols.length} new stock-token${newSymbols.length === 1 ? "" : "s"}: ${newSymbols.slice(0, 6).join(", ")}${newSymbols.length > 6 ? "..." : ""}`,
    );
  }
}
