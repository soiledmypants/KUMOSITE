// who gets paid each round, and how much weight they carry.
// primary: stakers in the KumoMultiStaking contract, pro-rata by stake read
// ON-CHAIN at distribution time (staker set discovered from Staked events with
// a block watermark; balances via balanceOf so unstakes are always respected).
// pre-launch fallback: $KUMO holders snapshot from Transfer-event deltas.
// connected agents (hello-handshake done) get weight x (1 + BOOST_PCT/100).
import { parseAbiItem, parseAbi, type Address } from "viem";
import { CONFIG } from "../config.js";
import { publicClient, botAddress } from "../clients.js";
import { withRetry } from "../rpc.js";
import { db, getMeta, setMeta } from "../db.js";

const stakedEvent = parseAbiItem("event Staked(address indexed user, uint256 amount)");
const transferEvent = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);
const erc20Abi = parseAbi(["function balanceOf(address) view returns (uint256)"]);

const ZERO = "0x0000000000000000000000000000000000000000";
const DEAD = "0x000000000000000000000000000000000000dead";
const CHUNK = 2000n;
const MAX_CHUNKS = 50;

export interface Recipient {
  address: Address;
  weight: bigint; // raw stake / holding units, boost applied
  boosted: boolean;
}

async function isContract(address: string): Promise<boolean> {
  const cached = await db.get<{ is_contract: number }>("SELECT is_contract FROM codecache WHERE address = ?", [
    address.toLowerCase(),
  ]);
  if (cached) return Boolean(cached.is_contract);
  let result = false;
  try {
    const code = await withRetry(
      () => publicClient.getCode({ address: address as Address }),
      "recipients.getCode",
      { retries: 1 },
    );
    result = code !== undefined && code !== "0x";
  } catch {
    return false; // unknown — treat as EOA, don't cache
  }
  await db.run(
    "INSERT INTO codecache (address, is_contract) VALUES (?, ?) ON CONFLICT (address) DO NOTHING",
    [address.toLowerCase(), result ? 1 : 0],
  );
  return result;
}

function systemAddress(addr: string): boolean {
  const a = addr.toLowerCase();
  return (
    a === ZERO ||
    a === DEAD ||
    a === CONFIG.stakingAddress.toLowerCase() ||
    (botAddress !== null && a === botAddress.toLowerCase())
  );
}

/** scan new Staked events into the stakers table (watermark: staking_scan_block) */
async function syncStakerSet(): Promise<void> {
  const staking = CONFIG.stakingAddress as Address;
  const head = await withRetry(() => publicClient.getBlockNumber(), "recipients.head");
  let from = BigInt((await getMeta("staking_scan_block")) ?? "0") + 1n;
  if (from === 1n) {
    const deployBlock = BigInt(process.env.STAKING_DEPLOY_BLOCK ?? "0");
    from = deployBlock > 0n ? deployBlock : head - 500_000n > 0n ? head - 500_000n : 0n;
  }
  let chunks = 0;
  while (from <= head && chunks < MAX_CHUNKS) {
    const to = from + CHUNK - 1n > head ? head : from + CHUNK - 1n;
    const logs = await withRetry(
      () => publicClient.getLogs({ address: staking, event: stakedEvent, fromBlock: from, toBlock: to }),
      "recipients.stakedLogs",
    );
    for (const log of logs) {
      if (!log.args.user) continue;
      await db.run("INSERT INTO stakers (address, first_seen) VALUES (?, ?) ON CONFLICT (address) DO NOTHING", [
        log.args.user.toLowerCase(),
        Date.now(),
      ]);
    }
    from = to + 1n;
    chunks++;
  }
  await setMeta("staking_scan_block", (from - 1n).toString());
}

