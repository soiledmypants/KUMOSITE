import { formatEther, parseAbi } from "viem";
import { CONFIG, explorerTx } from "./config.js";
import { publicClient, botAddress } from "./clients.js";
import { withRetry } from "./rpc.js";
import { sendWithGasBump } from "./send.js";
import * as txlog from "./txlog.js";

const WETH_ABI = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function withdraw(uint256 wad)",
]);

const ERC20_ABI = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
]);

/**
 * Unwrap the wallet's ENTIRE WETH balance to native ETH — not just this
 * cycle's claim, so leftovers from crashed/partial runs self-heal.
 * @returns the amount unwrapped (or planned, in DRY_RUN).
 */
export async function unwrapWeth(): Promise<bigint> {
  const bal = await withRetry(
    () =>
      publicClient.readContract({
        address: CONFIG.weth,
        abi: WETH_ABI,
        functionName: "balanceOf",
        args: [botAddress],
      }),
    "forward.wethBalance",
  );

  if (bal === 0n) {
    console.log("[unwrap] no WETH balance — nothing to unwrap");
    return 0n;
  }

  if (CONFIG.dryRun) {
    console.log(`[unwrap] DRY RUN: would unwrap ${formatEther(bal)} WETH -> ETH`);
    txlog.append({ type: "unwrap", amount: bal.toString(), detail: "planned" });
    return bal;
  }

  const hash = await sendWithGasBump(
    { kind: "contract", to: CONFIG.weth, abi: WETH_ABI, functionName: "withdraw", args: [bal] },
    "forward.unwrap",
  );
  txlog.append({ type: "unwrap", amount: bal.toString(), txHash: hash });
  console.log(`[unwrap] unwrapped ${formatEther(bal)} WETH — ${explorerTx(hash)}`);
  return bal;
}

/**
 * Forward native ETH: (balance − GAS_RESERVE_ETH), capped at MAX_FORWARD_ETH,
 * split TREASURY_PCT% to treasury and the remainder (incl. division dust) to
 * kumo. `plannedIncomingWei` lets DRY_RUN plan as if the claim+unwrap that
 * were only logged had actually landed.
 */
export async function forwardEth(plannedIncomingWei = 0n): Promise<void> {
  const ethBal = await withRetry(
    () => publicClient.getBalance({ address: botAddress }),
    "forward.getBalance",
  );
  const basis = ethBal + plannedIncomingWei;

  let forwardable = basis - CONFIG.gasReserveWei;
  if (forwardable <= 0n) {
    console.log(
      `[forward] balance ${formatEther(basis)} ETH <= gas reserve ` +
        `${formatEther(CONFIG.gasReserveWei)} — nothing to forward`,
    );
    return;
  }
  if (forwardable > CONFIG.maxForwardWei) {
    console.log(
      `[forward] capping forward at MAX_FORWARD_ETH ${formatEther(CONFIG.maxForwardWei)} ` +
        `(${formatEther(forwardable)} available — excess waits for next cycle)`,
    );
    forwardable = CONFIG.maxForwardWei;
  }
  if (forwardable < CONFIG.forwardMinWei) {
    console.log(
      `[forward] ${formatEther(forwardable)} ETH is below FORWARD_MIN_ETH ` +
        `${formatEther(CONFIG.forwardMinWei)} — skipping dust forward`,
    );
    return;
  }

  const treasuryWei = (forwardable * BigInt(CONFIG.treasuryPct)) / 100n;
  const kumoWei = forwardable - treasuryWei;

  const legs: Array<{ role: "treasury" | "kumo"; to: `0x${string}`; amount: bigint }> = [];
  if (treasuryWei > 0n) legs.push({ role: "treasury", to: CONFIG.treasuryWallet, amount: treasuryWei });
  if (kumoWei > 0n && CONFIG.kumoWallet) legs.push({ role: "kumo", to: CONFIG.kumoWallet, amount: kumoWei });

  for (const leg of legs) {
    if (CONFIG.dryRun) {
      console.log(
        `[forward] DRY RUN: would send ${formatEther(leg.amount)} ETH -> ${leg.role} ${leg.to}`,
      );
      txlog.append({
        type: "forward_eth",
        amount: leg.amount.toString(),
        to: leg.to,
        role: leg.role,
        detail: "planned",
      });
      continue;
    }
    const hash = await sendWithGasBump(
      { kind: "native", to: leg.to, value: leg.amount },
      `forward.eth.${leg.role}`,
    );
    txlog.append({ type: "forward_eth", amount: leg.amount.toString(), to: leg.to, role: leg.role, txHash: hash });
    console.log(`[forward] ${formatEther(leg.amount)} ETH -> ${leg.role} — ${explorerTx(hash)}`);
  }
}

/** Forward the wallet's entire launched-token balance to the treasury as a plain ERC20 transfer. */
export async function forwardToken(): Promise<void> {
  const bal = await withRetry(
    () =>
      publicClient.readContract({
        address: CONFIG.tokenAddress,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [botAddress],
      }),
    "forward.tokenBalance",
  );

  if (bal === 0n) {
    console.log("[forward] no token balance — nothing to forward");
    return;
  }

  if (CONFIG.dryRun) {
    console.log(`[forward] DRY RUN: would transfer ${bal} token units -> treasury ${CONFIG.treasuryWallet}`);
    txlog.append({
      type: "forward_token",
      token: CONFIG.tokenAddress,
      amount: bal.toString(),
      to: CONFIG.treasuryWallet,
      detail: "planned",
    });
    return;
  }

  const hash = await sendWithGasBump(
    {
      kind: "contract",
      to: CONFIG.tokenAddress,
      abi: ERC20_ABI,
      functionName: "transfer",
      args: [CONFIG.treasuryWallet, bal],
    },
    "forward.token",
  );
  txlog.append({
    type: "forward_token",
    token: CONFIG.tokenAddress,
    amount: bal.toString(),
    to: CONFIG.treasuryWallet,
    txHash: hash,
  });
  console.log(`[forward] ${bal} token units -> treasury — ${explorerTx(hash)}`);
}
