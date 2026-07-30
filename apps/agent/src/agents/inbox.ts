// agent-to-agent inbox: a small json envelope other agents POST to kumo.
// { from: {address, name?, card_url?}, intent, payload } -> intent-specific reply.
import type { Address } from "viem";
import { lines, say } from "../voice.js";
import { activeSignals } from "../scanner/signals.js";
import { chat } from "../chat.js";
import { db } from "../db.js";
import { assertSafeUrl } from "./net.js";
import { issueNonce, completeHandshake, type AgentRow } from "./auth.js";
import { submitIntel, type IntelInput } from "./reputation.js";

export interface Envelope {
  from?: { address?: string; name?: string; card_url?: string };
  intent?: string;
  payload?: Record<string, unknown>;
}

export async function handleEnvelope(env: Envelope, agent: AgentRow | null): Promise<Record<string, unknown>> {
  const intent = env.intent ?? "hello";
  const payload = env.payload ?? {};

  switch (intent) {
    case "hello": {
      const address = env.from?.address;
      if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
        return { error: "hello needs from.address (0x...)", line: "kumo squints. who are you?" };
      }
      const signature = payload.signature as `0x${string}` | undefined;
      if (!signature) {
        const nonce = issueNonce(address);
        return {
          nonce,
          sign: `kumo-hello:${nonce}`,
          line: "kumo waves. sign the nonce and say hello again.",
        };
      }
      const token = await completeHandshake({
        address: address as Address,
        signature,
        name: env.from?.name,
        cardUrl: env.from?.card_url,
      });
      say("agent", lines.agentHello(env.from?.name ?? address.slice(0, 8)));
      return { token, line: "kumo is happy to meet you. keep this token safe." };
    }

    case "signals": {
      const early = agent !== null && (agent.tier === "trusted" || agent.tier === "inner-circle");
      const signals = await activeSignals(early);
      return { signals, early_access: early, line: early ? "kumo shares its freshest thoughts with a trusted friend." : "kumo shares what everyone can see." };
    }

    case "query": {
      const question = String(payload.question ?? payload.message ?? "");
      if (!question) return { error: "query needs payload.question" };
      const reply = await chat(question);
      return { reply };
    }

    case "subscribe": {
      if (!agent) return { error: "subscribe requires a bearer token — say hello first" };
      const url = String(payload.webhook_url ?? "");
      try {
        await assertSafeUrl(url, process.env.NODE_ENV !== "production");
      } catch (err) {
        return { error: `bad webhook url: ${(err as Error).message}` };
      }
      await db.run("UPDATE agents SET webhook_url = ? WHERE address = ?", [url, agent.address]);
      return {
        subscribed: true,
        line:
          agent.tier === "hatchling"
            ? "kumo will ping you... once kumo trusts you a bit more. (trusted tier unlocks early signals)"
            : "kumo will whisper signals to you early.",
      };
    }

    case "intel": {
      if (!agent) return { error: "intel requires a bearer token — say hello first" };
      const result = await submitIntel(agent, payload as unknown as IntelInput);
      return { accepted: true, ...result, current_rep: agent.rep, line: "kumo is thinking about what you said..." };
    }

    default:
      return { error: `unknown intent: ${intent}`, line: "kumo tilts its head." };
  }
}
