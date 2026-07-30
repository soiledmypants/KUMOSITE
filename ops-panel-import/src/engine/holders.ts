import Database from "better-sqlite3";
import { parseAbiItem } from "viem";
import { DEAD_ADDRESS, ZERO_ADDRESS } from "../config.js";
import { withRetry } from "../rpc.js";
import type { ProjectRuntime } from "../projects.js";
import * as journal from "./journal.js";
import { emitEvent } from "./events.js";

/**
 * ERC-20 holder indexer — memedex indexer.ts mechanics, per project:
 * Transfer-event scan in chunks with a per-chunk atomically-committed
 * watermark, balances persisted as TEXT, contract-vs-EOA bytecode cache.
 */

const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);

interface Store {
  db: Database.Database;
  balances: Map<string, bigint>;
  loaded: boolean;
  upsertBalance: Database.Statement;
  getMeta: Database.Statement;
  setMeta: Database.Statement;
  getCode: Database.Statement;
  setCode: Database.Statement;
}

const stores = new Map<string, Store>();

function store(p: ProjectRuntime): Store {
  // keyed by db path (not project id): a panel-side token switch changes the
  // path, so the old token's cached store is never reused for the new token.
  let s = stores.get(p.holdersDbPath);
  if (s) return s;

  const db = new Database(p.holdersDbPath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS balances (address TEXT PRIMARY KEY, balance TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS codecache (address TEXT PRIMARY KEY, is_contract INTEGER NOT NULL);
  `);

  s = {
    db,
    balances: new Map(),
    loaded: false,
    upsertBalance: db.prepare(
      "INSERT INTO balances (address, balance) VALUES (?, ?) ON CONFLICT(address) DO UPDATE SET balance = excluded.balance",
    ),
    getMeta: db.prepare("SELECT value FROM meta WHERE key = ?"),
    setMeta: db.prepare(
      "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ),
    getCode: db.prepare("SELECT is_contract FROM codecache WHERE address = ?"),
    setCode: db.prepare(
      "INSERT INTO codecache (address, is_contract) VALUES (?, ?) ON CONFLICT(address) DO UPDATE SET is_contract = excluded.is_contract",
    ),
  };
  stores.set(p.holdersDbPath, s);
  return s;
}

function ensureLoaded(s: Store): void {
  if (s.loaded) return;
  const rows = s.db.prepare("SELECT address, balance FROM balances").all() as Array<{
    address: string;
    balance: string;
  }>;
  for (const row of rows) s.balances.set(row.address, BigInt(row.balance));
  s.loaded = true;
}

export interface HolderBalance {
  address: `0x${string}`;
  balance: bigint;
}

/**
 * Scan the project token's Transfer events from the last scanned block to the
 * chain head, updating the persisted balance map. Watermark commits after
 * every chunk so a restart resumes cleanly.
 */
export async function sync(p: ProjectRuntime): Promise<{ head: bigint; scanned: bigint; transfers: number }> {
  const s = store(p);
  ensureLoaded(s);

  const metaVal = (s.getMeta.get("lastScannedBlock") as { value: string } | undefined)?.value ?? null;
  let nextFrom = metaVal !== null ? BigInt(metaVal) + 1n : p.holders.startBlock;

  const head = await withRetry(() => p.publicClient.getBlockNumber(), `holders:${p.id}.getBlockNumber`);
  let totalTransfers = 0;
  const firstFrom = nextFrom;

  if (nextFrom > head) {
    emitEvent("scan", { upToDate: true, head: head.toString() }, p.id);
    return { head, scanned: 0n, transfers: 0 };
  }

  console.log(`[scan:${p.id}] scanning blocks ${nextFrom}..${head}`);
  let chunk = p.holders.scanChunkBlocks; // shrinks adaptively on busy ranges, recovers after
  while (nextFrom <= head) {
    const toBlock = nextFrom + chunk - 1n < head ? nextFrom + chunk - 1n : head;

    let logs;
    try {
      logs = await withRetry(
        () =>
          p.publicClient.getLogs({
            address: p.tokenAddress,
            event: TRANSFER_EVENT,
            fromBlock: nextFrom,
            toBlock,
          }),
        `holders:${p.id}.getLogs[${nextFrom}-${toBlock}]`,
        { retries: 1 },
      );
    } catch (err) {
      // busy token: the range holds more logs than the rpc will return.
      // halve the window and retry — never bail on a dense stretch.
      if (chunk > 1n && /limit|too many|response size|exceed/i.test((err as Error).message)) {
        chunk = chunk / 2n > 0n ? chunk / 2n : 1n;
        console.log(`[scan:${p.id}] dense range ${nextFrom}-${toBlock}, halving chunk to ${chunk}`);
        continue;
      }
      throw err;
    }
    // quiet again -> grow back toward the configured chunk size
    if (chunk < p.holders.scanChunkBlocks && logs.length < 4000) {
      chunk = chunk * 2n < p.holders.scanChunkBlocks ? chunk * 2n : p.holders.scanChunkBlocks;
    }

    const touched = new Set<string>();
    for (const log of logs) {
      const from = log.args.from?.toLowerCase();
      const to = log.args.to?.toLowerCase();
      const value = log.args.value ?? 0n;
      if (from && from !== ZERO_ADDRESS) {
        s.balances.set(from, (s.balances.get(from) ?? 0n) - value);
        touched.add(from);
      }
      if (to && to !== ZERO_ADDRESS) {
        s.balances.set(to, (s.balances.get(to) ?? 0n) + value);
        touched.add(to);
      }
    }

    const commit = s.db.transaction(() => {
      for (const addrKey of touched) {
        s.upsertBalance.run(addrKey, (s.balances.get(addrKey) ?? 0n).toString());
      }
      s.setMeta.run("lastScannedBlock", toBlock.toString());
    });
    commit();

    totalTransfers += logs.length;
    if (logs.length > 0) {
      emitEvent(
        "scan",
        { from: nextFrom.toString(), to: toBlock.toString(), transfers: logs.length },
        p.id,
      );
    }
    nextFrom = toBlock + 1n;
  }

  console.log(`[scan:${p.id}] done — ${s.balances.size} tracked addresses, head ${head}`);
  journal.append({
    type: "snapshot",
    dryRun: false, // a scan is a read; record it as a real event
    projectId: p.id,
    token: p.tokenAddress,
    holderCount: s.balances.size,
    detail: `scanned ${firstFrom}-${head}, ${totalTransfers} transfers`,
  });
  return { head, scanned: head - firstFrom + 1n, transfers: totalTransfers };
}

/** Cached contract check: true if the address has bytecode (LP pair, locker, etc.). */
async function isContract(p: ProjectRuntime, s: Store, address: string): Promise<boolean> {
  const cached = s.getCode.get(address) as { is_contract: number } | undefined;
  if (cached) return cached.is_contract === 1;
  const code = await withRetry(
    () => p.publicClient.getCode({ address: address as `0x${string}` }),
    `holders:${p.id}.getCode[${address}]`,
  );
  const result = code !== undefined && code !== "0x";
  s.setCode.run(address, result ? 1 : 0);
  return result;
}

/**
 * Current holder set from the last sync: balance >= minBalance, contracts and
 * system wallets (zero/dead/bot/treasury/kumo/excludes) filtered out, sorted
 * by balance descending, optionally truncated to topN.
 */
export async function getHolders(
  p: ProjectRuntime,
  opts: { minBalance?: bigint; topN?: number } = {},
): Promise<HolderBalance[]> {
  const s = store(p);
  ensureLoaded(s);

  const minBalance = opts.minBalance ?? p.holders.minBalance;
  const excluded = new Set<string>([
    ZERO_ADDRESS,
    DEAD_ADDRESS,
    p.botAddress.toLowerCase(),
    p.treasuryWallet.toLowerCase(),
    ...(p.kumoWallet ? [p.kumoWallet.toLowerCase()] : []),
    ...p.holders.exclude,
  ]);

  const sorted = [...s.balances.entries()]
    .filter(([addrKey, bal]) => bal > 0n && bal >= minBalance && !excluded.has(addrKey))
    .sort((a, b) => (a[1] < b[1] ? 1 : a[1] > b[1] ? -1 : 0));

  const limit = opts.topN && opts.topN > 0 ? opts.topN : Infinity;
  const result: HolderBalance[] = [];
  for (const [addrKey, bal] of sorted) {
    if (result.length >= limit) break;
    try {
      if (await isContract(p, s, addrKey)) continue;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[scan:${p.id}] bytecode check failed for ${addrKey}, skipping: ${message}`);
      continue;
    }
    result.push({ address: addrKey as `0x${string}`, balance: bal });
  }
  return result;
}

/** Watermark + tracked-address count for the status endpoint. */
export function indexInfo(p: ProjectRuntime): { lastScannedBlock: string | null; tracked: number } {
  const s = store(p);
  ensureLoaded(s);
  const metaVal = (s.getMeta.get("lastScannedBlock") as { value: string } | undefined)?.value ?? null;
  return { lastScannedBlock: metaVal, tracked: s.balances.size };
}
