// watched-wallet indexer: chunked Transfer-log scans with a per-wallet block watermark
// (memedex indexer pattern), balance snapshots, and a simple native-ETH pnl estimate.
import { formatEther, formatUnits, parseAbi, parseAbiItem, type Address } from "viem";
import { CONFIG } from "../config.js";
import { publicClient } from "../clients.js";
import { withRetry } from "../rpc.js";
import { db, getMeta, setMeta } from "../db.js";
import { lines, say } from "../voice.js";
import { noteWalletActivity } from "./signals.js";

const transferEvent = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);
const erc20Abi = parseAbi([
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
]);

export interface WalletRow {
  address: string;
  label: string;
  added_at: number;
  last_scanned_block: number;
  eth_balance: string;
  pnl_eth: number;
}

const BACKFILL_BLOCKS = 20_000n; // ~33 min of 100ms blocks
const MAX_LAG_BLOCKS = 200_000n;
const MAX_FEED_LINES_PER_CYCLE = 5;

export async function addWallet(address: Address, label?: string): Promise<WalletRow> {
  const name = label?.trim() || `${address.slice(0, 6)}…${address.slice(-4)}`;
  const head = await withRetry(() => publicClient.getBlockNumber(), "getBlockNumber");
  const start = head > BACKFILL_BLOCKS ? head - BACKFILL_BLOCKS : 0n;
  const bal = await withRetry(() => publicClient.getBalance({ address }), "getBalance");
  await db.run(
    "INSERT INTO wallets (address, label, added_at, last_scanned_block, eth_balance) VALUES (?, ?, ?, ?, ?)",
    [address.toLowerCase(), name, Date.now(), start.toString(), bal.toString()],
  );
  await setMeta(`wallet_init:${address.toLowerCase()}`, bal.toString());
  say("watch", lines.newWallet(name));
  return {
    address: address.toLowerCase(),
    label: name,
    added_at: Date.now(),
    last_scanned_block: Number(start),
    eth_balance: bal.toString(),
    pnl_eth: 0,
  };
}

export async function removeWallet(address: string): Promise<boolean> {
  const row = await db.get<WalletRow>("SELECT * FROM wallets WHERE address = ?", [
    address.toLowerCase(),
  ]);
  if (!row) return false;
  await db.run("DELETE FROM wallets WHERE address = ?", [address.toLowerCase()]);
  say("watch", lines.droppedWallet(row.label));
  return true;
}

export async function listWallets(): Promise<WalletRow[]> {
  return db.all<WalletRow>("SELECT * FROM wallets ORDER BY added_at ASC");
}

export async function walletCount(): Promise<number> {
  const row = await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM wallets");
  return Number(row?.n ?? 0);
}

async function tokenInfo(address: string): Promise<{ symbol: string; decimals: number }> {
  const cached = await db.get<{ symbol: string; decimals: number }>(
    "SELECT symbol, decimals FROM tokens WHERE address = ?",
    [address.toLowerCase()],
  );
  if (cached) return { symbol: cached.symbol, decimals: Number(cached.decimals) };
  let symbol = "???";
  let decimals = 18;
  try {
    symbol = await withRetry(
      () => publicClient.readContract({ address: address as Address, abi: erc20Abi, functionName: "symbol" }),
      "erc20.symbol",
      { retries: 1 },
    );
    decimals = await withRetry(
      () => publicClient.readContract({ address: address as Address, abi: erc20Abi, functionName: "decimals" }),
      "erc20.decimals",
      { retries: 1 },
    );
  } catch {
    // unreadable token: keep placeholders
  }
  await db.run(
    "INSERT INTO tokens (address, symbol, kind, decimals, updated_at) VALUES (?, ?, 'seen', ?, ?) ON CONFLICT (address) DO NOTHING",
    [address.toLowerCase(), symbol, decimals, Date.now()],
  );
  return { symbol, decimals };
}

