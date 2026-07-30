// hot-wallet verification: derives the address from PRIVATE_KEY and REFUSES to
// proceed unless it is exactly the designated hot wallet. prints address +
// balances only — the key itself is never printed, logged, or written anywhere.
//
//   npm run wallet:check          (from the repo root)
//   npx tsx scripts/wallet-check.ts   (from apps/agent, .env there or at root)
import dotenv from "dotenv";
import { createPublicClient, formatEther, formatUnits, http, parseAbi, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ADDRESSES, CHAIN_ID, RPC_URL } from "@kumo/shared";

dotenv.config({ path: [".env", "../../.env"] });

// kumo's designated hot wallet. wallet-check fails hard on any other key.
const EXPECTED_HOT_WALLET = "0x86832C96F302834771F751db7e8D2B04367F0322";

const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);

async function main(): Promise<void> {
  const raw = process.env.PRIVATE_KEY ?? "";
  if (!raw) {
    console.error("FAIL: PRIVATE_KEY is not set (looked in apps/agent/.env and the repo root .env).");
    process.exit(1);
  }
  const key = (raw.startsWith("0x") ? raw : `0x${raw}`) as `0x${string}`;
  const account = privateKeyToAccount(key);

  if (account.address.toLowerCase() !== EXPECTED_HOT_WALLET.toLowerCase()) {
    console.error(`FAIL: PRIVATE_KEY derives ${account.address}`);
    console.error(`      expected the designated hot wallet ${EXPECTED_HOT_WALLET}`);
    console.error("      refusing to proceed. check which key landed in .env.");
    process.exit(1);
  }

  const rpcUrl = process.env.RPC_URL ?? RPC_URL;
  const client = createPublicClient({ transport: http(rpcUrl) });

  const chainId = await client.getChainId();
  const [ethBal, code] = await Promise.all([
    client.getBalance({ address: account.address }),
    client.getCode({ address: account.address }).catch(() => undefined),
  ]);

  console.log("wallet-check: OK — key derives the designated hot wallet");
  console.log(`  address        ${account.address}`);
  console.log(`  chain          ${chainId}${chainId === CHAIN_ID ? "" : `  (WARNING: expected ${CHAIN_ID})`}`);
  console.log(`  is contract    ${code !== undefined && code !== "0x" ? "YES (unexpected!)" : "no (EOA, as expected)"}`);
  console.log(`  eth            ${formatEther(ethBal)}`);

  // WETH + USDG + configured stock tokens (the running agent's /admin/wallet
  // covers the full ~96-token discovered list; this script stays db-free).
  const tokens: { label: string; address: Address }[] = [
    { label: "WETH", address: ADDRESSES.weth as Address },
    { label: "USDG", address: ADDRESSES.usdg as Address },
  ];
  const stockEnv = process.env.STOCK_TOKENS ?? `NVDA:${ADDRESSES.nvda}`;
  for (const pair of stockEnv.split(",").map((s) => s.trim()).filter(Boolean)) {
    const [symbol, address] = pair.split(":");
    if (symbol && address) tokens.push({ label: symbol.toUpperCase(), address: address as Address });
  }

  for (const t of tokens) {
    try {
      const [bal, decimals] = await Promise.all([
        client.readContract({ address: t.address, abi: erc20Abi, functionName: "balanceOf", args: [account.address] }),
        client.readContract({ address: t.address, abi: erc20Abi, functionName: "decimals" }).catch(() => 18),
      ]);
      console.log(`  ${t.label.padEnd(14)} ${formatUnits(bal, Number(decimals))}`);
    } catch {
      console.log(`  ${t.label.padEnd(14)} (balance read failed)`);
    }
  }
  console.log("\nnote: full discovered-stock balances live on the running agent: GET /admin/wallet");
}

main().catch((err) => {
  console.error(`FAIL: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
