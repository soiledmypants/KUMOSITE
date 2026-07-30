// kumo's ta scoring engine. every stock scan cycle (5 min) each discovered stock
// gets a composite 0..1 score from: short/long momentum (stored price history),
// swap-volume delta on its pool, volatility of 5-min returns, and pool liquidity.
// fast loop: strong scores feed the signal engine. slow loop: epoch.ts uses the
// weekly ranking to pick the staking payout stock.
import { parseAbiItem, type Address } from "viem";
import { CONFIG } from "../config.js";
import { publicClient } from "../clients.js";
import { withRetry } from "../rpc.js";
import { db } from "../db.js";
import { say } from "../voice.js";
import { priceUsd } from "./prices.js";
import { allStocks, type DiscoveredStock } from "./discovery.js";
import { emitSignal } from "./signals.js";

const swapEvent = parseAbiItem(
  "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)",
);

const HISTORY_KEEP_MS = 14 * 86_400_000;
const SIGNAL_COOLDOWN_MS = 30 * 60_000;

export interface TaMetrics {
  symbol: string;
  address: string;
  price_usd: number | null;
  ta_score: number;
  short_momentum_pct: number | null; // ~1h
  long_momentum_pct: number | null; // ~24h
  volume_spike: number; // swaps this window / rolling avg (1 = normal)
  volatility_pct: number | null; // stddev of 5-min returns, in %
  liquidity_usd: number;
  scored_at: number;
}

const swapHistory = new Map<string, number[]>(); // pool -> recent per-cycle swap counts
const lastSignalAt = new Map<string, number>();
const latest = new Map<string, TaMetrics>();

function liquidityScore(usd: number): number {
  if (usd <= 10_000) return 0;
  // $10k -> 0, ~$3.2M -> 1, log-scaled
  return Math.max(0, Math.min(1, Math.log10(usd / 10_000) / 2.5));
}

async function priceAt(token: string, agoMs: number, tolMs: number): Promise<number | null> {
  const target = Date.now() - agoMs;
  const row = await db.get<{ price: number; ts: number }>(
    "SELECT price, ts FROM price_history WHERE token = ? AND ts <= ? ORDER BY ts DESC LIMIT 1",
    [token, target],
  );
  if (!row) return null;
  if (Math.abs(Number(row.ts) - target) > tolMs) return null;
  return Number(row.price);
}

async function volatilityPct(token: string): Promise<number | null> {
  const rows = await db.all<{ price: number }>(
    "SELECT price FROM price_history WHERE token = ? AND ts > ? ORDER BY ts ASC",
    [token, Date.now() - 86_400_000],
  );
  if (rows.length < 12) return null;
  const returns: number[] = [];
  for (let i = 1; i < rows.length; i++) {
    const prev = Number(rows[i - 1].price);
    if (prev > 0) returns.push((Number(rows[i].price) - prev) / prev);
  }
  if (returns.length < 10) return null;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length;
  return Math.sqrt(variance) * 100;
}

async function swapSpike(pool: Address): Promise<number> {
  try {
    const head = await withRetry(() => publicClient.getBlockNumber(), "ta.head", { retries: 1 });
    const windowBlocks = BigInt(Math.floor(CONFIG.stockScanMs / 100)); // ~1 block / 100ms
    const fromBlock = head > windowBlocks ? head - windowBlocks : 0n;
    const swaps = await withRetry(
      () => publicClient.getLogs({ address: pool, event: swapEvent, fromBlock, toBlock: head }),
      "ta.swaps",
      { retries: 1 },
    );
    const count = swaps.length;
    const hist = swapHistory.get(pool) ?? [];
    const avg = hist.length ? hist.reduce((a, b) => a + b, 0) / hist.length : 0;
    hist.push(count);
    if (hist.length > 24) hist.shift();
    swapHistory.set(pool, hist);
    if (hist.length < 3) return 1; // warming up
    return avg > 0 ? count / avg : count > 0 ? 2 : 1;
  } catch {
    return 1;
  }
}

function composite(m: {
  shortMom: number | null;
  longMom: number | null;
  spike: number;
  volPct: number | null;
  liq: number;
}): number {
  const shortM = (m.shortMom ?? 0) / 100;
  const longM = (m.longMom ?? 0) / 100;
  const momScore = 0.5 + 0.5 * Math.tanh(shortM * 30 + longM * 8);
  const volScore = Math.max(0, Math.min(1, (m.spike - 0.5) / 2.5));
  // moderate volatility is fine; > 2% per 5-min bar is chaos
  const volPenalty = m.volPct === null ? 0 : Math.max(0, Math.min(1, (m.volPct - 0.8) / 1.2));
  const liqScore = liquidityScore(m.liq);
  const raw = 0.4 * momScore + 0.2 * volScore + 0.3 * liqScore + 0.1 * (1 - volPenalty);
  return Math.round(Math.max(0, Math.min(1, raw)) * 1000) / 1000;
}

