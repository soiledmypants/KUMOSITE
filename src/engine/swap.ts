import { encodeFunctionData, formatEther, parseAbi } from "viem";
import { withRetry } from "../rpc.js";
import type { ProjectRuntime } from "../projects.js";
import * as journal from "./journal.js";

/**
 * Uniswap v3 single-hop swaps via SwapRouter02 (memedex swap.ts pattern,
 * WETH-paired path only — pons tokens are always WETH-quoted).
 *
 * - Quotes come from QuoterV2 via simulateContract (quote fns are revert-based).
 * - Buys send native ETH via `value:`; the router wraps to WETH internally.
 * - Sells approve the router, swap token->WETH to the router itself
 *   (ADDRESS_THIS), then unwrapWETH9 to the wallet — all in one multicall.
 */

const SWAP_ROUTER_02_ABI = parseAbi([
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
  "function multicall(uint256 deadline, bytes[] data) payable returns (bytes[] results)",
  "function unwrapWETH9(uint256 amountMinimum, address recipient) payable",
]);

const QUOTER_V2_ABI = parseAbi([
  "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
]);

const ERC20_ABI = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
]);

/** SwapRouter02's ADDRESS_THIS sentinel — swap output held by the router for unwrapWETH9. */
const ADDRESS_THIS = "0x0000000000000000000000000000000000000002" as const;

export interface SwapQuote {
  quotedOut: bigint;
  amountOutMinimum: bigint;
}

export interface SwapResult extends SwapQuote {
  txHash?: `0x${string}`;
}

/** 20-minute swap deadline as unix-seconds bigint. */
function deadline(): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + 20 * 60);
}

/** Apply slippage (percent, supports fractions) to a quoted output. */
function applySlippage(quotedOut: bigint, slippagePct: number): bigint {
  if (quotedOut <= 0n) return 0n;
  const bps = BigInt(10_000 - Math.round(slippagePct * 100));
  return (quotedOut * bps) / 10_000n;
}

async function quote(
  p: ProjectRuntime,
  tokenIn: `0x${string}`,
  tokenOut: `0x${string}`,
  amountIn: bigint,
  label: string,
): Promise<SwapQuote> {
  const { result } = await withRetry(
    () =>
      p.publicClient.simulateContract({
        address: p.swap.quoter,
        abi: QUOTER_V2_ABI,
        functionName: "quoteExactInputSingle",
        args: [{ tokenIn, tokenOut, amountIn, fee: p.swap.feeTier, sqrtPriceLimitX96: 0n }],
        account: p.botAddress,
      }),
    label,
  );
  const quotedOut = result[0];
  return { quotedOut, amountOutMinimum: applySlippage(quotedOut, p.swap.slippagePct) };
}

/** Quote ETH -> token (buyback direction). */
export function quoteBuy(p: ProjectRuntime, ethWei: bigint): Promise<SwapQuote> {
  return quote(p, p.weth, p.tokenAddress, ethWei, `swap:${p.id}.quoteBuy`);
}

/** Quote token -> ETH. */
export function quoteSell(p: ProjectRuntime, tokenAmount: bigint): Promise<SwapQuote> {
  return quote(p, p.tokenAddress, p.weth, tokenAmount, `swap:${p.id}.quoteSell`);
}

