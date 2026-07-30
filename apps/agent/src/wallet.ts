// hot-wallet introspection: one place that answers "which wallet is kumo
// wearing and what's in its pockets?" — feeds the boot line, GET /admin/wallet,
// and scripts/wallet-check.ts. address-only, always: keys never appear here.
import { formatEther, formatUnits, parseAbi, parseEther, type Address } from "viem";
import { CONFIG } from "./config.js";
import { publicClient, botAddress } from "./clients.js";
import { withRetry } from "./rpc.js";
import { allStocks } from "./scanner/discovery.js";

const erc20Abi = parseAbi(["function balanceOf(address) view returns (uint256)"]);

export interface TokenHolding {
  symbol: string;
  address: string;
  balance: string; // whole units
}

export interface WalletSummary {
  address: string;
  is_contract: boolean;
  eth_balance: string;
  gas_reserve_eth: number;
  distributable_eth: string;
  distribute_min_eth: number;
  saving_up: boolean;
  weth_balance: string;
  usdg_balance: string;
  stocks: TokenHolding[]; // nonzero only
}

async function balanceOf(token: Address, owner: Address): Promise<bigint> {
  return withRetry(
    () => publicClient.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [owner] }),
    "wallet.balanceOf",
    { retries: 1 },
  );
}

/** full pocket check for `address` (defaults to the hot wallet). */
export async function walletSummary(address?: Address): Promise<WalletSummary> {
  const wallet = address ?? botAddress;
  if (!wallet) throw new Error("no PRIVATE_KEY configured — kumo has no hands right now");

  const [ethBal, code, wethBal, usdgBal] = await Promise.all([
    withRetry(() => publicClient.getBalance({ address: wallet }), "wallet.eth"),
    withRetry(() => publicClient.getCode({ address: wallet }), "wallet.code", { retries: 1 }).catch(() => undefined),
    balanceOf(CONFIG.weth, wallet).catch(() => 0n),
    balanceOf(CONFIG.usdg, wallet).catch(() => 0n),
  ]);

  // every discovered stock token, batched; nonzero balances only
  const stocks: TokenHolding[] = [];
  const list = allStocks();
  const BATCH = 15;
  for (let i = 0; i < list.length; i += BATCH) {
    const results = await Promise.all(
      list.slice(i, i + BATCH).map(async (s) => {
        try {
          const bal = await balanceOf(s.address, wallet);
          return bal > 0n ? { symbol: s.symbol, address: s.address, balance: formatUnits(bal, s.decimals ?? 18) } : null;
        } catch {
          return null;
        }
      }),
    );
    for (const r of results) if (r) stocks.push(r);
  }

  const reserve = parseEther(CONFIG.gasReserveEth.toString());
  const distributable = ethBal > reserve ? ethBal - reserve : 0n;
  return {
    address: wallet,
    is_contract: code !== undefined && code !== "0x",
    eth_balance: formatEther(ethBal),
    gas_reserve_eth: CONFIG.gasReserveEth,
    distributable_eth: formatEther(distributable),
    distribute_min_eth: CONFIG.distributeMinEth,
    saving_up: distributable < parseEther(CONFIG.distributeMinEth.toString()),
    weth_balance: formatEther(wethBal),
    usdg_balance: formatEther(usdgBal),
    stocks,
  };
}

/** the boot line: "kumo's hands are attached. wallet 0x8683...0322. 0.41 eth. holding 3 stocks." */
export function walletLine(s: WalletSummary): string {
  const short = `${s.address.slice(0, 6)}...${s.address.slice(-4)}`;
  const eth = Number(s.eth_balance).toFixed(Number(s.eth_balance) >= 0.01 ? 2 : 4);
  const stocks =
    s.stocks.length === 0 ? "holding no stocks yet" : `holding ${s.stocks.length} stock${s.stocks.length === 1 ? "" : "s"}`;
  return `kumo's hands are attached. wallet ${short}. ${eth} eth. ${stocks}.`;
}
