import type { Abi } from "viem";
import { CONFIG, baseGasCaps, bumpGasCaps, explorerTx } from "./config.js";
import { publicClient, walletClient, botAddress } from "./clients.js";
import { withRetry } from "./rpc.js";

type GasCaps = { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint };

/** A contract write (ERC20 transfer, WETH withdraw, locker collectFees). */
export interface ContractSend {
  kind: "contract";
  to: `0x${string}`;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
}

/** A plain native-ETH transfer. */
export interface NativeSend {
  kind: "native";
  to: `0x${string}`;
  value: bigint;
}

export type SendRequest = ContractSend | NativeSend;

// ---------------------------------------------------------------------------
// Allowlist: the ONLY addresses this bot will ever sign a transaction to.
// Built once at boot from config + the resolved locker; everything else throws.
// ---------------------------------------------------------------------------

const allowed = new Set<string>();

/** Register the complete set of permitted tx targets. Called once at boot. */
export function initAllowlist(targets: `0x${string}`[]): void {
  allowed.clear();
  for (const t of targets) allowed.add(t.toLowerCase());
  console.log(`[send] allowlist: ${targets.join(", ")}`);
}

/** Hard gate in front of every broadcast. */
export function assertAllowedTarget(to: `0x${string}`): void {
  if (!allowed.has(to.toLowerCase())) {
    throw new Error(`[send] BLOCKED: ${to} is not on the send allowlist — refusing to sign`);
  }
}

// ---------------------------------------------------------------------------
// Nonce management: fetched once per cycle, incremented locally per broadcast
// (same convention as memedex distribute.ts). refreshNonce() at cycle start.
// ---------------------------------------------------------------------------

let nonce = 0;

/** Re-sync the local nonce with the chain's pending count. Call at cycle start (live mode). */
export async function refreshNonce(): Promise<void> {
  nonce = await withRetry(
    () => publicClient.getTransactionCount({ address: botAddress, blockTag: "pending" }),
    "send.getTransactionCount",
  );
}

/** Broadcast `req` at an explicit nonce with the given gas caps. */
async function broadcast(
  req: SendRequest,
  txNonce: number,
  caps: GasCaps,
  label: string,
): Promise<`0x${string}`> {
  assertAllowedTarget(req.to);
  return withRetry(() => {
    if (req.kind === "native") {
      return walletClient.sendTransaction({
        to: req.to,
        value: req.value,
        nonce: txNonce,
        maxFeePerGas: caps.maxFeePerGas,
        maxPriorityFeePerGas: caps.maxPriorityFeePerGas,
      });
    }
    return walletClient.writeContract({
      address: req.to,
      abi: req.abi,
      functionName: req.functionName,
      args: req.args as unknown[],
      account: botAddress,
      nonce: txNonce,
      maxFeePerGas: caps.maxFeePerGas,
      maxPriorityFeePerGas: caps.maxPriorityFeePerGas,
    });
  }, `${label}[nonce=${txNonce}]`);
}

/**
 * Send one tx, and if it doesn't confirm within gas.txWaitMs, resend the SAME
 * nonce with gas bumped by gas.gasBumpPct to replace the stuck tx.
 *
 * The local nonce advances even if this throws: by the time an error can
 * surface here the tx was (in all likelihood) already broadcast, so the nonce
 * is consumed. refreshNonce() at the next cycle start self-heals any gap.
 */
export async function sendWithGasBump(req: SendRequest, label: string): Promise<`0x${string}`> {
  const txNonce = nonce;
  nonce++;

  let caps = baseGasCaps();
  let hash = await broadcast(req, txNonce, caps, label);

  try {
    await publicClient.waitForTransactionReceipt({ hash, timeout: CONFIG.gas.txWaitMs });
  } catch {
    // Timed out — likely stuck. Rebroadcast at the same nonce with higher gas.
    caps = bumpGasCaps(caps, CONFIG.gas.gasBumpPct);
    console.warn(
      `[send] tx ${hash} not confirmed in ${CONFIG.gas.txWaitMs}ms — resending nonce ${txNonce} ` +
        `with +${CONFIG.gas.gasBumpPct}% gas`,
    );
    hash = await broadcast(req, txNonce, caps, label);
    await publicClient.waitForTransactionReceipt({ hash, timeout: CONFIG.gas.txWaitMs });
  }

  console.log(`[send] ${label} confirmed — ${explorerTx(hash)}`);
  return hash;
}