export async function scanWalletsOnce(): Promise<void> {
  const wallets = await listWallets();
  if (wallets.length === 0) return;
  const head = await withRetry(() => publicClient.getBlockNumber(), "getBlockNumber");
  let feedLines = 0;

  for (const w of wallets) {
    const address = w.address as Address;
    let from = BigInt(w.last_scanned_block) + 1n;
    if (head - from > MAX_LAG_BLOCKS) {
      from = head - BACKFILL_BLOCKS;
      say("watch", `kumo fell behind on ${w.label} and skipped ahead.`);
    }
    let chunks = 0;
    while (from <= head && chunks < CONFIG.scanMaxChunksPerCycle) {
      const to = from + BigInt(CONFIG.scanChunkBlocks) - 1n > head ? head : from + BigInt(CONFIG.scanChunkBlocks) - 1n;
      const [outLogs, inLogs] = await Promise.all([
        withRetry(
          () => publicClient.getLogs({ event: transferEvent, args: { from: address }, fromBlock: from, toBlock: to }),
          "getLogs.out",
        ),
        withRetry(
          () => publicClient.getLogs({ event: transferEvent, args: { to: address }, fromBlock: from, toBlock: to }),
          "getLogs.in",
        ),
      ]);
      for (const log of [...outLogs, ...inLogs]) {
        const kind = log.args.from?.toLowerCase() === w.address ? "out" : "in";
        const token = log.address.toLowerCase();
        const amount = (log.args.value ?? 0n).toString();
        await db.run(
          "INSERT INTO wallet_events (address, block, tx_hash, kind, token, token_symbol, amount, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          [w.address, log.blockNumber.toString(), log.transactionHash, kind, token, null, amount, Date.now()],
        );
        if (feedLines < MAX_FEED_LINES_PER_CYCLE) {
          const info = await tokenInfo(token);
          const pretty = Number(formatUnits(log.args.value ?? 0n, info.decimals)).toLocaleString("en-US", {
            maximumFractionDigits: 4,
          });
          say("move", lines.bigMove(w.label, `${kind === "out" ? "sent" : "received"} ${pretty} ${info.symbol}`));
          feedLines++;
        }
        noteWalletActivity(w.address, kind);
      }
      from = to + 1n;
      chunks++;
    }

    const bal = await withRetry(() => publicClient.getBalance({ address }), "getBalance");
    const init = BigInt((await getMeta(`wallet_init:${w.address}`)) ?? bal.toString());
    const pnl = Number(formatEther(bal - init));
    await db.run(
      "UPDATE wallets SET last_scanned_block = ?, eth_balance = ?, pnl_eth = ? WHERE address = ?",
      [(from - 1n).toString(), bal.toString(), pnl, w.address],
    );
  }
}

export interface WalletView extends WalletRow {
  eth_balance_eth: number;
  tokens: { address: string; symbol: string; amount: number }[];
  last_moves: { ts: number; kind: string; token: string | null; symbol: string; amount: string; tx: string }[];
}

export async function walletViews(): Promise<WalletView[]> {
  const rows = await listWallets();
  const out: WalletView[] = [];
  for (const w of rows) {
    const moves = await db.all<{
      ts: number; kind: string; token: string | null; amount: string; tx_hash: string;
    }>(
      "SELECT ts, kind, token, amount, tx_hash FROM wallet_events WHERE address = ? ORDER BY id DESC LIMIT 10",
      [w.address],
    );
    const seen = [...new Set(moves.map((m) => m.token).filter(Boolean))] as string[];
    const tokens: WalletView["tokens"] = [];
    for (const t of seen.slice(0, 10)) {
      const info = await tokenInfo(t);
      try {
        const bal = await withRetry(
          () =>
            publicClient.readContract({
              address: t as Address,
              abi: erc20Abi,
              functionName: "balanceOf",
              args: [w.address as Address],
            }),
          "erc20.balanceOf",
          { retries: 1 },
        );
        tokens.push({ address: t, symbol: info.symbol, amount: Number(formatUnits(bal, info.decimals)) });
      } catch {
        // skip unreadable balances
      }
    }
    const last_moves = [];
    for (const m of moves) {
      const info = m.token ? await tokenInfo(m.token) : { symbol: "ETH", decimals: 18 };
      last_moves.push({
        ts: Number(m.ts),
        kind: m.kind,
        token: m.token,
        symbol: info.symbol,
        amount: formatUnits(BigInt(m.amount), info.decimals),
        tx: m.tx_hash,
      });
    }
    out.push({
      ...w,
      pnl_eth: Number(w.pnl_eth),
      eth_balance_eth: Number(formatEther(BigInt(w.eth_balance))),
      tokens,
      last_moves,
    });
  }
  return out;
}
