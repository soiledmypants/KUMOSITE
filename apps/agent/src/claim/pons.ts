// pons.family fee claiming, ported from ops-panel (engine/claim.ts) and folded
// into kumo. fees accrue in the $KUMO token's locked uniswap v3 position as
// WETH + the token itself; collectFees pays the ON-CHAIN recipient
// (feeRedirects[token] || deployer) no matter who calls — so the claimer key
// must derive that wallet, verified every cycle, live claiming disabled loudly
// otherwise.
//
// signer topology: CLAIMER_PRIVATE_KEY when set (two-wallet topology: deployer
// wallet claims, forwards ETH to the kumo hot wallet), else falls back to
// PRIVATE_KEY (hot wallet claims for itself, forward leg skipped).
//
// this module has its OWN scoped sender + allowlist (locker, WETH, $KUMO,
// hot wallet, treasury). it never touches trade/guard.ts or its allowlist.
import {
  createWalletClient,
  encodeFunctionData,
  formatEther,
  http,
  parseAbi,
  parseEther,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CONFIG, robinhoodChain } from "../config.js";
import { publicClient, botAddress } from "../clients.js";
import { withRetry } from "../rpc.js";
import { recordLedger } from "../ledger.js";
import { say } from "../voice.js";

import { ADDRESSES } from "@kumo/shared";

// verified pons lockers on chain 4663 (single copy lives in @kumo/shared)
export const PONS_LOCKERS = {
  current: ADDRESSES.ponsLockerCurrent as Address,
  legacy: ADDRESSES.ponsLockerLegacy as Address,
};

export const LOCKER_ABI = parseAbi([
  "struct LaunchedToken { address token; address deployer; address pairedToken; address positionManager; uint256 positionId; uint256 dexId; uint256 launchConfigId; uint256 restrictionsEndBlock; uint256 supply; bool isToken0; uint24 poolFee; bool exists; uint256 initialBuyAmount; }",
  "function collectFees(address token) returns (uint256 amount0, uint256 amount1)",
  "function getLaunchedToken(address token) view returns (LaunchedToken memory)",
  "function feeRedirects(address token) view returns (address)",
  "function tokenProtocolFeeShares(address token) view returns (uint256)",
]);

const WETH_ABI = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function withdraw(uint256 wad)",
]);

const ERC20_ABI = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
]);

// ---- claimer wallet: CLAIMER_PRIVATE_KEY || PRIVATE_KEY (key never logged) ----
const rawClaimerKey = process.env.CLAIMER_PRIVATE_KEY ?? process.env.PRIVATE_KEY ?? "";
const claimerKey = rawClaimerKey
  ? ((rawClaimerKey.startsWith("0x") ? rawClaimerKey : `0x${rawClaimerKey}`) as `0x${string}`)
  : null;
const claimerAccount = claimerKey ? privateKeyToAccount(claimerKey) : null;
export const claimerAddress: Address | null = claimerAccount?.address ?? null;
const claimerWallet = claimerAccount
  ? createWalletClient({ account: claimerAccount, chain: robinhoodChain, transport: http(CONFIG.rpcUrl) })
  : null;

// ---- scoped sender: fixed allowlist + per-cycle nonce + gas-bump resend ----
const allowed = new Set<string>();
function allow(target: Address): void {
  allowed.add(target.toLowerCase());
}

let nonce: number | null = null;

async function sendClaimTx(tx: { to: Address; data?: `0x${string}`; value?: bigint }, label: string): Promise<`0x${string}`> {
  if (!claimerAccount || !claimerWallet) throw new Error("no claimer key configured");
  if (!allowed.has(tx.to.toLowerCase())) {
    throw new Error(`claim module refusing to sign tx to non-allowlisted address ${tx.to}`);
  }
  if (nonce === null) {
    nonce = await withRetry(
      () => publicClient.getTransactionCount({ address: claimerAccount.address, blockTag: "pending" }),
      "claim.nonce",
    );
  }
  const useNonce = nonce++;
  const fees = await withRetry(() => publicClient.estimateFeesPerGas(), "claim.fees");
  let maxFeePerGas = fees.maxFeePerGas;
  let maxPriorityFeePerGas = fees.maxPriorityFeePerGas;

  const send = () =>
    withRetry(
      () =>
        claimerWallet.sendTransaction({
          to: tx.to,
          data: tx.data,
          value: tx.value ?? 0n,
          nonce: useNonce,
          maxFeePerGas,
          maxPriorityFeePerGas,
        }),
      `claim.send.${label}`,
    );

  let hash = await send();
  const deadline = Date.now() + CONFIG.txWaitMs;
  for (;;) {
    try {
      const receipt = await publicClient.waitForTransactionReceipt({
        hash,
        timeout: Math.max(5_000, deadline - Date.now()),
      });
      if (receipt.status !== "success") throw new Error(`tx reverted: ${hash}`);
      return hash;
    } catch (err) {
      if (Date.now() < deadline) throw err;
      const bump = (v: bigint) => (v * BigInt(100 + CONFIG.gasBumpPct)) / 100n;
      maxFeePerGas = bump(maxFeePerGas);
      maxPriorityFeePerGas = bump(maxPriorityFeePerGas);
      hash = await send();
    }
  }
}

