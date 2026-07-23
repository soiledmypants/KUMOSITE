// quoting via QuoterV2 (revert-based, so simulateContract) — single hop across fee
// tiers plus two-hop via USDG/WETH; picks the best route. memedex swap.ts pattern.
import { encodePacked, parseAbi, type Address } from "viem";
import { CONFIG } from "../config.js";
import { publicClient } from "../clients.js";
import { withRetry } from "../rpc.js";

export const quoterAbi = parseAbi([
  "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
  "function quoteExactInput(bytes path, uint256 amountIn) returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)",
]);

export interface Quote {
  route: "single" | "two-hop-usdg" | "two-hop-weth";
  fee?: number;
  path?: `0x${string}`;
  amountIn: bigint;
  amountOut: bigint;
  minOut: bigint;
  impactPct: number;
}

export function applySlippage(quoted: bigint, slippagePct = CONFIG.slippagePct): bigint {
  return (quoted * BigInt(10_000 - Math.round(slippagePct * 100))) / 10_000n;
}

export function resolveToken(sym: string): Address {
  const s = sym.trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(s)) return s as Address;
  const upper = s.toUpperCase();
  if (upper === "ETH" || upper === "WETH") return CONFIG.weth;
  if (upper === "USDG") return CONFIG.usdg;
  const stock = CONFIG.stockTokens.find((t) => t.symbol === upper);
  if (stock) return stock.address;
  throw new Error(`unknown token: ${sym}`);
}

async function quoteSingle(tokenIn: Address, tokenOut: Address, amountIn: bigint, fee: number): Promise<bigint | null> {
  try {
    const { result } = await withRetry(
      () =>
        publicClient.simulateContract({
          address: CONFIG.quoterV2,
          abi: quoterAbi,
          functionName: "quoteExactInputSingle",
          args: [{ tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0n }],
        }),
      "quoteSingle",
      { retries: 1 },
    );
    return result[0];
  } catch {
    return null;
  }
}

export function encodePath(hops: { token: Address; fee?: number }[]): `0x${string}` {
  // token,fee,token,fee,token
  const types: string[] = [];
  const values: unknown[] = [];
  hops.forEach((h, i) => {
    types.push("address");
    values.push(h.token);
    if (i < hops.length - 1) {
      types.push("uint24");
      values.push(h.fee ?? 3000);
    }
  });
  return encodePacked(types as never, values as never);
}

async function quotePath(path: `0x${string}`, amountIn: bigint): Promise<bigint | null> {
  try {
    const { result } = await withRetry(
      () =>
        publicClient.simulateContract({
          address: CONFIG.quoterV2,
          abi: quoterAbi,
          functionName: "quoteExactInput",
          args: [path, amountIn],
        }),
      "quotePath",
      { retries: 1 },
    );
    return result[0];
  } catch {
    return null;
  }
}

export async function bestQuote(tokenIn: Address, tokenOut: Address, amountIn: bigint): Promise<Quote | null> {
  const candidates: Quote[] = [];

  for (const fee of CONFIG.defaultFeeTiers) {
    const out = await quoteSingle(tokenIn, tokenOut, amountIn, fee);
    if (out && out > 0n) {
      candidates.push({ route: "single", fee, amountIn, amountOut: out, minOut: applySlippage(out), impactPct: 0 });
    }
  }

  const viaUsdg =
    tokenIn.toLowerCase() !== CONFIG.usdg.toLowerCase() && tokenOut.toLowerCase() !== CONFIG.usdg.toLowerCase();
  if (viaUsdg) {
    const inFee = tokenIn.toLowerCase() === CONFIG.weth.toLowerCase() ? CONFIG.wethUsdgFeeTier : 3000;
    const path = encodePath([
      { token: tokenIn, fee: inFee },
      { token: CONFIG.usdg, fee: CONFIG.usdgStockFeeTier },
      { token: tokenOut },
    ]);
    const out = await quotePath(path, amountIn);
    if (out && out > 0n) {
      candidates.push({ route: "two-hop-usdg", path, amountIn, amountOut: out, minOut: applySlippage(out), impactPct: 0 });
    }
  }

  const viaWeth =
    tokenIn.toLowerCase() !== CONFIG.weth.toLowerCase() && tokenOut.toLowerCase() !== CONFIG.weth.toLowerCase();
  if (viaWeth) {
    const path = encodePath([
      { token: tokenIn, fee: 3000 },
      { token: CONFIG.weth, fee: 3000 },
      { token: tokenOut },
    ]);
    const out = await quotePath(path, amountIn);
    if (out && out > 0n) {
      candidates.push({ route: "two-hop-weth", path, amountIn, amountOut: out, minOut: applySlippage(out), impactPct: 0 });
    }
  }

  if (candidates.length === 0) return null;
  const best = candidates.sort((a, b) => (b.amountOut > a.amountOut ? 1 : -1))[0];

  // impact: implied price at 1% size vs full size
  const probeIn = amountIn / 100n > 0n ? amountIn / 100n : amountIn;
  const probeOut =
    best.route === "single"
      ? await quoteSingle(tokenIn, tokenOut, probeIn, best.fee!)
      : await quotePath(best.path!, probeIn);
  if (probeOut && probeOut > 0n && probeIn !== amountIn) {
    const full = Number(best.amountOut) / Number(amountIn);
    const probe = Number(probeOut) / Number(probeIn);
    best.impactPct = Math.max(0, (1 - full / probe) * 100);
  }
  return best;
}
