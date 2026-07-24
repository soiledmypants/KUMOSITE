// postgres-or-sqlite adapter (relay pattern): DATABASE_URL set -> pg, else better-sqlite3 file.
import fs from "node:fs";
import path from "node:path";
import { CONFIG } from "./config.js";

export interface Db {
  kind: "sqlite" | "postgres";
  run(sql: string, params?: unknown[]): Promise<void>;
  get<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined>;
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}

export let db: Db;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS wallets (
    address TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    added_at BIGINT NOT NULL,
    last_scanned_block BIGINT NOT NULL DEFAULT 0,
    eth_balance TEXT NOT NULL DEFAULT '0',
    pnl_eth DOUBLE PRECISION NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS wallet_events (
    id %AUTOPK%,
    address TEXT NOT NULL,
    block BIGINT NOT NULL,
    tx_hash TEXT NOT NULL,
    kind TEXT NOT NULL,
    token TEXT,
    token_symbol TEXT,
    amount TEXT NOT NULL,
    ts BIGINT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_wallet_events_addr ON wallet_events(address, ts)`,
  `CREATE TABLE IF NOT EXISTS tokens (
    address TEXT PRIMARY KEY,
    symbol TEXT NOT NULL,
    kind TEXT NOT NULL,
    decimals INTEGER NOT NULL DEFAULT 18,
    pool TEXT,
    chainlink_feed TEXT,
    last_price DOUBLE PRECISION,
    ui_multiplier DOUBLE PRECISION NOT NULL DEFAULT 1,
    updated_at BIGINT NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS agents (
    address TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    endpoint TEXT,
    card_url TEXT,
    token_hash TEXT,
    webhook_url TEXT,
    first_seen BIGINT NOT NULL,
    last_seen BIGINT NOT NULL,
    rep DOUBLE PRECISION NOT NULL DEFAULT 0.35,
    n_scored INTEGER NOT NULL DEFAULT 0,
    n_hit DOUBLE PRECISION NOT NULL DEFAULT 0,
    tier TEXT NOT NULL DEFAULT 'hatchling'
  )`,
  `CREATE TABLE IF NOT EXISTS intel (
    id %AUTOPK%,
    agent_address TEXT NOT NULL,
    kind TEXT NOT NULL,
    subject_type TEXT NOT NULL,
    subject TEXT NOT NULL,
    symbol TEXT,
    direction TEXT NOT NULL,
    confidence DOUBLE PRECISION NOT NULL,
    note TEXT,
    ttl_s INTEGER NOT NULL,
    entry_price DOUBLE PRECISION,
    created_at BIGINT NOT NULL,
    scored_at BIGINT,
    score DOUBLE PRECISION
  )`,
  `CREATE INDEX IF NOT EXISTS idx_intel_unscored ON intel(scored_at, created_at)`,
  `CREATE TABLE IF NOT EXISTS signals (
    id TEXT PRIMARY KEY,
    ts BIGINT NOT NULL,
    kind TEXT NOT NULL,
    subject_type TEXT NOT NULL,
    subject TEXT NOT NULL,
    symbol TEXT,
    strength DOUBLE PRECISION NOT NULL,
    kumo_score DOUBLE PRECISION NOT NULL DEFAULT 0,
    contributors INTEGER NOT NULL DEFAULT 0,
    line TEXT NOT NULL,
    public_at BIGINT NOT NULL,
    expires_at BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS feed_log (
    id %AUTOPK%,
    ts BIGINT NOT NULL,
    kind TEXT NOT NULL,
    line TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS meta (
    k TEXT PRIMARY KEY,
    v TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS keeper_journal (
    id %AUTOPK%,
    ts BIGINT NOT NULL,
    eth_spent TEXT NOT NULL,
    token TEXT NOT NULL,
    amount TEXT NOT NULL,
    tx_hashes TEXT NOT NULL,
    note TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS trades (
    id %AUTOPK%,
    ts BIGINT NOT NULL,
    token_in TEXT NOT NULL,
    token_out TEXT NOT NULL,
    amount_in TEXT NOT NULL,
    amount_out TEXT NOT NULL,
    tx_hash TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS price_history (
    id %AUTOPK%,
    token TEXT NOT NULL,
    ts BIGINT NOT NULL,
    price DOUBLE PRECISION NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_price_history ON price_history(token, ts)`,
  `CREATE TABLE IF NOT EXISTS tweets (
    id %AUTOPK%,
    ts BIGINT NOT NULL,
    kind TEXT NOT NULL,
    text TEXT NOT NULL,
    text_hash TEXT NOT NULL,
    in_reply_to TEXT,
    tweet_id TEXT,
    status TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_tweets_hash ON tweets(text_hash, ts)`,
  `CREATE TABLE IF NOT EXISTS mentions (
    id %AUTOPK%,
    mention_id TEXT NOT NULL UNIQUE,
    author TEXT NOT NULL,
    status TEXT NOT NULL,
    note TEXT,
    handled_at BIGINT NOT NULL
  )`,
];

// additive column migrations (ALTER fails harmlessly when the column exists)
const TOKEN_COLUMNS = [
  "ALTER TABLE tokens ADD COLUMN name TEXT",
  "ALTER TABLE tokens ADD COLUMN pool_base TEXT",
  "ALTER TABLE tokens ADD COLUMN liquidity_usd DOUBLE PRECISION",
  "ALTER TABLE tokens ADD COLUMN ta_score DOUBLE PRECISION",
  "ALTER TABLE tokens ADD COLUMN ta_json TEXT",
];

function toPgPlaceholders(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

async function initPostgres(url: string): Promise<Db> {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: url, max: 5 });
  const d: Db = {
    kind: "postgres",
    async run(sql, params = []) {
      await pool.query(toPgPlaceholders(sql), params as unknown[]);
    },
    async get(sql, params = []) {
      const r = await pool.query(toPgPlaceholders(sql), params as unknown[]);
      return r.rows[0];
    },
    async all(sql, params = []) {
      const r = await pool.query(toPgPlaceholders(sql), params as unknown[]);
      return r.rows;
    },
  };
  for (const stmt of SCHEMA) {
    await d.run(stmt.replace("%AUTOPK%", "BIGSERIAL PRIMARY KEY"));
  }
  for (const stmt of TOKEN_COLUMNS) {
    try {
      await d.run(stmt);
    } catch {
      // column already exists
    }
  }
  return d;
}

async function initSqlite(): Promise<Db> {
  const { default: Database } = await import("better-sqlite3");
  fs.mkdirSync(CONFIG.dataDir, { recursive: true });
  const file = path.join(CONFIG.dataDir, "kumo.db");
  const sq = new Database(file);
  sq.pragma("journal_mode = WAL");
  const d: Db = {
    kind: "sqlite",
    async run(sql, params = []) {
      sq.prepare(sql).run(...(params as never[]));
    },
    async get(sql, params = []) {
      return sq.prepare(sql).get(...(params as never[])) as never;
    },
    async all(sql, params = []) {
      return sq.prepare(sql).all(...(params as never[])) as never;
    },
  };
  for (const stmt of SCHEMA) {
    await d.run(
      stmt
        .replace("%AUTOPK%", "INTEGER PRIMARY KEY AUTOINCREMENT")
        .replace(/DOUBLE PRECISION/g, "REAL")
        .replace(/BIGSERIAL/g, "INTEGER"),
    );
  }
  for (const stmt of TOKEN_COLUMNS) {
    try {
      await d.run(stmt.replace(/DOUBLE PRECISION/g, "REAL"));
    } catch {
      // column already exists
    }
  }
  return d;
}

export async function initDb(): Promise<Db> {
  db = CONFIG.databaseUrl ? await initPostgres(CONFIG.databaseUrl) : await initSqlite();
  return db;
}

export async function getMeta(key: string): Promise<string | undefined> {
  const row = await db.get<{ v: string }>("SELECT v FROM meta WHERE k = ?", [key]);
  return row?.v;
}

export async function setMeta(key: string, value: string): Promise<void> {
  if (db.kind === "postgres") {
    await db.run(
      "INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v",
      [key, value],
    );
  } else {
    await db.run("INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)", [key, value]);
  }
}