// ---- locker context ----
interface LockerContext {
  locker: Address;
  generation: "current" | "legacy" | "explicit";
  deployer: Address;
  isToken0: boolean;
  recipient: Address;
  protocolFeeSharePct: bigint;
}

interface ClaimState {
  lastRun: number | null;
  lastResult: string;
  disabledReason: string | null;
  locker: string | null;
  generation: string | null;
  recipient: string | null;
  recipientOk: boolean | null;
  claimable: { grossWethEth: string; netWethEth: string } | null;
}

export const claimState: ClaimState = {
  lastRun: null,
  lastResult: "never ran",
  disabledReason: null,
  locker: null,
  generation: null,
  recipient: null,
  recipientOk: null,
  claimable: null,
};

let ctx: LockerContext | null = null;

async function readLaunched(locker: Address, token: Address) {
  try {
    const t = await withRetry(
      () =>
        publicClient.readContract({ address: locker, abi: LOCKER_ABI, functionName: "getLaunchedToken", args: [token] }),
      "claim.getLaunchedToken",
      { retries: 2 },
    );
    return t.exists ? t : null;
  } catch {
    return null; // locker reverts (TokenNotFound) — not on this locker
  }
}

/** find the locker holding $KUMO, assert WETH pairing, read recipient + share */
export async function resolveLockerContext(): Promise<LockerContext | null> {
  if (!CONFIG.kumoToken) return null;
  const token = CONFIG.kumoToken as Address;

  const candidates: Array<{ locker: Address; generation: LockerContext["generation"] }> =
    CONFIG.ponsLocker === "auto"
      ? [
          { locker: PONS_LOCKERS.current, generation: "current" },
          { locker: PONS_LOCKERS.legacy, generation: "legacy" },
        ]
      : [{ locker: CONFIG.ponsLocker as Address, generation: "explicit" }];

  for (const { locker, generation } of candidates) {
    const launched = await readLaunched(locker, token);
    if (!launched) continue;
    if (launched.pairedToken.toLowerCase() !== CONFIG.weth.toLowerCase()) {
      throw new Error(`$KUMO is paired against ${launched.pairedToken}, not WETH — refusing to claim`);
    }
    const [redirect, share] = await Promise.all([
      withRetry(
        () => publicClient.readContract({ address: locker, abi: LOCKER_ABI, functionName: "feeRedirects", args: [token] }),
        "claim.feeRedirects",
      ),
      withRetry(
        () =>
          publicClient.readContract({ address: locker, abi: LOCKER_ABI, functionName: "tokenProtocolFeeShares", args: [token] }),
        "claim.protocolShare",
      ),
    ]);
    const recipient = /^0x0+$/.test(redirect) ? launched.deployer : redirect;
    allow(locker);
    return { locker, generation, deployer: launched.deployer, isToken0: launched.isToken0, recipient, protocolFeeSharePct: share };
  }
  return null;
}

/** re-read feeRedirects (it can change at any time via setFeeRedirect) */
async function refreshRecipient(c: LockerContext): Promise<void> {
  const redirect = await withRetry(
    () =>
      publicClient.readContract({
        address: c.locker,
        abi: LOCKER_ABI,
        functionName: "feeRedirects",
        args: [CONFIG.kumoToken as Address],
      }),
    "claim.feeRedirects",
  );
  c.recipient = /^0x0+$/.test(redirect) ? c.deployer : redirect;
}

