// which stock does kumo pay out this epoch? env override, else sticky auto-pick
// behind a liquidity screen (geckoterminal with on-chain fallback).
import { parseAbi, type Address } from "viem";
import { CONFIG } from "../config.js";
import { publicClient } from "../clients.js";
import { withRetry } from "../rpc.js";
import { getMeta, setMeta } from "../db.js";

const MIN_RESERVE_USD = 250_000;
const MIN_VOLUME_USD = 500_000;

const erc20Abi = parseAbi(["function balanceOf(address) view returns (uint256)"]);

export interface EpochPick {
  symbol: string;
  address: Address;
  passesScreen: boolean;
  screenNote: string;
}

async function geckoScreen(pool: string): Promise<{ reserve: number; volume: number } | null> {
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

async function onchainReserveUsd(pool: Address): Promise<number | null> {
  // fallback: usdg side of the pool ≈ half the reserve, usdg ≈ $1
  try {
    const usdgBal = await withRetry(
      () => publicClient.readContract({ address: CONFIG.usdg, abi: erc20Abi, functionName: "balanceOf", args: [pool] }),
      "usdg.balanceOf(pool)",
      { retries: 1 },
    );
    return (Number(usdgBal) / 1e18) * 2;
  } catch {
    return null;
  }
}

export async function epochStock(): Promise<EpochPick> {
  // manual override
  if (CONFIG.epochStock !== "auto" && /^0x[0-9a-fA-F]{40}$/.test(CONFIG.epochStock)) {
    const known = CONFIG.stockTokens.find((t) => t.address.toLowerCase() === CONFIG.epochStock.toLowerCase());
    return {
      symbol: known?.symbol ?? "STOCK",
      address: CONFIG.epochStock as Address,
      passesScreen: true,
      screenNote: "manual override via KUMO_EPOCH_STOCK",
    };
  }

  // sticky: keep the current epoch stock while it still passes
  const current = (await getMeta("epoch_stock")) ?? CONFIG.stockTokens[0]?.address ?? "";
  const pick = CONFIG.stockTokens.find((t) => t.address.toLowerCase() === current.toLowerCase()) ?? CONFIG.stockTokens[0];
  if (!pick) throw new Error("no stock tokens configured");

  let passes = false;
  let note = "";
  const gecko = await geckoScreen(CONFIG.nvdaUsdgPool);
  if (gecko) {
    passes = gecko.reserve >= MIN_RESERVE_USD && gecko.volume >= MIN_VOLUME_USD;
    note = `geckoterminal: reserve $${Math.round(gecko.reserve).toLocaleString()}, 24h vol $${Math.round(gecko.volume).toLocaleString()}`;
  } else {
    const reserve = await onchainReserveUsd(CONFIG.nvdaUsdgPool);
    passes = reserve !== null && reserve >= MIN_RESERVE_USD;
    note = reserve !== null ? `on-chain fallback: reserve ≈ $${Math.round(reserve).toLocaleString()}` : "screen unavailable";
  }

  await setMeta("epoch_stock", pick.address.toLowerCase());
  return { symbol: pick.symbol, address: pick.address, passesScreen: passes, screenNote: note };
}
