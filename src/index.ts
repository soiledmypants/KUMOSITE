// kumo wakes up here.
import "dotenv/config";
import { CONFIG } from "./config.js";
import { initDb, db } from "./db.js";
import { setFeedPersist } from "./feed.js";
import { say, lines } from "./voice.js";
import { buildServer } from "./server.js";
import { initStocks, scanStocksOnce } from "./scanner/stocks.js";
import { discoverStocks } from "./scanner/discovery.js";
import { scanWalletsOnce, walletCount } from "./scanner/wallets.js";
import { scanMemecoinsOnce } from "./scanner/memecoins.js";
import { scoreIntelOnce } from "./agents/reputation.js";
import { keeperCycleOnce } from "./staking/keeper.js";
import { startMockTicker } from "./mock.js";

function loop(label: string, fn: () => Promise<void>, ms: number): NodeJS.Timeout {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await fn();
    } catch (err) {
      console.error(`[kumo] ${label} loop error:`, (err as Error).message);
    } finally {
      running = false;
    }
  };
  void tick();
  const t = setInterval(() => void tick(), ms);
  t.unref();
  return t;
}

async function main(): Promise<void> {
  await initDb();
  setFeedPersist((ev) => {
    void db.run("INSERT INTO feed_log (ts, kind, line) VALUES (?, ?, ?)", [ev.ts, ev.kind, ev.line]);
  });

  const app = buildServer();
  app.listen(CONFIG.port, () => {
    say("wake", lines.awake());
    console.log(`[kumo] listening on :${CONFIG.port} (mock=${CONFIG.mock}, db=${db.kind})`);
  });

  if (CONFIG.mock) {
    startMockTicker();
    return;
  }

  await initStocks();
  say("watch", lines.watching(await walletCount()));

  loop("wallets", scanWalletsOnce, CONFIG.walletScanMs);
  loop("stocks", scanStocksOnce, CONFIG.stockScanMs);
  loop("discovery", discoverStocks, CONFIG.stockDiscoveryMs);
  loop("memecoins", scanMemecoinsOnce, CONFIG.memecoinScanMs);
  loop("rep-scorer", scoreIntelOnce, CONFIG.repScoreIntervalMs);
  if (CONFIG.stakingAddress) {
    loop("keeper", keeperCycleOnce, CONFIG.keeperIntervalMs);
  }
}

process.on("SIGTERM", () => {
  say("zzz", lines.sleeping());
  setTimeout(() => process.exit(0), 300);
});
process.on("SIGINT", () => {
  say("zzz", lines.sleeping());
  setTimeout(() => process.exit(0), 300);
});

main().catch((err) => {
  console.error("[kumo] failed to wake up:", err);
  process.exit(1);
});
