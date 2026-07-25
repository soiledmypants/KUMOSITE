import { formatEther, parseAbi } from "viem";
import { addr, CONFIG, ZERO_ADDRESS } from "../config.js";
import { isDryRun } from "../runtime-mode.js";
import { withRetry } from "../rpc.js";
import type { ProjectRuntime } from "../projects.js";
import * as journal from "./journal.js";
import { emitEvent } from "./events.js";
import { reportToKumo } from "./kumo.js";

/**
 * pons.family fee claiming (PonsLaunchLocker, verified on Blockscout).
 * Fees accrue in the token's locked Uniswap V3 position as WETH + the token
 * itself; collectFees pays the on-chain recipient (feeRedirects[token] ||
 * deployer) REGARDLESS of caller, minus the protocol share snapshotted at
 * lock time. Ported unchanged from phase 1 (locker.ts + forward.ts),
 * parametrized by ProjectRuntime.
 */

export const PONS_LOCKERS = {
  current: addr("0x736D76699C26D0d966744cAe304C000d471f7F35"), // block 8991118+, protocol 30%
  legacy: addr("0x31ca5E101941A93A7DD6d0497928700625CF54B5"), // block 8600612+, protocol 10%
};

export const LOCKER_ABI = parseAbi([
  "struct LaunchedToken { address token; address deployer; address pairedToken; address positionManager; uint256 positionId; uint256 dexId; uint256 launchConfigId; uint256 restrictionsEndBlock; uint256 supply; bool isToken0; uint24 poolFee; bool exists; uint256 initialBuyAmount; }",
  "function collectFees(address token) returns (uint256 amount0, uint256 amount1)",
  "function getLaunchedToken(address token) view returns (LaunchedToken memory)",
  "function feeRedirects(address token) view returns (address)",
  "function tokenProtocolFeeShares(address token) view returns (uint256)",
  "function feeCollectors(address collector) view returns (bool)",
  "event FeesClaimed(address indexed token, address indexed caller, address token0, address token1, uint256 recipientAmount0, uint256 recipientAmount1, uint256 protocolAmount0, uint256 protocolAmount1)",
]);

const WETH_ABI = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function withdraw(uint256 wad)",
]);

const ERC20_ABI = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
]);

export interface LaunchedTokenInfo {
  deployer: `0x${string}`;
  pairedToken: `0x${string}`;
  positionId: bigint;
  /** true = the launched token is token0 in the pool (so WETH is token1). */
  isToken0: boolean;
  exists: boolean;
}

export interface LockerContext {
  locker: `0x${string}`;
  generation: "current" | "legacy" | "explicit";
  launched: LaunchedTokenInfo;
  /** On-chain fee recipient: feeRedirects[token] || deployer. Refreshed each cycle. */
  recipient: `0x${string}`;
  protocolFeeSharePct: bigint;
}

export interface Claimable {
  grossWethWei: bigint;
  grossTokenRaw: bigint;
  netWethWei: bigint;
  netTokenRaw: bigint;
}

async function readLaunched(
  p: ProjectRuntime,
  locker: `0x${string}`,
  label: string,
): Promise<LaunchedTokenInfo | null> {
  try {
    const t = await withRetry(
      () =>
        p.publicClient.readContract({
          address: locker,
          abi: LOCKER_ABI,
          functionName: "getLaunchedToken",
          args: [p.tokenAddress],
        }),
      label,
      { retries: 2 },
    );
    return t.exists
      ? {
          deployer: t.deployer,
          pairedToken: t.pairedToken,
          positionId: t.positionId,
          isToken0: t.isToken0,
          exists: t.exists,
        }
      : null;
  } catch {
    // Locker reverts (TokenNotFound) or RPC refused — treat as "not on this locker".
    return null;
  }
}

