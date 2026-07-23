// which stock does kumo pay out this epoch? weekly ta-based pick:
// highest composite score among stocks passing the liquidity screen
// (reserve >= $250k, 24h vol >= $500k). if the winner isn't a registered
// reward token yet, kumo alerts and keeps the current stock until the
// cold-key addReward ceremony. KUMO_EPOCH_STOCK env still overrides.
import { parseAbi, type Address, getAddress } from "viem";
import { CONFIG } from "../config.js";
import { publicClient } from "../clients.js";
import { withRetry } from "../rpc.js";
import { getMeta, setMeta } from "../db.js";
import { say } from "../voice.js";
import { stockByAddress, allStocks } from "../scanner/discovery.js";
import { rankingFromDb } from "../scanner/ta.js";

const MIN_RESERVE_USD = 250_000;
const MIN_VOLUME_USD = 500_000;
const EPOCH_PERIOD_MS = Number(process.env.EPOCH_PERIOD_MS ?? 7 * 86_400_000);

const erc20Abi = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const stakingAbi = parseAbi(["function isRewardToken(address) view returns (bool)"]);

export interface EpochPick {
  symbol: string;
  address: Address;
  passesScreen: boolean;
  screenNote: string;
  pendingWinner?: { symbol: string; address: string; note: string };
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
      "epoch.reserve",
      { retries: 1 },
    );
    // usdg ≈ $1; weth pools are screened by discovery's liquidity estimate anyway
    return base.toLowerCase() === CONFIG.usdg.toLowerCase() ? (Number(baseBal) / 1e18) * 2 : null;
  } catch {
    return null;
  }
}

/** liquidity screen: on-chain/discovery reserve + geckoterminal 24h volume */
async function screen(address: string): Promise<{ passes: boolean; note: string }> {
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
    passes: reserve >= MIN_RESERVE_USD, // volume unverifiable offline — reserve-only fallback
    note: `on-chain fallback: reserve ≈ $${Math.round(reserve).toLocaleString()} (volume unverified)`,
  };
}

async function isRegisteredReward(address: string): Promise<boolean | null> {
  if (!CONFIG.stakingAddress) return null; // staking not deployed yet
  try {
    return await withRetry(
      () =>
        publicClient.readContract({
          address: CONFIG.stakingAddress as Address,
          abi: stakingAbi,
          functionName: "isRewardToken",
          args: [getAddress(address)],
        }),
      "epoch.isRewardToken",
      { retries: 1 },
    );
  } catch {
    return null;
  }
}

export async function epochStock(): Promise<EpochPick> {
  // manual override
  if (CONFIG.epochStock !== "auto" && /^0x[0-9a-fA-F]{40}$/.test(CONFIG.epochStock)) {
    const known = stockByAddress(CONFIG.epochStock);
    return {
      symbol: known?.symbol ?? "STOCK",
      address: getAddress(CONFIG.epochStock),
      passesScreen: true,
      screenNote: "manual override via KUMO_EPOCH_STOCK",
    };
  }

  const currentAddr = (await getMeta("epoch_stock")) ?? "";
  const pickedAt = Number((await getMeta("epoch_picked_at")) ?? 0);
  const current = stockByAddress(currentAddr) ?? allStocks().find((s) => s.symbol === "NVDA") ?? allStocks()[0];
  if (!current) throw new Error("no stock tokens discovered yet");

  // within the weekly epoch: sticky — just re-verify the screen
  if (currentAddr && Date.now() - pickedAt < EPOCH_PERIOD_MS) {
    const s = await screen(current.address);
    return { symbol: current.symbol, address: current.address, passesScreen: s.passes, screenNote: s.note };
  }

  // weekly re-pick: best ta score among screen-passing stocks (check top 5 candidates)
  const ranked = await rankingFromDb();
  let winner: { symbol: string; address: string; note: string } | null = null;
  for (const candidate of ranked.slice(0, 5)) {
    if ((stockByAddress(candidate.address)?.liquidityUsd ?? 0) < MIN_RESERVE_USD) continue;
    const s = await screen(candidate.address);
    if (s.passes) {
      winner = { symbol: candidate.symbol, address: candidate.address, note: s.note };
      break;
    }
  }

  if (!winner) {
    // nothing passes (or ta hasn't warmed up) — stay on current, note it
    const s = await screen(current.address);
    await setMeta("epoch_picked_at", String(Date.now()));
    return {
      symbol: current.symbol,
      address: current.address,
      passesScreen: s.passes,
      screenNote: `no ta winner passed the screen this week; staying with ${current.symbol}. ${s.note}`,
    };
  }

  const sameAsCurrent = winner.address.toLowerCase() === current.address.toLowerCase();
  if (sameAsCurrent) {
    await setMeta("epoch_stock", current.address.toLowerCase());
    await setMeta("epoch_picked_at", String(Date.now()));
    return { symbol: current.symbol, address: current.address, passesScreen: true, screenNote: winner.note };
  }

  // ta wants a different stock — only switch if it's a registered reward token
  const registered = await isRegisteredReward(winner.address);
  if (registered === false) {
    const s = await screen(current.address);
    return {
      symbol: current.symbol,
      address: current.address,
      passesScreen: s.passes,
      screenNote: s.note,
      pendingWinner: {
        ...winner,
        note: `ta winner ${winner.symbol} is not a registered reward token — run the cold-key addReward ceremony to switch. ${winner.note}`,
      },
    };
  }

  // registered (or staking not deployed yet — free to switch for display)
  await setMeta("epoch_stock", winner.address.toLowerCase());
  await setMeta("epoch_picked_at", String(Date.now()));
  say("stake", `new epoch. kumo pays out in ${winner.symbol} this week. kumo liked the chart.`);
  return { symbol: winner.symbol, address: getAddress(winner.address), passesScreen: true, screenNote: winner.note };
}