/** claimable read by SIMULATING collectFees (gross; net = minus protocol cut) */
async function readClaimable(c: LockerContext, asRecipient: boolean) {
  const { result } = await withRetry(
    () =>
      publicClient.simulateContract({
        address: c.locker,
        abi: LOCKER_ABI,
        functionName: "collectFees",
        args: [CONFIG.kumoToken as Address],
        account: asRecipient ? c.recipient : (claimerAddress as Address),
      }),
    "claim.simulateCollectFees",
  );
  const [amount0, amount1] = result;
  const grossWethWei = c.isToken0 ? amount1 : amount0;
  const grossTokenRaw = c.isToken0 ? amount0 : amount1;
  const netWethWei = grossWethWei - (grossWethWei * c.protocolFeeSharePct) / 100n;
  const netTokenRaw = grossTokenRaw - (grossTokenRaw * c.protocolFeeSharePct) / 100n;
  return { grossWethWei, grossTokenRaw, netWethWei, netTokenRaw };
}

/** one full pass: claim -> unwrap -> forward eth -> forward token. never throws. */
export async function claimCycleOnce(opts: { dryRun?: boolean } = {}): Promise<Record<string, unknown>> {
  const dryRun = CONFIG.claimDryRun || (opts.dryRun ?? false);
  const out: Record<string, unknown> = { dryRun, steps: [] as string[] };
  const steps = out.steps as string[];
  claimState.lastRun = Date.now();

  try {
    if (!CONFIG.kumoToken) {
      claimState.lastResult = "no KUMO_TOKEN set — nothing to claim yet";
      steps.push(claimState.lastResult);
      return out;
    }
    if (!claimerAddress) {
      claimState.lastResult = "no claimer key (CLAIMER_PRIVATE_KEY or PRIVATE_KEY)";
      steps.push(claimState.lastResult);
      return out;
    }
    if (!ctx) ctx = await resolveLockerContext();
    if (!ctx) {
      claimState.lastResult = "$KUMO not found on any pons locker";
      claimState.disabledReason = claimState.lastResult;
      steps.push(claimState.lastResult);
      return out;
    }
    claimState.locker = ctx.locker;
    claimState.generation = ctx.generation;

    // recipient guard — feeRedirects can change under us at any time
    await refreshRecipient(ctx);
    claimState.recipient = ctx.recipient;
    const recipientOk = ctx.recipient.toLowerCase() === claimerAddress.toLowerCase();
    claimState.recipientOk = recipientOk;
    if (!recipientOk) {
      claimState.disabledReason = `on-chain fee recipient is ${ctx.recipient}, not the claimer ${claimerAddress} — claimed funds would NOT land here`;
      steps.push(`recipient mismatch: ${claimState.disabledReason}`);
      if (!dryRun) {
        claimState.lastResult = "live claim blocked: recipient mismatch";
        return out;
      }
    } else {
      claimState.disabledReason = null;
    }

    nonce = null; // fresh nonce per cycle

    // 1. claim
    const c = await readClaimable(ctx, dryRun || !recipientOk);
    claimState.claimable = { grossWethEth: formatEther(c.grossWethWei), netWethEth: formatEther(c.netWethWei) };
    const minWei = parseEther(CONFIG.claimMinEth.toString());
    if (c.netWethWei >= minWei) {
      if (dryRun) {
        steps.push(`DRY: would collectFees on ${ctx.locker} for ~${formatEther(c.netWethWei)} WETH net`);
      } else if (recipientOk) {
        const data = encodeFunctionData({ abi: LOCKER_ABI, functionName: "collectFees", args: [CONFIG.kumoToken as Address] });
        const hash = await sendClaimTx({ to: ctx.locker, data }, "collectFees");
        steps.push(`claimed: ${hash}`);
        await recordLedger({
          kind: "claim",
          txHash: hash,
          assetOut: "WETH",
          amountOut: formatEther(c.netWethWei),
          from: ctx.locker,
          to: claimerAddress,
          source: "kumo",
          note: `kumo collected its allowance. ${Number(formatEther(c.netWethWei)).toFixed(4)} weth (net creator fees).`,
        });
      }
    } else {
      steps.push(`claimable ${formatEther(c.netWethWei)} WETH below CLAIM_MIN_ETH ${CONFIG.claimMinEth} — not claiming`);
    }

    // 2. unwrap the whole WETH balance (self-heals leftovers)
    const wethBal = await withRetry(
      () =>
        publicClient.readContract({ address: CONFIG.weth, abi: WETH_ABI, functionName: "balanceOf", args: [claimerAddress] }),
      "claim.wethBalance",
    );
    let plannedUnwrap = 0n;
    if (wethBal > 0n) {
      if (dryRun) {
        plannedUnwrap = wethBal;
        steps.push(`DRY: would unwrap ${formatEther(wethBal)} WETH`);
      } else {
        const data = encodeFunctionData({ abi: WETH_ABI, functionName: "withdraw", args: [wethBal] });
        const hash = await sendClaimTx({ to: CONFIG.weth, data }, "unwrap");
        steps.push(`unwrapped ${formatEther(wethBal)} WETH: ${hash}`);
      }
    }

    // 3. forward eth: treasury pct -> CLAIM_TREASURY_WALLET, rest -> hot wallet.
    //    skipped entirely when the claimer IS the hot wallet and no treasury cut.
    const ethBal = await withRetry(() => publicClient.getBalance({ address: claimerAddress }), "claim.ethBal");
    const basis = ethBal + (dryRun ? plannedUnwrap : 0n);
    let forwardable = basis - parseEther(CONFIG.claimGasReserveEth.toString());
    const maxForward = parseEther(CONFIG.claimMaxForwardEth.toString());
    if (forwardable > maxForward) forwardable = maxForward;
    if (forwardable > 0n) {
      const treasuryWei = CONFIG.claimTreasuryWallet ? (forwardable * BigInt(CONFIG.claimTreasuryPct)) / 100n : 0n;
      const kumoWei = forwardable - treasuryWei;
      const legs: Array<{ role: string; to: Address; amount: bigint }> = [];
      if (treasuryWei > 0n && CONFIG.claimTreasuryWallet) {
        legs.push({ role: "treasury", to: CONFIG.claimTreasuryWallet as Address, amount: treasuryWei });
      }
      if (kumoWei > 0n && botAddress && claimerAddress.toLowerCase() !== botAddress.toLowerCase()) {
        legs.push({ role: "kumo", to: botAddress, amount: kumoWei });
      }
      for (const leg of legs) {
        allow(leg.to);
        if (dryRun) {
          steps.push(`DRY: would forward ${formatEther(leg.amount)} ETH -> ${leg.role} ${leg.to}`);
          continue;
        }
        const hash = await sendClaimTx({ to: leg.to, value: leg.amount }, `forward.${leg.role}`);
        steps.push(`forwarded ${formatEther(leg.amount)} ETH -> ${leg.role}: ${hash}`);
        await recordLedger({
          kind: "forward",
          txHash: hash,
          assetOut: "ETH",
          amountOut: formatEther(leg.amount),
          from: claimerAddress,
          to: leg.to,
          source: "kumo",
          note: `kumo passed ${Number(formatEther(leg.amount)).toFixed(4)} eth along to ${leg.role === "kumo" ? "its own hands" : "the treasury"}.`,
        });
      }
    }

    // 4. forward claimed $KUMO tokens to the treasury (held in place when unset)
    if (CONFIG.claimTreasuryWallet) {
      const tokenBal = await withRetry(
        () =>
          publicClient.readContract({
            address: CONFIG.kumoToken as Address,
            abi: ERC20_ABI,
            functionName: "balanceOf",
            args: [claimerAddress],
          }),
        "claim.tokenBal",
      );
      if (tokenBal > 0n) {
        if (dryRun) {
          steps.push(`DRY: would forward ${formatEther(tokenBal)} KUMO -> treasury`);
        } else {
          allow(CONFIG.kumoToken as Address);
          const data = encodeFunctionData({
            abi: ERC20_ABI,
            functionName: "transfer",
            args: [CONFIG.claimTreasuryWallet as Address, tokenBal],
          });
          const hash = await sendClaimTx({ to: CONFIG.kumoToken as Address, data }, "forward.token");
          steps.push(`forwarded ${formatEther(tokenBal)} KUMO -> treasury: ${hash}`);
          await recordLedger({
            kind: "forward",
            txHash: hash,
            assetOut: "KUMO",
            amountOut: formatEther(tokenBal),
            from: claimerAddress,
            to: CONFIG.claimTreasuryWallet,
            source: "kumo",
            note: `kumo passed ${Number(formatEther(tokenBal)).toFixed(2)} kumo along to the treasury.`,
          });
        }
      }
    }

    claimState.lastResult = dryRun ? `dry-run ok (${steps.length} planned steps)` : `cycle ok (${steps.length} steps)`;
  } catch (err) {
    claimState.lastResult = `error: ${(err as Error).message.slice(0, 200)}`;
    steps.push(claimState.lastResult);
    say("move", "kumo reached for its allowance and fumbled. kumo will try again next cycle.");
  }
  out.state = { ...claimState };
  return out;
}

// static allowlist targets known up front
allow(CONFIG.weth);
if (CONFIG.kumoToken) allow(CONFIG.kumoToken as Address);
if (CONFIG.claimTreasuryWallet) allow(CONFIG.claimTreasuryWallet as Address);
if (botAddress) allow(botAddress);
