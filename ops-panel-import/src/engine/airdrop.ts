import { parseAbi } from "viem";
import type { ProjectRuntime } from "../projects.js";
import * as journal from "./journal.js";
import { emitEvent } from "./events.js";

/**
 * Batch distributor — memedex distribute.ts conventions: manual nonce via the
 * project sender, same-nonce gas-bump on timeout, per-recipient try/catch so
 * one failure never aborts the batch.
 *
 * Recipients MUST already be inside sender.withExtraAllowed() — rounds.ts
 * wraps the whole execution; calling this outside a round throws on the
 * allowlist for every recipient.
 */

const ERC20_ABI = parseAbi(["function transfer(address to, uint256 amount) returns (bool)"]);

export interface AirdropItem {
  recipient: `0x${string}`;
  amountWei: bigint;
}

export interface AirdropOutcome {
  sent: number;
  failed: number;
  totalSentWei: bigint;
  firstTxHash?: `0x${string}`;
}

export async function runAirdrop(
  p: ProjectRuntime,
  asset: "eth" | "token",
  items: AirdropItem[],
  roundId: string,
  dryRun: boolean,
): Promise<AirdropOutcome> {
  const n = items.length;
  const total = items.reduce((acc, i) => acc + i.amountWei, 0n);

  if (dryRun) {
    console.log(`[drop:${p.id}] DRY RUN: would send ${asset} to ${n} recipients (total ${total})`);
    journal.append({
      type: "airdrop",
      dryRun: true,
      projectId: p.id,
      roundId,
      asset,
      amount: total.toString(),
      recipientCount: n,
      detail: "planned",
    });
    return { sent: 0, failed: 0, totalSentWei: 0n };
  }

  const outcome: AirdropOutcome = { sent: 0, failed: 0, totalSentWei: 0n };

  for (let i = 0; i < n; i++) {
    const item = items[i]!;
    try {
      const txHash = await p.sender.sendWithGasBump(
        asset === "eth"
          ? { kind: "native", to: item.recipient, value: item.amountWei }
          : {
              kind: "contract",
              to: p.tokenAddress,
              abi: ERC20_ABI,
              functionName: "transfer",
              args: [item.recipient, item.amountWei],
            },
        `drop:${p.id}[${i + 1}/${n}]`,
      );
      outcome.sent++;
      outcome.totalSentWei += item.amountWei;
      if (!outcome.firstTxHash) outcome.firstTxHash = txHash;
      journal.append({
        type: "airdrop",
        dryRun: false,
        projectId: p.id,
        roundId,
        asset,
        amount: item.amountWei.toString(),
        to: item.recipient,
        txHash,
      });
      emitEvent(
        "airdrop_tx",
        { i: i + 1, n, recipient: item.recipient, amount: item.amountWei.toString(), txHash },
        p.id,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[drop:${p.id}] ${item.recipient} failed: ${message}`);
      outcome.failed++;
      journal.append({
        type: "error",
        projectId: p.id,
        roundId,
        detail: `airdrop ${item.recipient}: ${message}`,
      });
      // Nonce was advanced by the sender (broadcast-before-throw convention);
      // continue with the next recipient.
    }
  }

  console.log(`[drop:${p.id}] ${outcome.sent}/${n} sent, ${outcome.failed} failed`);
  return outcome;
}