/** Swap native ETH -> project token. */
export async function buyToken(
  p: ProjectRuntime,
  ethWei: bigint,
  opts: { dryRun: boolean; roundId?: string },
): Promise<SwapResult> {
  const q = await quoteBuy(p, ethWei);

  if (opts.dryRun) {
    console.log(
      `[swap:${p.id}] DRY RUN: would swap ${formatEther(ethWei)} ETH -> ~${q.quotedOut} token units ` +
        `(min ${q.amountOutMinimum})`,
    );
    journal.append({
      type: "swap",
      dryRun: true,
      projectId: p.id,
      roundId: opts.roundId,
      token: p.tokenAddress,
      amount: ethWei.toString(),
      amountOut: q.quotedOut.toString(),
      detail: "planned buy",
    });
    return q;
  }

  const inner = encodeFunctionData({
    abi: SWAP_ROUTER_02_ABI,
    functionName: "exactInputSingle",
    args: [
      {
        tokenIn: p.weth,
        tokenOut: p.tokenAddress,
        fee: p.swap.feeTier,
        recipient: p.botAddress,
        amountIn: ethWei,
        amountOutMinimum: q.amountOutMinimum,
        sqrtPriceLimitX96: 0n,
      },
    ],
  });

  const txHash = await p.sender.sendWithGasBump(
    {
      kind: "contract",
      to: p.swap.router,
      abi: SWAP_ROUTER_02_ABI,
      functionName: "multicall",
      args: [deadline(), [inner]],
      value: ethWei, // native ETH -> WETH handled by the router
    },
    `swap:${p.id}.buy`,
  );

  journal.append({
    type: "swap",
    dryRun: false,
    projectId: p.id,
    roundId: opts.roundId,
    token: p.tokenAddress,
    amount: ethWei.toString(),
    amountOut: q.quotedOut.toString(),
    txHash,
    detail: "buy",
  });
  return { ...q, txHash };
}

/** Swap project token -> native ETH (approve if needed, swap to router, unwrap). */
export async function sellToken(
  p: ProjectRuntime,
  tokenAmount: bigint,
  opts: { dryRun: boolean; roundId?: string },
): Promise<SwapResult> {
  const q = await quoteSell(p, tokenAmount);

  if (opts.dryRun) {
    console.log(
      `[swap:${p.id}] DRY RUN: would swap ${tokenAmount} token units -> ~${formatEther(q.quotedOut)} ETH`,
    );
    journal.append({
      type: "swap",
      dryRun: true,
      projectId: p.id,
      roundId: opts.roundId,
      token: p.tokenAddress,
      amount: tokenAmount.toString(),
      amountOut: q.quotedOut.toString(),
      detail: "planned sell",
    });
    return q;
  }

  const allowance = await withRetry(
    () =>
      p.publicClient.readContract({
        address: p.tokenAddress,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [p.botAddress, p.swap.router],
      }),
    `swap:${p.id}.allowance`,
  );
  if (allowance < tokenAmount) {
    await p.sender.sendWithGasBump(
      {
        kind: "contract",
        to: p.tokenAddress,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [p.swap.router, tokenAmount],
      },
      `swap:${p.id}.approve`,
    );
  }

  const swapCall = encodeFunctionData({
    abi: SWAP_ROUTER_02_ABI,
    functionName: "exactInputSingle",
    args: [
      {
        tokenIn: p.tokenAddress,
        tokenOut: p.weth,
        fee: p.swap.feeTier,
        recipient: ADDRESS_THIS, // WETH stays in the router for the unwrap step
        amountIn: tokenAmount,
        amountOutMinimum: q.amountOutMinimum,
        sqrtPriceLimitX96: 0n,
      },
    ],
  });
  const unwrapCall = encodeFunctionData({
    abi: SWAP_ROUTER_02_ABI,
    functionName: "unwrapWETH9",
    args: [q.amountOutMinimum, p.botAddress],
  });

  const txHash = await p.sender.sendWithGasBump(
    {
      kind: "contract",
      to: p.swap.router,
      abi: SWAP_ROUTER_02_ABI,
      functionName: "multicall",
      args: [deadline(), [swapCall, unwrapCall]],
    },
    `swap:${p.id}.sell`,
  );

  journal.append({
    type: "swap",
    dryRun: false,
    projectId: p.id,
    roundId: opts.roundId,
    token: p.tokenAddress,
    amount: tokenAmount.toString(),
    amountOut: q.quotedOut.toString(),
    txHash,
    detail: "sell",
  });
  return { ...q, txHash };
}
