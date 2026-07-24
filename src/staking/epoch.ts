// per-round stock pick: every payout round the ta engine picks the CURRENT
// best-scored stock that passes the liquidity screen — the rotation can differ
// every round. no weekly stickiness, and since rewards are airdropped directly
// (not streamed through the staking contract) there is no addReward gate.
// KUMO_EPOCH_STOCK env still overrides with a fixed address.
import { parseAbi, type Address, getAddress } from "viem";
import { CONFIG } from "../config.js";
import { publicClient } from "../clients.js";
import { withRetry } from "../rpc.js";
import { setMeta } from "../db.js";
import { stockByAddress, allStocks } from "../scanner/discovery.js";
import { rankingFromDb } from "../scanner/ta.js";

const MIN_RESERVE_USD = 250_000;
const MIN_VOLUME_USD = 500_000;

const erc20Abi = parseAbi(["function balanceOf(address) view returns (uint256)"]);

export interface RoundPick {
  symbol: string;
  address: Address;
  passesScreen: boolean;
  screenNote: string;
  taScore: number | null;
}

async function geckoPool(pool: string): Promise<{ reserve: number; volume: number } | null> {
  try {
    const res = await fetch(`https://api.geckoterminal.com/api/v2/networks/robinhood/pools/${pool}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      data?: { attributes?: { reserve_in_usd?: string; volume_usd?: { h24?: string } } };
    };
    const a = data.data?.attributes;
    if (!a) return null;
    return { reserve: Number(a.reserve_in_usd ?? 0), volume: Number(a.volume_usd?.h24 ?? 0) };
  } catch {
    return null;
  }
}

async function onchainReserveUsd(pool: Address, base: Address): Promise<number | null> {
  try {
    const baseBal = await withRetry(
      () => publicClient.readContract({ address: base, abi: erc20Abi, functionName: "balanceOf", args: [pool] }),
      "round.reserve",
      { retries: 1 },
    );
    return base.toLowerCase() === CONFIG.usdg.toLowerCase() ? (Number(baseBal) / 1e18) * 2 : null;
  } catch {
    return null;
  }
}

/** liquidity screen: geckoterminal reserve+volume, on-chain reserve fallback */
export async function screen(address: string): Promise<{ passes: boolean; note: string }> {
  const stock = stockByAddress(address);
  if (!stock?.pool || !stock.poolBase) return { passes: false, note: "no pool discovered" };
  const gecko = await geckoPool(stock.pool);
  if (gecko) {
    const passes = gecko.reserve >= MIN_RESERVE_USD && gecko.volume >= MIN_VOLUME_USD;
    return {
      passes,
      note: `geckoterminal: reserve $${Math.round(gecko.reserve).toLocaleString()}, 24h vol $${Math.round(gecko.volume).toLocaleString()}`,
    };
  }
  const reserve = (await onchainReserveUsd(stock.pool, stock.poolBase)) ?? stock.liquidityUsd;
  return {
    passes: reserve >= MIN_RESERVE_USD,
    note: `on-chain fallback: reserve ≈ $${Math.round(reserve).toLocaleString()} (volume unverified)`,
  };
}

/** the rotation: best current ta score among screen-passing stocks */
export async function pickRoundStock(): Promise<RoundPick> {
  if (CONFIG.epochStock !== "auto" && /^0x[0-9a-fA-F]{40}$/.test(CONFIG.epochStock)) {
    const known = stockByAddress(CONFIG.epochStock);
    return {
      symbol: known?.symbol ?? "STOCK",
      address: getAddress(CONFIG.epochStock),
      passesScreen: true,
      screenNote: "manual override via KUMO_EPOCH_STOCK",
      taScore: known?.taScore ?? null,
    };
  }

  const ranked = await rankingFromDb();
  for (const candidate of ranked.slice(0, 5)) {
    if ((stockByAddress(candidate.address)?.liquidityUsd ?? 0) < MIN_RESERVE_USD) continue;
    const s = await screen(candidate.address);
    if (s.passes) {
      await setMeta("epoch_stock", candidate.address.toLowerCase());
      return {
        symbol: candidate.symbol,
        address: getAddress(candidate.address),
        passesScreen: true,
        screenNote: s.note,
        taScore: candidate.ta_score,
      };
    }
  }

  // nothing passes (or ta cold) — fall back to NVDA / first discovered, flagged
  const fallback = allStocks().find((s) => s.symbol === "NVDA") ?? allStocks()[0];
  if (!fallback) throw new Error("no stock tokens discovered yet");
  const s = await screen(fallback.address);
  return {
    symbol: fallback.symbol,
    address: fallback.address,
    passesScreen: s.passes,
    screenNote: `no ta winner passed the screen; defaulting to ${fallback.symbol}. ${s.note}`,
    taScore: fallback.taScore,
  };
}
