// autodrop: the simplified pipeline — no fee claiming, no locker.
// each job: wallet key (vault) + ETH arrives in the wallet however you like ->
// every interval: swap the ETH on uniswap v3 for the airdrop token -> send it
// pro-rata to holders of the hold token (min-holding gated, contracts/LPs
// excluded). master DRY_RUN governs scheduled cycles exactly like claims.
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { formatEther, formatUnits, parseEther, parseUnits, parseAbi } from "viem";
import { CONFIG, addr, dataPath } from "../config.js";
import { buildRuntime, RHC_DEFAULTS, type ProjectRuntime, type RawProject } from "../projects.js";
import { withRetry } from "../rpc.js";
import { quoteBuy, buyToken } from "./swap.js";
import { sync, getHolders } from "./holders.js";
import { runAirdrop, type AirdropItem } from "./airdrop.js";
import * as journal from "./journal.js";
import { emitEvent } from "./events.js";

const ERC20_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);
const DEAD = "0x000000000000000000000000000000000000dEaD";

export interface AutodropJob {
  id: string;
  keyRef: string;
  /** token bought on uniswap and sent out */
  airdropToken: string;
  /** token the recipients must hold */
  holdToken: string;
  /** minimum holding, WHOLE units of holdToken */
  minHolding: string;
  holdersStartBlock: string;
  intervalMinutes: number;
  /** below this the job journals "saving up" and waits (ETH) */
  minEthPerRound: string;
  gasReserveEth: string;
  /** WETH/airdropToken uniswap v3 pool fee tier */
  feeTier: number;
  maxRecipients: number;
  enabled: boolean;
}

interface JobState {
  job: AutodropJob;
  base: ProjectRuntime; // tokenAddress = airdropToken (swap + transfers)
  holdView: ProjectRuntime; // tokenAddress = holdToken (holder index)
  busy: boolean;
  timer?: NodeJS.Timeout;
  nextRunAt: number | null;
  lastResult: string;
}

const states = new Map<string, JobState>();

function filePath(): string {
  return dataPath("autodrop-jobs.json");
}

function loadJobsFile(): AutodropJob[] {
  if (!existsSync(filePath())) return [];
  try {
    return JSON.parse(readFileSync(filePath(), "utf8")) as AutodropJob[];
  } catch {
    console.error(`[autodrop] ${filePath()} is corrupt — ignoring it`);
    return [];
  }
}

function persist(): void {
  const all = [...states.values()].map((s) => s.job);
  const tmp = filePath() + ".tmp";
  writeFileSync(tmp, JSON.stringify(all, null, 2));
  renameSync(tmp, filePath());
}

/** build the two runtime views for a job. throws on bad addresses / unresolvable key. */
function buildViews(job: AutodropJob): { base: ProjectRuntime; holdView: ProjectRuntime } {
  const airdropToken = addr(job.airdropToken);
  const holdToken = addr(job.holdToken);
  const raw: RawProject = {
    id: `drop-${job.id}`,
    name: `autodrop ${job.id}`,
    chainId: RHC_DEFAULTS.chainId,
    rpcUrl: RHC_DEFAULTS.rpcUrl,
    explorerBase: RHC_DEFAULTS.explorerBase,
    tokenAddress: airdropToken,
    weth: RHC_DEFAULTS.weth,
    locker: null, // no fee claiming — that's the whole point
    treasuryWallet: DEAD, // unused; placeholder so validation passes
    treasuryPct: 100,
    keyRef: job.keyRef,
    claim: { enabled: false },
    caps: { gasReserveEth: job.gasReserveEth },
    swap: { feeTier: job.feeTier, slippagePct: 3 },
    holders: { startBlock: "0", scanChunkBlocks: "10000" },
  };
  const base = buildRuntime(raw);
  const holdView: ProjectRuntime = {
    ...base,
    tokenAddress: holdToken,
    holdersDbPath: dataPath(`holders-drop-${job.id}-${holdToken.toLowerCase().slice(2, 10)}.db`),
    holders: {
      startBlock: BigInt(/^\d+$/.test(job.holdersStartBlock) ? job.holdersStartBlock : "0"),
      scanChunkBlocks: 10000n,
      minBalance: 0n,
      exclude: [],
    },
  };
  return { base, holdView };
}

export interface AutodropRunResult {
  jobId: string;
  dryRun: boolean;
  phase: "saving_up" | "no_holders" | "ready" | "done" | "error";
  detail: string;
  ethIn?: string;
  quotedOut?: string;
  airdropSymbol?: string;
  recipients?: number;
  sent?: number;
  failed?: number;
  totalSent?: string;
  top?: { address: string; amount: string }[];
}

