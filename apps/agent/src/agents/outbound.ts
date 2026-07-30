// kumo reaching out: fetch another agent's card and say hello to its inbox.
import { say, lines } from "../voice.js";
import { CONFIG } from "../config.js";
import { botAddress } from "../clients.js";
import { safeFetchJson } from "./net.js";

export async function connectToAgent(baseUrl: string): Promise<Record<string, unknown>> {
  const allowLocal = process.env.NODE_ENV !== "production";
  const root = baseUrl.replace(/\/+$/, "");

  let card: Record<string, unknown> | null = null;
  for (const path of ["/.well-known/agent-card.json", "/agent/manifest"]) {
    try {
      card = (await safeFetchJson(root + path, undefined, allowLocal)) as Record<string, unknown>;
      break;
    } catch {
      // try next location
    }
  }

  const inboxUrl =
    (card?.endpoints as Record<string, string> | undefined)?.inbox ??
    (typeof card?.url === "string" ? (card.url as string) : `${root}/agent/inbox`);

  const name = typeof card?.name === "string" ? (card.name as string) : root;
  say("agent", lines.agentHello(name));

  const reply = (await safeFetchJson(
    inboxUrl,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        from: {
          address: botAddress ?? undefined,
          name: "kumo",
          card_url: `${CONFIG.publicUrl}/agent/manifest`,
        },
        intent: "hello",
        payload: {},
      }),
    },
    allowLocal,
  )) as Record<string, unknown>;

  return { peer: name, card: card ?? "no card found", reply };
}