/** Boot resolution: find the locker holding the token, assert WETH pairing, read recipient+share. */
export async function resolveLockerContext(p: ProjectRuntime): Promise<LockerContext | null> {
  if (p.lockerMode === null) return null;

  const candidates: Array<{ locker: `0x${string}`; generation: LockerContext["generation"] }> =
    p.lockerMode === "auto"
      ? [
          { locker: PONS_LOCKERS.current, generation: "current" },
          { locker: PONS_LOCKERS.legacy, generation: "legacy" },
        ]
      : [{ locker: p.lockerMode, generation: "explicit" }];

  for (const { locker, generation } of candidates) {
    const launched = await readLaunched(p, locker, `claim:${p.id}.getLaunchedToken(${generation})`);
    if (!launched) continue;

    if (launched.pairedToken.toLowerCase() !== p.weth.toLowerCase()) {
      throw new Error(
        `project "${p.id}": token is paired against ${launched.pairedToken}, not WETH (${p.weth})`,
      );
    }

    const [redirect, share] = await Promise.all([
      withRetry(
        () =>
          p.publicClient.readContract({
            address: locker,
            abi: LOCKER_ABI,
            functionName: "feeRedirects",
            args: [p.tokenAddress],
          }),
        `claim:${p.id}.feeRedirects`,
      ),
      withRetry(
        () =>
          p.publicClient.readContract({
            address: locker,
            abi: LOCKER_ABI,
            functionName: "tokenProtocolFeeShares",
            args: [p.tokenAddress],
          }),
        `claim:${p.id}.tokenProtocolFeeShares`,
      ),
    ]);

    const recipient = redirect.toLowerCase() === ZERO_ADDRESS ? launched.deployer : redirect;
    p.sender.allow(locker); // the resolved locker joins the static allowlist
    console.log(
      `[claim:${p.id}] resolved ${generation} locker ${locker} — deployer ${launched.deployer}, ` +
        `recipient ${recipient}, protocol share ${share}%`,
    );
    return { locker, generation, launched, recipient, protocolFeeSharePct: share };
  }

  throw new Error(
    `project "${p.id}": token ${p.tokenAddress} not found on any pons locker ` +
      `(mode ${String(p.lockerMode)})`,
  );
}

/** Re-read feeRedirects (it can change at any time via setFeeRedirect). */
export async function refreshRecipient(p: ProjectRuntime, ctx: LockerContext): Promise<void> {
  const redirect = await withRetry(
    () =>
      p.publicClient.readContract({
        address: ctx.locker,
        abi: LOCKER_ABI,
        functionName: "feeRedirects",
        args: [p.tokenAddress],
      }),
    `claim:${p.id}.feeRedirects`,
  );
  ctx.recipient = redirect.toLowerCase() === ZERO_ADDRESS ? ctx.launched.deployer : redirect;
}

/** Read claimable by SIMULATING collectFees via eth_call (returns gross; net = minus protocol cut). */
export async function readClaimable(
  p: ProjectRuntime,
  ctx: LockerContext,
  dryRun: boolean,
): Promise<Claimable> {
  const sender = dryRun ? ctx.recipient : p.botAddress;
  const { result } = await withRetry(
    () =>
      p.publicClient.simulateContract({
        address: ctx.locker,
        abi: LOCKER_ABI,
        functionName: "collectFees",
        args: [p.tokenAddress],
        account: sender,
      }),
    `claim:${p.id}.simulateCollectFees`,
  );

  const [amount0, amount1] = result;
  const grossWethWei = ctx.launched.isToken0 ? amount1 : amount0;
  const grossTokenRaw = ctx.launched.isToken0 ? amount0 : amount1;
  // Mirrors the verified source: protocolAmount = (amount * share) / 100.
  const netWethWei = grossWethWei - (grossWethWei * ctx.protocolFeeSharePct) / 100n;
  const netTokenRaw = grossTokenRaw - (grossTokenRaw * ctx.protocolFeeSharePct) / 100n;
  return { grossWethWei, grossTokenRaw, netWethWei, netTokenRaw };
}