async function maybeSignal(stock: DiscoveredStock, m: TaMetrics): Promise<void> {
  const key = stock.address.toLowerCase();
  if ((lastSignalAt.get(key) ?? 0) > Date.now() - SIGNAL_COOLDOWN_MS) return;
  const shortM = m.short_momentum_pct ?? 0;
  const longM = m.long_momentum_pct ?? 0;

  let kind: "buy" | "avoid" | "watch" | null = null;
  let line: string | null = null;
  if (m.ta_score >= 0.65 && shortM > 0.6) {
    kind = "buy";
    line = `kumo ran the numbers on ${stock.symbol}. kumo likes what it sees.`;
  } else if (shortM < -2 && longM < 0) {
    kind = "avoid";
    line = `kumo ran the numbers on ${stock.symbol}. the chart made kumo frown.`;
  } else if (m.volume_spike >= 3 && Math.abs(shortM) < 0.6) {
    kind = "watch";
    line = `kumo ran the numbers on ${stock.symbol}. something is stirring under the surface...`;
  }
  if (!kind || !line) return;

  lastSignalAt.set(key, Date.now());
  await emitSignal({
    kind,
    subjectType: "stock",
    subject: key,
    symbol: stock.symbol,
    kumoScore: kind === "avoid" ? Math.max(0.5, 1 - m.ta_score) : m.ta_score,
    line,
  });
}

/** score one stock: record history, compute metrics, persist, maybe signal */
async function scoreStock(stock: DiscoveredStock): Promise<TaMetrics | null> {
  const key = stock.address.toLowerCase();
  const p = await priceUsd(stock.address, stock.symbol);
  if (p) {
    await db.run("INSERT INTO price_history (token, ts, price) VALUES (?, ?, ?)", [key, Date.now(), p.price]);
  }

  const [short1h, long24h, volPct] = await Promise.all([
    priceAt(key, 3_600_000, 1_800_000),
    priceAt(key, 86_400_000, 6 * 3_600_000),
    volatilityPct(key),
  ]);
  const spike = stock.pool ? await swapSpike(stock.pool) : 1;

  const price = p?.price ?? null;
  const shortMom = price && short1h ? ((price - short1h) / short1h) * 100 : null;
  const longMom = price && long24h ? ((price - long24h) / long24h) * 100 : null;

  const score = composite({
    shortMom,
    longMom,
    spike,
    volPct,
    liq: stock.liquidityUsd,
  });

  const m: TaMetrics = {
    symbol: stock.symbol,
    address: key,
    price_usd: price,
    ta_score: score,
    short_momentum_pct: shortMom === null ? null : Math.round(shortMom * 100) / 100,
    long_momentum_pct: longMom === null ? null : Math.round(longMom * 100) / 100,
    volume_spike: Math.round(spike * 100) / 100,
    volatility_pct: volPct === null ? null : Math.round(volPct * 100) / 100,
    liquidity_usd: Math.round(stock.liquidityUsd),
    scored_at: Date.now(),
  };
  latest.set(key, m);
  stock.taScore = score;
  await db.run("UPDATE tokens SET ta_score = ?, ta_json = ?, last_price = ?, updated_at = ? WHERE address = ?", [
    score,
    JSON.stringify(m),
    price,
    Date.now(),
    key,
  ]);
  await maybeSignal(stock, m);
  return m;
}

/** the fast loop: score every discovered stock. called each stock scan cycle. */
export async function scoreAllStocks(): Promise<void> {
  const stocks = allStocks();
  if (stocks.length === 0) return;
  const BATCH = 6;
  for (let i = 0; i < stocks.length; i += BATCH) {
    await Promise.all(stocks.slice(i, i + BATCH).map((s) => scoreStock(s).catch(() => null)));
  }
  await db.run("DELETE FROM price_history WHERE ts < ?", [Date.now() - HISTORY_KEEP_MS]);
}

/** full ranking, best first — the /stocks/ranking payload and the epoch picker input */
export function ranking(): TaMetrics[] {
  return [...latest.values()].sort((a, b) => b.ta_score - a.ta_score);
}

/** ranking fallback from db for fresh processes that haven't scored yet */
export async function rankingFromDb(): Promise<TaMetrics[]> {
  if (latest.size > 0) return ranking();
  const rows = await db.all<{ ta_json: string | null }>(
    "SELECT ta_json FROM tokens WHERE kind = 'stock' AND ta_json IS NOT NULL",
  );
  const out: TaMetrics[] = [];
  for (const r of rows) {
    try {
      if (r.ta_json) out.push(JSON.parse(r.ta_json) as TaMetrics);
    } catch {
      // stale row
    }
  }
  return out.sort((a, b) => b.ta_score - a.ta_score);
}