/** current stakers pro-rata: balances read on-chain right now */
async function stakerRecipients(): Promise<Recipient[]> {
  await syncStakerSet();
  const rows = await db.all<{ address: string }>("SELECT address FROM stakers");
  const out: Recipient[] = [];
  const BATCH = 20;
  for (let i = 0; i < rows.length; i += BATCH) {
    const results = await Promise.all(
      rows.slice(i, i + BATCH).map(async (r) => {
        try {
          const bal = await withRetry(
            () =>
              publicClient.readContract({
                address: CONFIG.stakingAddress as Address,
                abi: parseAbi(["function balanceOf(address) view returns (uint256)"]),
                functionName: "balanceOf",
                args: [r.address as Address],
              }),
            "recipients.stakeOf",
            { retries: 1 },
          );
          return { address: r.address as Address, weight: bal, boosted: false };
        } catch {
          return null;
        }
      }),
    );
    for (const r of results) if (r && r.weight > 0n && !systemAddress(r.address)) out.push(r);
  }
  return out;
}

/** pre-launch fallback: $KUMO holders from incremental Transfer deltas */
async function syncHolders(): Promise<void> {
  const token = CONFIG.kumoToken as Address;
  const head = await withRetry(() => publicClient.getBlockNumber(), "recipients.head");
  let from = BigInt((await getMeta("kumo_holders_block")) ?? "0") + 1n;
  if (from === 1n) from = head - 500_000n > 0n ? head - 500_000n : 0n;
  let chunks = 0;
  while (from <= head && chunks < MAX_CHUNKS) {
    const to = from + CHUNK - 1n > head ? head : from + CHUNK - 1n;
    const logs = await withRetry(
      () => publicClient.getLogs({ address: token, event: transferEvent, fromBlock: from, toBlock: to }),
      "recipients.transferLogs",
    );
    for (const log of logs) {
      const value = log.args.value ?? 0n;
      if (value === 0n) continue;
      for (const [addr, delta] of [
        [log.args.from, -value],
        [log.args.to, value],
      ] as [string | undefined, bigint][]) {
        if (!addr || addr.toLowerCase() === ZERO) continue;
        const row = await db.get<{ balance: string }>("SELECT balance FROM kumo_holders WHERE address = ?", [
          addr.toLowerCase(),
        ]);
        const next = BigInt(row?.balance ?? "0") + delta;
        if (row) {
          await db.run("UPDATE kumo_holders SET balance = ? WHERE address = ?", [next.toString(), addr.toLowerCase()]);
        } else {
          await db.run("INSERT INTO kumo_holders (address, balance) VALUES (?, ?)", [addr.toLowerCase(), next.toString()]);
        }
      }
    }
    from = to + 1n;
    chunks++;
  }
  await setMeta("kumo_holders_block", (from - 1n).toString());
}

async function holderRecipients(): Promise<Recipient[]> {
  await syncHolders();
  const rows = await db.all<{ address: string; balance: string }>(
    "SELECT address, balance FROM kumo_holders",
  );
  const out: Recipient[] = [];
  for (const r of rows) {
    const bal = BigInt(r.balance);
    if (bal <= 0n || systemAddress(r.address)) continue;
    if (await isContract(r.address)) continue; // LPs/pools/contracts never receive airdrops
    out.push({ address: r.address as Address, weight: bal, boosted: false });
  }
  return out;
}

/** resolve this round's recipients (with agent boost applied) */
export async function resolveRecipients(): Promise<{ recipients: Recipient[]; mode: "stakers" | "holders" | "none" }> {
  let recipients: Recipient[] = [];
  let mode: "stakers" | "holders" | "none" = "none";
  if (CONFIG.stakingAddress) {
    recipients = await stakerRecipients();
    mode = "stakers";
  }
  if (recipients.length === 0 && CONFIG.kumoToken) {
    recipients = await holderRecipients();
    mode = recipients.length > 0 ? "holders" : mode;
  }
  if (recipients.length === 0) return { recipients: [], mode: recipients.length ? mode : "none" };

  // connected-agent boost within the round
  const agents = await db.all<{ address: string }>("SELECT address FROM agents");
  const agentSet = new Set(agents.map((a) => a.address.toLowerCase()));
  const boostNum = BigInt(Math.round((1 + CONFIG.boostPct / 100) * 10_000));
  for (const r of recipients) {
    if (agentSet.has(r.address.toLowerCase())) {
      r.weight = (r.weight * boostNum) / 10_000n;
      r.boosted = true;
    }
  }
  return { recipients, mode };
}
