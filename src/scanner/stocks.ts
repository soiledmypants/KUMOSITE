// tokenized-stock watcher: prices via chainlink-or-pool, ERC-8056 uiMultiplier,
// market-hours awareness, wake-up signals on unusual moves.
import { parseAbi, type Address } from "viem";
import { CONFIG } from "../config.js";
import { publicClient } from "../clients.js";
import { withRetry } from "../rpc.js";
import { db, getMeta, setMeta } from "../db.js";
import { lines, say } from "../voice.js";
import { priceUsd } from "./prices.js";
import { emitSignal } from "./signals.js";

const erc8056Abi = parseAbi(["function uiMultiplier() view returns (uint256)"]);

const wakeCooldown = new Map<string, number>();
let marketWasOpen: boolean | null = null;

export async function seedStockTokens(): Promise<void> {
  for (const t of CONFIG.stockTokens) {
    await db.run(
      `INSERT INTO tokens (address, symbol, kind, decimals, updated_at) VALUES (?, ?, 'stock', 18, ?)
       ON CONFLICT (address) DO UPDATE SET kind = 'stock', symbol = ?`,
      [t.address.toLowerCase(), t.symbol, Date.now(), t.symbol],
    );
  }
}

function usMarketOpen(now = new Date()): boolean {
  // 13:30–20:00 UTC mon–fri ≈ 9:30–16:00 ET; close enough for vibes, chainlink staleness overrides
  const day = now.getUTCDay();
  if (day === 0 || day === 6) return false;
  const mins = now.getUTCHours() * 60 + now.getUTCMinutes();
  return mins >= 13 * 60 + 30 && mins < 20 * 60;
}

export async function scanStocksOnce(): Promise<void> {
  let anyStale = false;
  let anyFresh = false;

  for (const t of CONFIG.stockTokens) {
    const key = t.address.toLowerCase();
    const res = await priceUsd(t.address, t.symbol);
    if (!res) continue;
    if (res.source === "chainlink" && res.stale) anyStale = true;
    else anyFresh = true;

    let uiMultiplier = 1;
    try {
      const m = await withRetry(
        () => publicClient.readContract({ address: t.address, abi: erc8056Abi, functionName: "uiMultiplier" }),
        "uiMultiplier",
        { retries: 0 },
      );
      uiMultiplier = Number(m) / 1e18 || 1;
    } catch {
      // token may not expose the extension; display multiplier stays 1
    }

    const prev = await db.get<{ last_price: number }>("SELECT last_price FROM tokens WHERE address = ?", [key]);
    const prevPrice = prev?.last_price ? Number(prev.last_price) : null;
    await db.run(
      "UPDATE tokens SET last_price = ?, ui_multiplier = ?, updated_at = ? WHERE address = ?",
      [res.price, uiMultiplier, Date.now(), key],
    );

    // 24h reference for change_24h
    const refRaw = await getMeta(`stock_ref:${t.symbol}`);
    if (!refRaw || Date.now() - JSON.parse(refRaw).ts > 86_400_000) {
      await setMeta(`stock_ref:${t.symbol}`, JSON.stringify({ price: res.price, ts: Date.now() }));
    }

    if (prevPrice && prevPrice > 0) {
      const movePct = Math.abs((res.price - prevPrice) / prevPrice) * 100;
      const cooled = (wakeCooldown.get(key) ?? 0) < Date.now() - 30 * 60_000;
      if (movePct >= 1 && cooled) {
        wakeCooldown.set(key, Date.now());
        say("signal", lines.stockWaking(t.symbol));
        await emitSignal({
          kind: res.price > prevPrice ? "buy" : "watch",
          subjectType: "stock",
          subject: key,
          symbol: t.symbol,
          kumoScore: Math.min(0.8, 0.4 + movePct / 10),
          line:
            res.price > prevPrice
              ? `kumo noticed ${t.symbol}-token waking up... it moved ${movePct.toFixed(1)}%.`
              : `kumo is watching ${t.symbol}-token slide ${movePct.toFixed(1)}%...`,
        });
      }
    }
  }

  const open = anyFresh && !(!anyFresh && anyStale) ? usMarketOpen() || anyFresh : usMarketOpen();
  if (marketWasOpen === true && !open) say("zzz", lines.stockSleeping());
  if (marketWasOpen === false && open) say("wake", "the stock market opened. kumo perks up.");
  marketWasOpen = open;
}

export interface StockView {
  address: string;
  symbol: string;
  price_usd: number | null;
  ui_multiplier: number;
  market: "open" | "closed";
  change_24h: number | null;
}

export async function stocksView(): Promise<StockView[]> {
  const out: StockView[] = [];
  for (const t of CONFIG.stockTokens) {
    const row = await db.get<{ last_price: number; ui_multiplier: number }>(
      "SELECT last_price, ui_multiplier FROM tokens WHERE address = ?",
      [t.address.toLowerCase()],
    );
    const refRaw = await getMeta(`stock_ref:${t.symbol}`);
    const ref = refRaw ? (JSON.parse(refRaw) as { price: number }) : null;
    const price = row?.last_price ? Number(row.last_price) : null;
    out.push({
      address: t.address.toLowerCase(),
      symbol: t.symbol,
      price_usd: price,
      ui_multiplier: row?.ui_multiplier ? Number(row.ui_multiplier) : 1,
      market: usMarketOpen() ? "open" : "closed",
      change_24h: price && ref?.price ? ((price - ref.price) / ref.price) * 100 : null,
    });
  }
  return out;
}
