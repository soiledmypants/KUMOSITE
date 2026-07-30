import type { Abi, Account, Chain, PublicClient, Transport, WalletClient } from "viem";
import { CONFIG, baseGasCaps, bumpGasCaps } from "./config.js";
import { withRetry } from "./rpc.js";

type GasCaps = { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint };

export type PC = PublicClient<Transport, Chain>;
export type WC = WalletClient<Transport, Chain, Account>;

/** A contract write (ERC20 transfer, WETH withdraw, collectFees, router multicall…). */
export interface ContractSend {
  kind: "contract";
  to: `0x${string}`;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
  /** Native ETH attached to a payable call (router swaps). */
  value?: bigint;
}

/** A plain native-ETH transfer. */
export interface NativeSend {
  kind: "native";
  to: `0x${string}`;
  value: bigint;
}

export type SendRequest = ContractSend | NativeSend;

export interface SenderDeps {
  projectId: string;
  publicClient: PC;
  walletClient: WC;
  botAddress: `0x${string}`;
  explorerTx: (hash: string) => string;
}

/**
 * Per-project transaction sender.
 *
 * - Allowlist: the ONLY addresses this sender will ever sign a tx to. Static
 *   targets are registered at boot (`allow`); airdrop recipients are added
 *   ONLY for the duration of an executing round via `withExtraAllowed`.
 * - Nonce: fetched once per cycle/round (`refreshNonce`), incremented locally
 *   per broadcast (memedex distribute.ts convention).
 * - Gas bump: on receipt timeout, the SAME nonce is rebroadcast with caps
 *   bumped by gas.gasBumpPct.
 */
export interface Sender {
  allow(target: `0x${string}`): void;
  isAllowed(target: `0x${string}`): boolean;
  allowedTargets(): string[];
  refreshNonce(): Promise<void>;
  sendWithGasBump(req: SendRequest, label: string): Promise<`0x${string}`>;
  withExtraAllowed<T>(targets: `0x${string}`[], fn: () => Promise<T>): Promise<T>;
}

export function makeSender(deps: SenderDeps): Sender {
  const { projectId, publicClient, walletClient, botAddress, explorerTx } = deps;

  const allowed = new Set<string>();
  const extraAllowed = new Set<string>();
  let nonce = 0;

  function assertAllowedTarget(to: `0x${string}`): void {
    const key = to.toLowerCase();
    if (!allowed.has(key) && !extraAllowed.has(key)) {
      throw new Error(
        `[send:${projectId}] BLOCKED: ${to} is not on the send allowlist — refusing to sign`,
      );
    }
  }

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
        value: req.value,
        account: walletClient.account,
        chain: walletClient.chain,
        nonce: txNonce,
        maxFeePerGas: caps.maxFeePerGas,
        maxPriorityFeePerGas: caps.maxPriorityFeePerGas,
      });
    }, `${label}[nonce=${txNonce}]`);
  }

  return {
    allow(target) {
      allowed.add(target.toLowerCase());
    },

    isAllowed(target) {
      return allowed.has(target.toLowerCase()) || extraAllowed.has(target.toLowerCase());
    },

    allowedTargets() {
      return [...allowed];
    },

    async refreshNonce() {
      nonce = await withRetry(
        () => publicClient.getTransactionCount({ address: botAddress, blockTag: "pending" }),
        `send:${projectId}.getTransactionCount`,
      );
    },

    /**
     * Broadcast, wait for receipt, and on timeout rebroadcast the SAME nonce
     * with bumped gas. The local nonce advances even if this throws: by the
     * time an error can surface the tx was (in all likelihood) broadcast, so
     * the nonce is consumed; refreshNonce() self-heals any gap next cycle.
     */
    async sendWithGasBump(req, label) {
      const txNonce = nonce;
      nonce++;

      let caps = baseGasCaps();
      let hash = await broadcast(req, txNonce, caps, label);

      try {
        await publicClient.waitForTransactionReceipt({ hash, timeout: CONFIG.gas.txWaitMs });
      } catch {
        caps = bumpGasCaps(caps, CONFIG.gas.gasBumpPct);
        console.warn(
          `[send:${projectId}] tx ${hash} not confirmed in ${CONFIG.gas.txWaitMs}ms — resending ` +
            `nonce ${txNonce} with +${CONFIG.gas.gasBumpPct}% gas`,
        );
        hash = await broadcast(req, txNonce, caps, label);
        await publicClient.waitForTransactionReceipt({ hash, timeout: CONFIG.gas.txWaitMs });
      }

      console.log(`[send:${projectId}] ${label} confirmed — ${explorerTx(hash)}`);
      return hash;
    },

    /** Temporarily allow `targets` (an executing round's recipient set) while `fn` runs. */
    async withExtraAllowed(targets, fn) {
      for (const t of targets) extraAllowed.add(t.toLowerCase());
      try {
        return await fn();
      } finally {
        extraAllowed.clear();
      }
    },
  };
}
