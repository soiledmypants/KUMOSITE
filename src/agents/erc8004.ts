// erc-8004 identity registration on robinhood chain.
// NOTE (verified jul 2026): the canonical registry proxy exists on RHC at
// 0x8004A169...a432 but currently points to a minimal placeholder implementation
// with no register() yet. we preflight with a simulation and fail softly — kumo's
// agent card works either way, and this activates the moment the registry does.
import { parseAbi } from "viem";
import { CONFIG } from "../config.js";
import { publicClient, requireWallet } from "../clients.js";
import { setMeta } from "../db.js";
import { say } from "../voice.js";

const registryAbi = parseAbi([
  "function register(string tokenURI) returns (uint256 agentId)",
]);

export async function registerOnChain(): Promise<{ registered: boolean; agentId?: string; reason?: string }> {
  const { account, walletClient } = requireWallet();
  const tokenURI = `${CONFIG.publicUrl}/agent/manifest`;
  try {
    const { request, result } = await publicClient.simulateContract({
      address: CONFIG.erc8004Registry,
      abi: registryAbi,
      functionName: "register",
      args: [tokenURI],
      account,
    });
    const hash = await walletClient.writeContract(request);
    await publicClient.waitForTransactionReceipt({ hash });
    const agentId = (result ?? "").toString();
    await setMeta("erc8004_agent_id", agentId);
    say("agent", `kumo registered itself on-chain. agent #${agentId}. kumo is official now.`);
    return { registered: true, agentId };
  } catch (err) {
    const reason =
      "the erc-8004 registry on robinhood chain isn't accepting registrations yet (placeholder implementation). kumo will keep serving its agent card and try again another day.";
    say("agent", `kumo tried to register on-chain but ${reason}`);
    return { registered: false, reason: `${reason} (${(err as Error).message.slice(0, 120)})` };
  }
}
