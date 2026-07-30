import { createPublicClient, createWalletClient, http, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CONFIG, robinhoodChain } from "./config.js";

export const publicClient = createPublicClient({
  chain: robinhoodChain,
  transport: http(CONFIG.rpcUrl),
});

// the hot wallet is optional: read-only + mock modes work without it.
// key comes from PRIVATE_KEY env only — never committed, never logged.
const rawKey = process.env.PRIVATE_KEY ?? "";
const privateKey = rawKey ? ((rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`) as `0x${string}`) : null;

export const account = privateKey ? privateKeyToAccount(privateKey) : null;
export const botAddress: Address | null = account?.address ?? null;

export const walletClient = account
  ? createWalletClient({ account, chain: robinhoodChain, transport: http(CONFIG.rpcUrl) })
  : null;

export function requireWallet(): { account: NonNullable<typeof account>; walletClient: NonNullable<typeof walletClient> } {
  if (!account || !walletClient) {
    throw new Error("no PRIVATE_KEY configured — kumo has no hands right now");
  }
  return { account, walletClient };
}