/** one cycle: sweep check -> quote -> (dry: plan | live: swap + distribute). */
export async function runJobOnce(id: string, opts: { dryRun: boolean }): Promise<AutodropRunResult> {
  const s = states.get(id);
  if (!s) throw new Error(`unknown autodrop job "${id}"`);
  if (s.busy) throw new Error(`job "${id}" is already running`);
  s.busy = true;
  const dryRun = CONFIG.dryRun || opts.dryRun; // master switch always wins
  try {
    const { base, holdView, job } = s;
    const wallet = base.botAddress;

    const balance = await withRetry(() => base.publicClient.getBalance({ address: wallet }), `autodrop:${id}.balance`);
    const reserve = parseEther(job.gasReserveEth);
    const minRound = parseEther(job.minEthPerRound);
    const ethIn = balance > reserve ? balance - reserve : 0n;
    if (ethIn < minRound) {
      const detail = `saving up: ${formatEther(ethIn)} of ${job.minEthPerRound} ETH`;
      s.lastResult = detail;
      return { jobId: id, dryRun, phase: "saving_up", detail, ethIn: formatEther(ethIn) };
    }

    const [dropDecimals, dropSymbol] = await Promise.all([
      base.publicClient.readContract({ address: base.tokenAddress, abi: ERC20_ABI, functionName: "decimals" }),
      base.publicClient.readContract({ address: base.tokenAddress, abi: ERC20_ABI, functionName: "symbol" }).catch(() => "TOKEN"),
    ]);
    const holdDecimals = await base.publicClient.readContract({
      address: holdView.tokenAddress,
      abi: ERC20_ABI,
      functionName: "decimals",
    });
    const minRaw = parseUnits(job.minHolding || "0", holdDecimals);

    // who gets paid: current hold-token holders above the minimum
    await sync(holdView);
    const holders = await getHolders(holdView, { minBalance: minRaw, topN: job.maxRecipients });
    if (holders.length === 0) {
      const detail = "no qualifying holders (check hold token CA / start block / min holding)";
      s.lastResult = detail;
      return { jobId: id, dryRun, phase: "no_holders", detail, ethIn: formatEther(ethIn) };
    }
    const totalHeld = holders.reduce((a, h) => a + h.balance, 0n);

    const quote = await quoteBuy(base, ethIn);
    const shareOf = (pool: bigint, bal: bigint): bigint => (pool * bal) / totalHeld;

    if (dryRun) {
      const top = holders.slice(0, 10).map((h) => ({
        address: h.address,
        amount: formatUnits(shareOf(quote.quotedOut, h.balance), dropDecimals),
      }));
      const detail = `PLAN: swap ${formatEther(ethIn)} ETH -> ~${formatUnits(quote.quotedOut, dropDecimals)} ${dropSymbol}, pay ${holders.length} holders`;
      s.lastResult = `dry-run: ${detail}`;
      journal.append({
        type: "round",
        dryRun: true,
        projectId: `drop-${id}`,
        token: base.tokenAddress,
        recipientCount: holders.length,
        amount: ethIn.toString(),
        detail,
      });
      emitEvent("round_plan", { recipientCount: holders.length, dryRun: true }, `drop-${id}`);
      return {
        jobId: id,
        dryRun: true,
        phase: "ready",
        detail,
        ethIn: formatEther(ethIn),
        quotedOut: formatUnits(quote.quotedOut, dropDecimals),
        airdropSymbol: dropSymbol,
        recipients: holders.length,
        top,
      };
    }

    // LIVE: swap, then distribute the wallet's FULL airdrop-token balance
    await base.sender.refreshNonce();
    const roundId = `drop-${id}-${Date.now()}`;
    await buyToken(base, ethIn, { dryRun: false, roundId });
    const dropBalance = await withRetry(
      () => base.publicClient.readContract({ address: base.tokenAddress, abi: ERC20_ABI, functionName: "balanceOf", args: [wallet] }),
      `autodrop:${id}.dropBal`,
    );
    if (dropBalance === 0n) {
      const detail = "swap done but zero airdrop-token balance — nothing to send";
      s.lastResult = detail;
      return { jobId: id, dryRun: false, phase: "error", detail };
    }
    const items: AirdropItem[] = holders
      .map((h) => ({ recipient: h.address, amountWei: shareOf(dropBalance, h.balance) }))
      .filter((i) => i.amountWei > 0n);
    const outcome = await runAirdrop(base, "token", items, roundId, false);
    const detail = `paid ${outcome.sent}/${items.length} holders — ${formatUnits(outcome.totalSentWei, dropDecimals)} ${dropSymbol}`;
    s.lastResult = detail;
    journal.append({
      type: "round",
      dryRun: false,
      projectId: `drop-${id}`,
      roundId,
      token: base.tokenAddress,
      asset: "token",
      recipientCount: outcome.sent,
      failedCount: outcome.failed,
      amount: outcome.totalSentWei.toString(),
      txHash: outcome.firstTxHash,
      detail,
    });
    emitEvent("round_end", { recipientCount: outcome.sent, failedCount: outcome.failed, dryRun: false }, `drop-${id}`);
    return {
      jobId: id,
      dryRun: false,
      phase: "done",
      detail,
      ethIn: formatEther(ethIn),
      airdropSymbol: dropSymbol,
      recipients: items.length,
      sent: outcome.sent,
      failed: outcome.failed,
      totalSent: formatUnits(outcome.totalSentWei, dropDecimals),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    s.lastResult = `error: ${message.slice(0, 200)}`;
    journal.append({ type: "error", projectId: `drop-${id}`, detail: `autodrop: ${message.slice(0, 300)}` });
    return { jobId: id, dryRun, phase: "error", detail: message.slice(0, 300) };
  } finally {
    s.busy = false;
  }
}

function schedule(s: JobState): void {
  if (s.timer) clearTimeout(s.timer);
  const intervalMs = Math.max(1, s.job.intervalMinutes) * 60_000;
  const tick = async (): Promise<void> => {
    s.nextRunAt = Date.now() + intervalMs;
    s.timer = setTimeout(() => void tick(), intervalMs);
    if (!s.job.enabled || s.busy) return;
    // scheduled cycles: live when the master switch allows it, dry otherwise
    await runJobOnce(s.job.id, { dryRun: CONFIG.dryRun }).catch(() => undefined);
  };
  void tick();
}

export function listJobs(): Array<AutodropJob & { wallet: string; nextRunAt: number | null; lastResult: string; busy: boolean }> {
  return [...states.values()].map((s) => ({
    ...s.job,
    wallet: s.base.botAddress,
    nextRunAt: s.nextRunAt,
    lastResult: s.lastResult,
    busy: s.busy,
  }));
}

export function createJob(input: Partial<AutodropJob>): { id: string; wallet: string } {
  const id = String(input.id ?? "").trim().toLowerCase();
  if (!/^[a-z0-9-]{2,24}$/.test(id)) throw new Error("id must be 2-24 chars: a-z, 0-9, dashes");
  if (states.has(id)) throw new Error(`autodrop job "${id}" already exists`);
  const keyRef = String(input.keyRef ?? "").trim();
  if (!keyRef.startsWith("env:") && !keyRef.startsWith("vault:")) {
    throw new Error('keyRef required — import the wallet key first, then use "vault:<id>"');
  }
  const job: AutodropJob = {
    id,
    keyRef,
    airdropToken: addr(String(input.airdropToken ?? "")),
    holdToken: addr(String(input.holdToken ?? "")),
    minHolding: /^\d+(\.\d+)?$/.test(String(input.minHolding ?? "").trim()) ? String(input.minHolding).trim() : "0",
    holdersStartBlock: /^\d+$/.test(String(input.holdersStartBlock ?? "").trim()) ? String(input.holdersStartBlock).trim() : "0",
    intervalMinutes: Number.isInteger(Number(input.intervalMinutes)) && Number(input.intervalMinutes) >= 1 ? Number(input.intervalMinutes) : 10,
    minEthPerRound: /^\d+(\.\d+)?$/.test(String(input.minEthPerRound ?? "").trim()) ? String(input.minEthPerRound).trim() : "0.005",
    gasReserveEth: /^\d+(\.\d+)?$/.test(String(input.gasReserveEth ?? "").trim()) ? String(input.gasReserveEth).trim() : "0.002",
    feeTier: [500, 3000, 10000].includes(Number(input.feeTier)) ? Number(input.feeTier) : 10000,
    maxRecipients: Number.isInteger(Number(input.maxRecipients)) && Number(input.maxRecipients) >= 1 ? Number(input.maxRecipients) : 300,
    enabled: input.enabled !== false,
  };
  const views = buildViews(job); // validates addresses + resolves the key
  const s: JobState = { job, ...views, busy: false, nextRunAt: null, lastResult: "never ran" };
  states.set(id, s);
  persist();
  schedule(s);
  journal.append({ type: "config", dryRun: false, projectId: `drop-${id}`, token: views.base.tokenAddress, detail: `autodrop job "${id}" created` });
  emitEvent("config", { created: `drop-${id}` }, `drop-${id}`);
  return { id, wallet: views.base.botAddress };
}

export function setJobEnabled(id: string, enabled: boolean): void {
  const s = states.get(id);
  if (!s) throw new Error(`unknown autodrop job "${id}"`);
  s.job.enabled = enabled;
  persist();
  journal.append({ type: "config", dryRun: false, projectId: `drop-${id}`, detail: `autodrop job "${id}" ${enabled ? "enabled" : "disabled"}` });
}

export function deleteJob(id: string): void {
  const s = states.get(id);
  if (!s) throw new Error(`unknown autodrop job "${id}"`);
  if (s.busy) throw new Error(`job "${id}" is running — try again in a moment`);
  if (s.timer) clearTimeout(s.timer);
  states.delete(id);
  persist();
  journal.append({ type: "config", dryRun: false, projectId: `drop-${id}`, detail: `autodrop job "${id}" removed` });
}

/** boot: load persisted jobs, rebuild runtimes, start their loops. */
export function initAutodrop(): void {
  for (const job of loadJobsFile()) {
    try {
      const views = buildViews(job);
      const s: JobState = { job, ...views, busy: false, nextRunAt: null, lastResult: "never ran (booted)" };
      states.set(job.id, s);
      schedule(s);
      console.log(`[autodrop] job "${job.id}" — wallet ${views.base.botAddress}, every ${job.intervalMinutes} min${job.enabled ? "" : " (disabled)"}`);
    } catch (err) {
      console.error(`[autodrop] job "${job.id}" failed to load: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
