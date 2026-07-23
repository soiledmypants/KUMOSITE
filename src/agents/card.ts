// kumo's machine-readable agent card (a2a-style), served at /agent/manifest and
// /.well-known/agent-card.json. erc-8004 registrations point their tokenURI here.
import { CONFIG } from "../config.js";
import { botAddress } from "../clients.js";
import { getMeta } from "../db.js";

export async function agentCard(): Promise<Record<string, unknown>> {
  const agentId = await getMeta("erc8004_agent_id").catch(() => undefined);
  return {
    protocolVersion: "0.3.0",
    name: "kumo",
    description:
      "kumo is a cute on-chain companion living on robinhood chain. it watches wallets, memecoins, and tokenized stocks, shares signals with friends, and learns from other agents.",
    url: `${CONFIG.publicUrl}/agent/inbox`,
    preferredTransport: "http+json",
    provider: { organization: "kumo", url: CONFIG.publicUrl },
    version: "0.1.0",
    capabilities: { streaming: true, pushNotifications: true },
    authentication: {
      scheme: "bearer",
      description:
        "POST /agent/inbox with intent 'hello' — kumo issues a nonce; sign 'kumo-hello:<nonce>' with your agent wallet; kumo returns a bearer token.",
    },
    skills: [
      { id: "signals", name: "market signals", description: "rep-weighted buy/avoid/watch signals for memecoins, tokenized stocks, and wallets on chain 4663" },
      { id: "intel", name: "contribute intel", description: "send kumo wallet tips, token flags, stock signals. accuracy is scored; reputation unlocks early signal access" },
      { id: "quotes", name: "trade quotes", description: "uniswap v3 quotes on robinhood chain (single + two-hop routes)" },
      { id: "chat", name: "talk to kumo", description: "natural-language q&a about what kumo is watching" },
    ],
    endpoints: {
      status: `${CONFIG.publicUrl}/status`,
      feed: `${CONFIG.publicUrl}/feed`,
      signals: `${CONFIG.publicUrl}/signals`,
      intel: `${CONFIG.publicUrl}/intel`,
      inbox: `${CONFIG.publicUrl}/agent/inbox`,
    },
    registrations: agentId
      ? [{ standard: "erc-8004", chainId: CONFIG.chainId, registry: CONFIG.erc8004Registry, agentId }]
      : [],
    wallet: botAddress ? { chainId: CONFIG.chainId, address: botAddress } : undefined,
    lore: "kumo is small, watches everything, and trusts you a little more every time you are right.",
  };
}
