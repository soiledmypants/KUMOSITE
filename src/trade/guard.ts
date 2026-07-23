// signer guard: the hot wallet only ever signs calldata kumo built itself,
// addressed to a fixed allowlist. nothing from /agent/inbox or /chat can reach this.
import type { Address } from "viem";
import { CONFIG } from "../config.js";
import { publicClient } from "../clients.js";
import { requireWallet } from "../clients.js";
import { withRetry } from "../rpc.js";
import { allStocks } from "../scanner/discovery.js";

export interface KumoTx {
  to: Address;
  data: `0x${string}`;
  value: bigint;
  builtBy: "kumo";
  label: string;
}

export function brandTx(tx: Omit<KumoTx, "builtBy">): KumoTx {
  return { ...tx, builtBy: "kumo" };
}

function allowlist(): Set<string> {
  const set = new Set<string>([
    CONFIG.swapRouter02.toLowerCase(),
    CONFIG.weth.toLowerCase(),
    CONFIG.usdg.toLowerCase(),
    CONFIG.erc8004Registry.toLowerCase(),
  ]);
  for (const t of CONFIG.stockTokens) set.add(t.address.toLowerCase());
  for (const s of allStocks()) set.add(s.address.toLowerCase()); // discovered stocks: approve/swap targets
  if (CONFIG.kumoToken) set.add(CONFIG.kumoToken.toLowerCase());
  if (CONFIG.stakingAddress) set.add(CONFIG.stakingAddress.toLowerCase());
  return set;
}

let nonceCursor: number | null = null;

export async function sendGuardedTx(tx: KumoTx): Promise<`0x${string}`> {
  if (tx.builtBy !== "kumo") throw new Error("refusing to sign externally-built calldata");
  if (!allowlist().has(tx.to.toLowerCase())) {
    throw new Error(`refusing to sign tx to non-allowlisted address ${tx.to}`);
  }
  const { account, walletClient } = requireWallet();

  if (nonceCursor === null) {
    nonceCursor = await withRetry(
      () => publicClient.getTransactionCount({ address: account.address, blockTag: "pending" }),
      "getTransactionCount",
    );
  }
  const nonce = nonceCursor++;

  const fees = await withRetry(() => publicClient.estimateFeesPerGas(), "estimateFeesPerGas");
  let maxFeePerGas = fees.maxFeePerGas;
  let maxPriorityFeePerGas = fees.maxPriorityFeePerGas;

  const send = () =>
    withRetry(
      () =>
        walletClient.sendTransaction({
          to: tx.to,
          data: tx.data,
          value: tx.value,
          nonce,
          maxFeePerGas,
          maxPriorityFeePerGas,
        }),
      `send.${tx.label}`,
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
      // stuck: rebroadcast same nonce with bumped gas
      const bump = (v: bigint) => (v * BigInt(100 + CONFIG.gasBumpPct)) / 100n;
      maxFeePerGas = bump(maxFeePerGas);
      maxPriorityFeePerGas = bump(maxPriorityFeePerGas);
      hash = await send();
    }
  }
}

export function resetNonceCursor(): void {
  nonceCursor = null;
}
