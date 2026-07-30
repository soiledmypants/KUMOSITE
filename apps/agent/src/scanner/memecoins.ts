// memecoin scanner: new v3 pools (PoolCreated watermark scan) + swap-volume spikes.
import { formatUnits, parseAbiItem, type Address } from "viem";
import { CONFIG } from "../config.js";
import { publicClient } from "../clients.js";
import { withRetry } from "../rpc.js";
import { db, getMeta, setMeta } from "../db.js";
import { lines, say } from "../voice.js";
import { emitSignal } from "./signals.js";

const poolCreatedEvent = parseAbiItem(
  "event PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool)",
);
const swapEvent = parseAbiItem(
  "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)",
);

const META_BLOCK = "memecoin_last_block";
const BACKFILL_BLOCKS = 20_000n;
const swapHistory = new Map<string, number[]>(); // pool -> swap counts per cycle (rolling)

function isBase(addr: string): boolean {
  const a = addr.toLowerCase();
  return a === CONFIG.weth.toLowerCase() || a === CONFIG.usdg.toLowerCase();
}

export async function scanMemecoinsOnce(): Promise<void> {
  const head = await withRetry(() => publicClient.getBlockNumber(), "getBlockNumber");
  let from = BigInt((await getMeta(META_BLOCK)) ?? "0") + 1n;
  if (from === 1n || head - from > 200_000n) from = head - BACKFILL_BLOCKS;

  // 1) new pools
  let chunks = 0;
  let poolLines = 0;
  let poolOverflow = 0;
  while (from <= head && chunks < CONFIG.scanMaxChunksPerCycle) {
    const to = from + BigInt(CONFIG.scanChunkBlocks) - 1n > head ? head : from + BigInt(CONFIG.scanChunkBlocks) - 1n;
    const logs = await withRetry(
      () =>
        publicClient.getLogs({
          address: CONFIG.uniV3Factory,
          event: poolCreatedEvent,
          fromBlock: from,
          toBlock: to,
        }),
      "getLogs.poolCreated",
    );
    for (const log of logs) {
      const { token0, token1, pool } = log.args;
      if (!token0 || !token1 || !pool) continue;
      // only care about meme/base pairs; skip base/base and stock pairs we already track
      const meme = isBase(token0) ? token1 : isBase(token1) ? token0 : null;
      if (!meme) continue;
      const known = await db.get("SELECT address FROM tokens WHERE address = ?", [meme.toLowerCase()]);
      if (known) continue;
      let symbol = "???";
      try {
        symbol = await withRetry(
          () =>
            publicClient.readContract({
              address: meme,
              abi: [{ type: "function", name: "symbol", inputs: [], outputs: [{ type: "string" }], stateMutability: "view" }],
              functionName: "symbol",
            }),
          "symbol",
          { retries: 0 },
        );
      } catch {
        // unnamed token
      }
      await db.run(
        `INSERT INTO tokens (address, symbol, kind, decimals, pool, updated_at) VALUES (?, ?, 'memecoin', 18, ?, ?)
         ON CONFLICT (address) DO NOTHING`,
        [meme.toLowerCase(), symbol, pool.toLowerCase(), Date.now()],
      );
      if (poolLines < 5) {
        say("signal", lines.newPool(symbol));
        poolLines++;
      } else {
        poolOverflow++;
      }
    }
    from = to + 1n;
    chunks++;
  }
  if (poolOverflow > 0) {
    say("signal", `kumo found ${poolOverflow} more new pools... busy day on the chain.`);
  }
  await setMeta(META_BLOCK, (from - 1n).toString());

  // 2) volume spikes on recently-seen memecoin pools
  const pools = await db.all<{ address: string; symbol: string; pool: string }>(
    "SELECT address, symbol, pool FROM tokens WHERE kind = 'memecoin' AND pool IS NOT NULL ORDER BY updated_at DESC LIMIT 15",
  );
  const windowBlocks = BigInt(Math.floor(CONFIG.memecoinScanMs / 100)); // ~1 block per 100ms
  const fromBlock = head > windowBlocks ? head - windowBlocks : 0n;
  for (const p of pools) {
    try {
      const swaps = await withRetry(
        () =>
          publicClient.getLogs({
            address: p.pool as Address,
            event: swapEvent,
            fromBlock,
            toBlock: head,
          }),
        "getLogs.swaps",
        { retries: 1 },
      );
      const count = swaps.length;
      const hist = swapHistory.get(p.pool) ?? [];
      const avg = hist.length ? hist.reduce((a, b) => a + b, 0) / hist.length : 0;
      hist.push(count);
      if (hist.length > 20) hist.shift();
      swapHistory.set(p.pool, hist);
      if (hist.length >= 5 && count > 20 && avg > 0 && count > avg * 3) {
        await emitSignal({
          kind: "watch",
          subjectType: "token",
          subject: p.address,
          symbol: p.symbol,
          kumoScore: 0.55,
          line: `kumo hears a lot of noise around ${p.symbol}. volume spiking...`,
        });
      }
    } catch {
      // pool may be gone or rpc hiccup; next cycle
    }
  }
}
