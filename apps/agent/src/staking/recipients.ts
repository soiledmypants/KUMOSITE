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
  weight: bigint; // raw stake / holding units (stakers) or scaled rep (agents), boost applied
  boosted: boolean;
  /** set on agent-pool recipients: the agent identity address (payouts may go elsewhere) */
  agent?: string;
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

/** system addresses never receive airdrops: zero/dead, the staking contract,
 * and the hot wallet itself. `bot` is injectable for tests. */
export function systemAddress(addr: string, bot: string | null = botAddress): boolean {
  const a = addr.toLowerCase();
  return (
    a === ZERO ||
    a === DEAD ||
    a === CONFIG.stakingAddress.toLowerCase() ||
    (bot !== null && a === bot.toLowerCase())
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

// ---- agent eligibility (2a anti-sybil) --------------------------------------
// a bare handshake is never worth money on its own. every check is reported
// individually so the dashboard can show exactly WHY an agent is ineligible.

export interface EligibilityCheck {
  id: "handshake" | "liveness" | "reputation" | "stake" | "address";
  ok: boolean;
  note: string;
}

export interface AgentEligibility {
  eligible: boolean;
  checks: EligibilityCheck[];
  payoutAddress: string;
  weight: bigint; // scaled rep (rep × 1e6); 0 when ineligible
}

interface AgentDbRow {
  address: string;
  name: string;
  token_hash: string | null;
  last_seen: number;
  rep: number;
  n_scored: number;
  tier: string;
  payout_address: string | null;
  eligible_since: number | null;
}

const stakingBalanceAbi = parseAbi(["function balanceOf(address) view returns (uint256)"]);

export async function agentEligibility(a: AgentDbRow): Promise<AgentEligibility> {
  const checks: EligibilityCheck[] = [];
  const payoutAddress = (a.payout_address && /^0x[0-9a-fA-F]{40}$/.test(a.payout_address) ? a.payout_address : a.address).toLowerCase();

  checks.push({
    id: "handshake",
    ok: a.token_hash !== null,
    note: a.token_hash !== null ? "wallet-signature handshake complete" : "no handshake — say hello and sign the nonce",
  });

  const livenessMs = CONFIG.agentLivenessHours * 3600_000;
  const alive = Date.now() - Number(a.last_seen) <= livenessMs;
  checks.push({
    id: "liveness",
    ok: alive,
    note: alive
      ? `seen within the last ${CONFIG.agentLivenessHours}h`
      : `dead air — last seen over ${CONFIG.agentLivenessHours}h ago. dead agents stop earning.`,
  });

  const trustedTier = a.tier === "trusted" || a.tier === "inner-circle";
  const repOk = trustedTier && Number(a.rep) >= CONFIG.agentMinRep;
  checks.push({
    id: "reputation",
    ok: repOk,
    note: repOk
      ? `tier ${a.tier}, rep ${Number(a.rep).toFixed(2)}`
      : `needs the trusted tier (>=10 scored intel calls, rep >= ${CONFIG.agentMinRep}) — currently ${a.tier}, rep ${Number(a.rep).toFixed(2)}, ${Number(a.n_scored)} scored`,
  });

  let stakeOk = true;
  let stakeNote = "stake requirement off";
  if (CONFIG.agentRequireStake) {
    stakeOk = false;
    stakeNote = "no staking contract or $KUMO configured yet — stake check cannot pass";
    if (CONFIG.stakingAddress) {
      try {
        const staked = await withRetry(
          () =>
            publicClient.readContract({
              address: CONFIG.stakingAddress as Address,
              abi: stakingBalanceAbi,
              functionName: "balanceOf",
              args: [payoutAddress as Address],
            }),
          "agents.stakeOf",
          { retries: 1 },
        );
        if (staked > 0n) {
          stakeOk = true;
          stakeNote = "payout address holds stake";
        } else {
          stakeNote = "payout address holds no stake in KumoMultiStaking";
        }
      } catch {
        stakeNote = "stake read failed — treated as unstaked this round";
      }
    }
    if (!stakeOk && CONFIG.kumoToken) {
      try {
        const bal = await withRetry(
          () =>
            publicClient.readContract({
              address: CONFIG.kumoToken as Address,
              abi: erc20Abi,
              functionName: "balanceOf",
              args: [payoutAddress as Address],
            }),
          "agents.kumoBal",
          { retries: 1 },
        );
        const minRaw = BigInt(Math.round(CONFIG.agentMinHold * 1e6)) * 10n ** 12n; // whole units -> raw (18 dec)
        if (bal > minRaw) {
          stakeOk = true;
          stakeNote = `payout address holds > ${CONFIG.agentMinHold} $KUMO`;
        } else if (!CONFIG.stakingAddress) {
          stakeNote = `payout address holds <= ${CONFIG.agentMinHold} $KUMO`;
        }
      } catch {
        // keep the staking note
      }
    }
  }
  checks.push({ id: "stake", ok: stakeOk, note: stakeNote });

  const sys = systemAddress(payoutAddress);
  const contract = sys ? false : await isContract(payoutAddress);
  checks.push({
    id: "address",
    ok: !sys && !contract,
    note: sys ? "payout address is a system address" : contract ? "payout address is a contract" : "payout address is a clean eoa",
  });

  const eligible = checks.every((c) => c.ok);
  return {
    eligible,
    checks,
    payoutAddress,
    weight: eligible ? BigInt(Math.max(1, Math.round(Number(a.rep) * 1_000_000))) : 0n,
  };
}

/** eligible connected agents as pool recipients, rep-weighted. maintains eligible_since. */
export async function agentRecipients(): Promise<Recipient[]> {
  const rows = await db.all<AgentDbRow>("SELECT * FROM agents");
  const out: Recipient[] = [];
  const now = Date.now();
  for (const a of rows) {
    const e = await agentEligibility(a);
    if (e.eligible) {
      if (!a.eligible_since) {
        await db.run("UPDATE agents SET eligible_since = ? WHERE address = ?", [now, a.address]);
      }
      out.push({ address: e.payoutAddress as Address, weight: e.weight, boosted: false, agent: a.address });
    } else if (a.eligible_since) {
      await db.run("UPDATE agents SET eligible_since = NULL WHERE address = ?", [a.address]);
    }
  }
  return out;
}

export interface ResolvedRecipients {
  stakers: Recipient[];
  agents: Recipient[];
  mode: "stakers" | "holders" | "none";
}

/** resolve this round's recipients: staker pool (with boost) + eligible-agent pool */
export async function resolveRecipients(): Promise<ResolvedRecipients> {
  let stakers: Recipient[] = [];
  let mode: "stakers" | "holders" | "none" = "none";
  if (CONFIG.stakingAddress) {
    stakers = await stakerRecipients();
    mode = "stakers";
  }
  if (stakers.length === 0 && CONFIG.kumoToken) {
    stakers = await holderRecipients();
    mode = stakers.length > 0 ? "holders" : mode;
  }

  // the agent pool only exists in pool/both mode
  const poolMode = CONFIG.agentRewardMode === "pool" || CONFIG.agentRewardMode === "both";
  const agents = poolMode ? await agentRecipients() : [];

  // connected-agent boost within the staker pool. 2a change (approved): boost
  // now only matches ELIGIBLE agents — a bare or dead handshake boosts nothing.
  const boostMode = CONFIG.agentRewardMode === "" || CONFIG.agentRewardMode === "boost" || CONFIG.agentRewardMode === "both";
  if (boostMode && CONFIG.boostEnabled && CONFIG.boostPct > 0 && stakers.length > 0) {
    const eligibleAgents = poolMode ? agents : await agentRecipients();
    const matchSet = new Set<string>();
    for (const a of eligibleAgents) {
      matchSet.add(a.address.toLowerCase());
      if (a.agent) matchSet.add(a.agent.toLowerCase());
    }
    const boostNum = BigInt(Math.round((1 + CONFIG.boostPct / 100) * 10_000));
    for (const r of stakers) {
      if (matchSet.has(r.address.toLowerCase())) {
        r.weight = (r.weight * boostNum) / 10_000n;
        r.boosted = true;
      }
    }
  }
  return { stakers, agents, mode };
}
