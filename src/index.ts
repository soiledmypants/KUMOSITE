import "dotenv/config";
import { formatEther } from "viem";
import { CONFIG, explorerTx } from "./config.js";
import { botAddress } from "./clients.js";
import {
  claim,
  readClaimable,
  refreshRecipient,
  resolveLockerContext,
  type LockerContext,
} from "./locker.js";
import { forwardEth, forwardToken, unwrapWeth } from "./forward.js";
import { initAllowlist, refreshNonce } from "./send.js";
import * as txlog from "./txlog.js";
import { startServer } from "./server.js";

function logStepError(step: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[${step}] ERROR: ${message}`);
  try {
    txlog.append({ type: "error", detail: `${step}: ${message}` });
  } catch {
    // Journal write failed — already logged to console, never crash the loop.
  }
}

/** One full pass: claim -> unwrap -> forward ETH -> forward token. Never throws. */
async function cycle(ctx: LockerContext): Promise<void> {
  console.log(`\n[cycle] ===== ${new Date().toISOString()}${CONFIG.dryRun ? " (DRY RUN)" : ""} =====`);
  txlog.markCycle();
  try {
    // ---- 0. Recipient guard — feeRedirects can change under us at any time.
    let recipientOk = false;
    try {
      await refreshRecipient(ctx);
      recipientOk = ctx.recipient.toLowerCase() === botAddress.toLowerCase();
      if (!recipientOk) {
        const msg =
          `on-chain fee recipient is ${ctx.recipient}, not the bot wallet ${botAddress} — ` +
          `claimed funds would NOT land here`;
        if (CONFIG.dryRun) console.warn(`[cycle] WARNING: ${msg}`);
        else logStepError("recipient", new Error(msg));
      }
    } catch (err) {
      logStepError("recipient", err);
      return;
    }

    if (!CONFIG.dryRun) {
      try {
        await refreshNonce();
      } catch (err) {
        logStepError("nonce", err);
        return;
      }
    }

    // ---- 1. CLAIM ---------------------------------------------------------
    let plannedClaimWethWei = 0n; // DRY_RUN bookkeeping for the forward plan
    try {
      const c = await readClaimable(ctx);
      if (c.netWethWei >= CONFIG.claimMinWei) {
        if (CONFIG.dryRun) {
          console.log(
            `[claim] DRY RUN: would send collectFees(${CONFIG.tokenAddress}) to locker ${ctx.locker}`,
          );
          txlog.append({
            type: "claim",
            token: CONFIG.tokenAddress,
            grossWeth: c.grossWethWei.toString(),
            netWeth: c.netWethWei.toString(),
            grossToken: c.grossTokenRaw.toString(),
            netToken: c.netTokenRaw.toString(),
            detail: "planned",
          });
          plannedClaimWethWei = c.netWethWei;
        } else if (!recipientOk) {
          console.warn("[claim] skipping claim — recipient mismatch (see error above)");
        } else {
          const hash = await claim(ctx);
          txlog.append({
            type: "claim",
            token: CONFIG.tokenAddress,
            grossWeth: c.grossWethWei.toString(),
            netWeth: c.netWethWei.toString(),
            grossToken: c.grossTokenRaw.toString(),
            netToken: c.netTokenRaw.toString(),
            txHash: hash,
          });
          console.log(
            `[claim] claimed ~${formatEther(c.netWethWei)} WETH net + ${c.netTokenRaw} token units — ${explorerTx(hash)}`,
          );
        }
      } else {
        console.log(
          `[claim] net claimable below CLAIM_MIN_ETH (${formatEther(CONFIG.claimMinWei)}) — not claiming`,
        );
      }
    } catch (err) {
      logStepError("claim", err);
    }

    // ---- 2. UNWRAP whole WETH balance (self-heals leftovers) ---------------
    let plannedUnwrapWei = 0n;
    try {
      plannedUnwrapWei = await unwrapWeth();
    } catch (err) {
      logStepError("unwrap", err);
    }

    // ---- 3. FORWARD ETH (treasury/kumo split) ------------------------------
    try {
      const plannedIncoming = CONFIG.dryRun ? plannedClaimWethWei + plannedUnwrapWei : 0n;
      await forwardEth(plannedIncoming);
    } catch (err) {
      logStepError("forward_eth", err);
    }

    // ---- 4. FORWARD TOKEN --------------------------------------------------
    try {
      await forwardToken();
    } catch (err) {
      logStepError("forward_token", err);
    }

    console.log("[cycle] complete");
  } catch (err) {
    // Absolute backstop: the loop must never crash.
    logStepError("cycle", err);
  }
}

async function main(): Promise<void> {
  console.log("[boot] pons fee-claimer starting");
  console.log(`[boot] bot address: ${botAddress}`);
  console.log(`[boot] chain ${CONFIG.chainId} @ ${CONFIG.rpcUrl}`);
  console.log(`[boot] mode: ${CONFIG.dryRun ? "DRY RUN — no txs will be sent" : "LIVE"}`);
  console.log(`[boot] token: ${CONFIG.tokenAddress}`);
  console.log(
    `[boot] ETH routing: ${CONFIG.treasuryPct}% -> treasury ${CONFIG.treasuryWallet}, ` +
      `${100 - CONFIG.treasuryPct}% -> kumo ${CONFIG.kumoWallet ?? "(unset)"}`,
  );
  console.log(`[boot] cycle every ${CONFIG.intervalMinutes} min`);

  const ctx = await resolveLockerContext();

  const recipientOk = ctx.recipient.toLowerCase() === botAddress.toLowerCase();
  if (!recipientOk) {
    if (CONFIG.dryRun) {
      console.warn(
        `[boot] WARNING: fee recipient is ${ctx.recipient}, not this wallet (${botAddress}). ` +
          `Fine for DRY_RUN reads, but live mode will refuse to start.`,
      );
    } else {
      console.error(
        `[boot] REFUSING TO START: collectFees pays ${ctx.recipient}, but PRIVATE_KEY derives ${botAddress}.\n` +
          `  Claimed funds would land in a wallet this bot does not control. Fix one of:\n` +
          `    1) run the bot with the recipient wallet's private key, or\n` +
          `    2) call setFeeRedirect(${CONFIG.tokenAddress}, ${botAddress}) on locker ${ctx.locker}\n` +
          `       from the deployer/current recipient wallet.`,
      );
      process.exit(1);
    }
  }

  // The ONLY tx targets this bot will ever sign for.
  initAllowlist([
    ctx.locker,
    CONFIG.weth,
    CONFIG.tokenAddress,
    CONFIG.treasuryWallet,
    ...(CONFIG.kumoWallet ? [CONFIG.kumoWallet] : []),
  ]);

  startServer(ctx);

  // Run immediately, then on an interval. cycle() never throws.
  void cycle(ctx);
  setInterval(() => void cycle(ctx), CONFIG.intervalMinutes * 60_000);
}

main().catch((err) => {
  console.error(`[boot] fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