function logStepError(p: ProjectRuntime, step: string, err: unknown, out: journal.LogEntry[]): void {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[${step}:${p.id}] ERROR: ${message}`);
  try {
    out.push(journal.append({ type: "error", projectId: p.id, detail: `${step}: ${message}` }));
  } catch {
    // Journal write failed — already logged, never crash the cycle.
  }
}

/**
 * One full claim pass: claim -> unwrap -> forward ETH -> forward token.
 * Never throws. Returns the journal entries it produced.
 */
export async function claimCycle(
  p: ProjectRuntime,
  ctx: LockerContext | null,
  opts: { dryRun?: boolean } = {},
): Promise<journal.LogEntry[]> {
  const dryRun = isDryRun() || (opts.dryRun ?? false);
  const out: journal.LogEntry[] = [];
  console.log(`\n[cycle:${p.id}] ===== ${new Date().toISOString()}${dryRun ? " (DRY RUN)" : ""} =====`);
  emitEvent("cycle", { phase: "start", dryRun }, p.id);

  try {
    // ---- 0. Recipient guard — feeRedirects can change under us at any time.
    let recipientOk = false;
    if (ctx) {
      try {
        await refreshRecipient(p, ctx);
        recipientOk = ctx.recipient.toLowerCase() === p.botAddress.toLowerCase();
        if (!recipientOk) {
          const msg =
            `on-chain fee recipient is ${ctx.recipient}, not the bot wallet ${p.botAddress} — ` +
            `claimed funds would NOT land here`;
          if (dryRun) console.warn(`[cycle:${p.id}] WARNING: ${msg}`);
          else logStepError(p, "recipient", new Error(msg), out);
        }
      } catch (err) {
        logStepError(p, "recipient", err, out);
        return out;
      }
    }

    if (!dryRun) {
      try {
        await p.sender.refreshNonce();
      } catch (err) {
        logStepError(p, "nonce", err, out);
        return out;
      }
    }

    // ---- 1. CLAIM ---------------------------------------------------------
    let plannedClaimWethWei = 0n;
    if (ctx) {
      try {
        const c = await readClaimable(p, ctx, dryRun);
        console.log(
          `[claim:${p.id}] claimable gross ${formatEther(c.grossWethWei)} WETH + ` +
            `${c.grossTokenRaw} token units — net ${formatEther(c.netWethWei)} WETH`,
        );
        if (c.netWethWei >= p.claim.claimMinWei) {
          if (dryRun) {
            console.log(`[claim:${p.id}] DRY RUN: would send collectFees to ${ctx.locker}`);
            out.push(
              journal.append({
                type: "claim",
                dryRun: true,
                projectId: p.id,
                token: p.tokenAddress,
                grossWeth: c.grossWethWei.toString(),
                netWeth: c.netWethWei.toString(),
                grossToken: c.grossTokenRaw.toString(),
                netToken: c.netTokenRaw.toString(),
                detail: "planned",
              }),
            );
            plannedClaimWethWei = c.netWethWei;
          } else if (!recipientOk) {
            console.warn(`[claim:${p.id}] skipping claim — recipient mismatch`);
          } else {
            const hash = await p.sender.sendWithGasBump(
              {
                kind: "contract",
                to: ctx.locker,
                abi: LOCKER_ABI,
                functionName: "collectFees",
                args: [p.tokenAddress],
              },
              `claim:${p.id}.collectFees`,
            );
            out.push(
              journal.append({
                type: "claim",
                dryRun: false,
                projectId: p.id,
                token: p.tokenAddress,
                grossWeth: c.grossWethWei.toString(),
                netWeth: c.netWethWei.toString(),
                grossToken: c.grossTokenRaw.toString(),
                netToken: c.netTokenRaw.toString(),
                txHash: hash,
              }),
            );
            reportToKumo(p, {
              kind: "claim",
              txHash: hash,
              assetOut: "WETH",
              amountOut: formatEther(c.netWethWei),
              from: ctx.locker,
              to: p.botAddress,
              note:
                `ops-panel claimed ${formatEther(c.netWethWei)} WETH + ` +
                `${formatEther(c.netTokenRaw)} token (net creator fees, ${p.id})`,
            });
          }
        } else {
          console.log(
            `[claim:${p.id}] net claimable below claimMin (${formatEther(p.claim.claimMinWei)}) — not claiming`,
          );
        }
      } catch (err) {
        logStepError(p, "claim", err, out);
      }
    }

    // ---- 2. UNWRAP whole WETH balance (self-heals leftovers) ---------------
    let plannedUnwrapWei = 0n;
    try {
      plannedUnwrapWei = await unwrapWeth(p, dryRun, out);
    } catch (err) {
      logStepError(p, "unwrap", err, out);
    }

    // ---- 3. FORWARD ETH (treasury/kumo split) ------------------------------
    try {
      const plannedIncoming = dryRun ? plannedClaimWethWei + plannedUnwrapWei : 0n;
      await forwardEth(p, dryRun, plannedIncoming, out);
    } catch (err) {
      logStepError(p, "forward_eth", err, out);
    }

    // ---- 4. FORWARD TOKEN --------------------------------------------------
    try {
      await forwardToken(p, dryRun, out);
    } catch (err) {
      logStepError(p, "forward_token", err, out);
    }

    console.log(`[cycle:${p.id}] complete`);
  } catch (err) {
    logStepError(p, "cycle", err, out);
  }
  emitEvent("cycle", { phase: "end", dryRun, entries: out.length }, p.id);
  return out;
}

async function unwrapWeth(
  p: ProjectRuntime,
  dryRun: boolean,
  out: journal.LogEntry[],
): Promise<bigint> {
  const bal = await withRetry(
    () =>
      p.publicClient.readContract({
        address: p.weth,
        abi: WETH_ABI,
        functionName: "balanceOf",
        args: [p.botAddress],
      }),
    `forward:${p.id}.wethBalance`,
  );
  if (bal === 0n) return 0n;

  if (dryRun) {
    console.log(`[unwrap:${p.id}] DRY RUN: would unwrap ${formatEther(bal)} WETH -> ETH`);
    out.push(
      journal.append({ type: "unwrap", dryRun: true, projectId: p.id, amount: bal.toString(), detail: "planned" }),
    );
    return bal;
  }

  const hash = await p.sender.sendWithGasBump(
    { kind: "contract", to: p.weth, abi: WETH_ABI, functionName: "withdraw", args: [bal] },
    `forward:${p.id}.unwrap`,
  );
  out.push(
    journal.append({ type: "unwrap", dryRun: false, projectId: p.id, amount: bal.toString(), txHash: hash }),
  );
  return bal;
}

async function forwardEth(
  p: ProjectRuntime,
  dryRun: boolean,
  plannedIncomingWei: bigint,
  out: journal.LogEntry[],
): Promise<void> {
  const ethBal = await withRetry(
    () => p.publicClient.getBalance({ address: p.botAddress }),
    `forward:${p.id}.getBalance`,
  );
  const basis = ethBal + plannedIncomingWei;

  let forwardable = basis - p.caps.gasReserveWei;
  if (forwardable <= 0n) return;
  if (forwardable > p.caps.maxForwardWei) forwardable = p.caps.maxForwardWei;
  if (forwardable < p.caps.forwardMinWei) return;

  const treasuryWei = (forwardable * BigInt(p.treasuryPct)) / 100n;
  const kumoWei = forwardable - treasuryWei;

  const legs: Array<{ role: "treasury" | "kumo"; to: `0x${string}`; amount: bigint }> = [];
  if (treasuryWei > 0n) legs.push({ role: "treasury", to: p.treasuryWallet, amount: treasuryWei });
  if (kumoWei > 0n && p.kumoWallet) legs.push({ role: "kumo", to: p.kumoWallet, amount: kumoWei });

  for (const leg of legs) {
    if (dryRun) {
      console.log(
        `[forward:${p.id}] DRY RUN: would send ${formatEther(leg.amount)} ETH -> ${leg.role} ${leg.to}`,
      );
      out.push(
        journal.append({
          type: "forward_eth",
          dryRun: true,
          projectId: p.id,
          amount: leg.amount.toString(),
          to: leg.to,
          role: leg.role,
          detail: "planned",
        }),
      );
      continue;
    }
    const hash = await p.sender.sendWithGasBump(
      { kind: "native", to: leg.to, value: leg.amount },
      `forward:${p.id}.eth.${leg.role}`,
    );
    out.push(
      journal.append({
        type: "forward_eth",
        dryRun: false,
        projectId: p.id,
        amount: leg.amount.toString(),
        to: leg.to,
        role: leg.role,
        txHash: hash,
      }),
    );
    reportToKumo(p, {
      kind: "forward",
      txHash: hash,
      assetOut: "ETH",
      amountOut: formatEther(leg.amount),
      from: p.botAddress,
      to: leg.to,
      note: `ops-panel forwarded ${formatEther(leg.amount)} ETH to ${leg.role} (${p.id})`,
    });
  }
}

async function forwardToken(
  p: ProjectRuntime,
  dryRun: boolean,
  out: journal.LogEntry[],
): Promise<void> {
  const bal = await withRetry(
    () =>
      p.publicClient.readContract({
        address: p.tokenAddress,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [p.botAddress],
      }),
    `forward:${p.id}.tokenBalance`,
  );
  if (bal === 0n) return;

  if (dryRun) {
    console.log(`[forward:${p.id}] DRY RUN: would transfer ${bal} token units -> treasury`);
    out.push(
      journal.append({
        type: "forward_token",
        dryRun: true,
        projectId: p.id,
        token: p.tokenAddress,
        amount: bal.toString(),
        to: p.treasuryWallet,
        detail: "planned",
      }),
    );
    return;
  }

  const hash = await p.sender.sendWithGasBump(
    {
      kind: "contract",
      to: p.tokenAddress,
      abi: ERC20_ABI,
      functionName: "transfer",
      args: [p.treasuryWallet, bal],
    },
    `forward:${p.id}.token`,
  );
  out.push(
    journal.append({
      type: "forward_token",
      dryRun: false,
      projectId: p.id,
      token: p.tokenAddress,
      amount: bal.toString(),
      to: p.treasuryWallet,
      txHash: hash,
    }),
  );
  reportToKumo(p, {
    kind: "forward",
    txHash: hash,
    assetOut: "TOKEN",
    amountOut: formatEther(bal),
    from: p.botAddress,
    to: p.treasuryWallet,
    note: `ops-panel forwarded ${formatEther(bal)} project token to treasury (${p.id})`,
  });
}
