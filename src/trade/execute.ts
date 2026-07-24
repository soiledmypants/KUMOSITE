// flag-gated trade execution. v1 supports native-ETH-in swaps (ETH -> token) via
// SwapRouter02 multicall, the same shape as memedex swap.ts. token->token quoting
// works everywhere; execution of non-ETH input is deliberately out of scope for v1.
import { encodeFunctionData, formatEther, parseAbi, parseEther, type Address } from "viem";
import { CONFIG } from "../config.js";
import { db, getMeta, setMeta } from "../db.js";
import { lines, say } from "../voice.js";
import { bestQuote, type Quote } from "./quote.js";
import { brandTx, sendGuardedTx } from "./guard.js";
import { stockByAddress } from "../scanner/discovery.js";
import { emitKumoEvent } from "../twitter/events.js";

export const routerAbi = parseAbi([
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
  "function exactInput((bytes path, address recipient, uint256 amountIn, uint256 amountOutMinimum) params) payable returns (uint256 amountOut)",
  "function multicall(uint256 deadline, bytes[] data) payable returns (bytes[] results)",
]);

async function dailySpent(): Promise<number> {
  const key = `trade_day:${new Date().toISOString().slice(0, 10)}`;
  return Number((await getMeta(key)) ?? "0");
}

async function addDailySpent(eth: number): Promise<void> {
  const key = `trade_day:${new Date().toISOString().slice(0, 10)}`;
  await setMeta(key, String((await dailySpent()) + eth));
}

export interface ExecuteResult {
  tx: `0x${string}`;
  amountIn: string;
  minOut: string;
  route: Quote["route"];
}

export async function executeEthSwap(opts: {
  tokenOut: Address;
  amountEth: number;
  recipient: Address;
  maxSlippagePct?: number;
}): Promise<ExecuteResult> {
  if (!CONFIG.tradingEnabled) throw new Error("trading is disabled (TRADING_ENABLED=false)");
  if (opts.amountEth <= 0) throw new Error("amount must be positive");
  if (opts.amountEth > CONFIG.tradeMaxEth) {
    throw new Error(`amount exceeds per-trade cap of ${CONFIG.tradeMaxEth} ETH`);
  }
  const spent = await dailySpent();
  if (spent + opts.amountEth > CONFIG.tradeDailyMaxEth) {
    throw new Error(`daily trade cap reached (${spent.toFixed(4)}/${CONFIG.tradeDailyMaxEth} ETH)`);
  }

  const amountIn = parseEther(opts.amountEth.toString());
  const quote = await bestQuote(CONFIG.weth, opts.tokenOut, amountIn);
  if (!quote) throw new Error("no route found");
  if (quote.impactPct > CONFIG.maxImpactPct) {
    throw new Error(`price impact too high (${quote.impactPct.toFixed(2)}%)`);
  }
  const slippage = opts.maxSlippagePct ?? CONFIG.slippagePct;
  const minOut = (quote.amountOut * BigInt(10_000 - Math.round(slippage * 100))) / 10_000n;

  const inner =
    quote.route === "single"
      ? encodeFunctionData({
          abi: routerAbi,
          functionName: "exactInputSingle",
          args: [
            {
              tokenIn: CONFIG.weth,
              tokenOut: opts.tokenOut,
              fee: quote.fee!,
              recipient: opts.recipient,
              amountIn,
              amountOutMinimum: minOut,
              sqrtPriceLimitX96: 0n,
            },
          ],
        })
      : encodeFunctionData({
          abi: routerAbi,
          functionName: "exactInput",
          args: [{ path: quote.path!, recipient: opts.recipient, amountIn, amountOutMinimum: minOut }],
        });

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
  const data = encodeFunctionData({ abi: routerAbi, functionName: "multicall", args: [deadline, [inner]] });

  say("trade", lines.foundTrade());
  const tx = await sendGuardedTx(
    brandTx({ to: CONFIG.swapRouter02, data, value: amountIn, label: "swap" }),
  );
  await addDailySpent(opts.amountEth);
  await db.run(
    "INSERT INTO trades (ts, token_in, token_out, amount_in, amount_out, tx_hash) VALUES (?, ?, ?, ?, ?, ?)",
    [Date.now(), "ETH", opts.tokenOut.toLowerCase(), amountIn.toString(), minOut.toString(), tx],
  );
  say("trade", lines.tradeDone(`${formatEther(amountIn)} eth in, route ${quote.route}.`));
  const outSymbol =
    stockByAddress(opts.tokenOut)?.symbol ??
    (await db.get<{ symbol: string }>("SELECT symbol FROM tokens WHERE address = ?", [opts.tokenOut.toLowerCase()]))?.symbol;
  if (outSymbol && outSymbol !== "???") {
    emitKumoEvent({ type: "trade_found", symbol: outSymbol });
  }
  return { tx, amountIn: amountIn.toString(), minOut: minOut.toString(), route: quote.route };
}
