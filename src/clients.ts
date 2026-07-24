import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CONFIG, robinhoodChain } from "./config.js";

const rawKey = process.env.PRIVATE_KEY;
if (!rawKey || rawKey.trim().length === 0) {
  throw new Error(
    "PRIVATE_KEY env var is required (any throwaway key works for DRY_RUN). " +
      "Set it in .env (copy .env.example). Never commit the real key.",
  );
}

const privateKey = (rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`) as `0x${string}`;

/** The bot's signing account, derived from PRIVATE_KEY. */
export const account = privateKeyToAccount(privateKey);

/** The bot's public address — must be the token's on-chain fee recipient in live mode. */
export const botAddress = account.address;

/** Read-only chain client. */
export const publicClient = createPublicClient({
  chain: robinhoodChain,
  transport: http(CONFIG.rpcUrl),
});

/** Signing client bound to the bot account. */
export const walletClient = createWalletClient({
  account,
  chain: robinhoodChain,
  transport: http(CONFIG.rpcUrl),
});
