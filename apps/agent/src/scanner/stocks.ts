// tokenized-stock watcher: discovery-driven universe, ta-scored every cycle,
// market-hours awareness. price recording + signals live in ta.ts now.
import { say, lines } from "../voice.js";
import { allStocks, discoverStocks, loadStocksFromDb } from "./discovery.js";
import { scoreAllStocks, rankingFromDb, type TaMetrics } from "./ta.js";

let marketWasOpen: boolean | null = null;

export function usMarketOpen(now = new Date()): boolean {
  // 13:30–20:00 UTC mon–fri ≈ 9:30–16:00 ET; close enough for vibes
  const day = now.getUTCDay();
  if (day === 0 || day === 6) return false;
  const mins = now.getUTCHours() * 60 + now.getUTCMinutes();
  return mins >= 13 * 60 + 30 && mins < 20 * 60;
}

/** boot: load remembered stocks fast, then run a live discovery pass */
export async function initStocks(): Promise<void> {
  const remembered = await loadStocksFromDb();
  if (remembered > 0) say("watch", `kumo remembers ${remembered} stock-tokens.`);
  await discoverStocks();
}

export async function scanStocksOnce(): Promise<void> {
  await scoreAllStocks();

  const open = usMarketOpen();
  if (marketWasOpen === true && !open) say("zzz", lines.stockSleeping());
  if (marketWasOpen === false && open) say("wake", "the stock market opened. kumo perks up.");
  marketWasOpen = open;
}

export interface StockView {
  address: string;
  symbol: string;
  name: string;
  price_usd: number | null;
  ta_score: number | null;
  ui_multiplier: number;
  market: "open" | "closed";
  change_24h: number | null;
  liquidity_usd: number;
}

export async function stocksView(): Promise<StockView[]> {
  const metrics = new Map<string, TaMetrics>((await rankingFromDb()).map((m) => [m.address, m]));
  const market = usMarketOpen() ? ("open" as const) : ("closed" as const);
  return allStocks()
    .map((s) => {
      const m = metrics.get(s.address.toLowerCase());
      return {
        address: s.address.toLowerCase(),
        symbol: s.symbol,
        name: s.name,
        price_usd: m?.price_usd ?? null,
        ta_score: s.taScore ?? m?.ta_score ?? null,
        ui_multiplier: s.uiMultiplier,
        market,
        change_24h: m?.long_momentum_pct ?? null,
        liquidity_usd: Math.round(s.liquidityUsd),
      };
    })
    .sort((a, b) => (b.ta_score ?? -1) - (a.ta_score ?? -1));
}
