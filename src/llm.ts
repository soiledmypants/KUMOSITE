// provider-agnostic llm completion for /chat and the tweet composer.
// LLM_PROVIDER=anthropic (default) | openai. "openai" speaks the standard
// /v1/chat/completions shape, so any openai-compatible endpoint works via
// LLM_BASE_URL (ollama, groq, openrouter, a local proxy, ...).
// contract: returns the completion text, or null on ANY failure — callers
// always have a rule-based fallback, so this must never throw upward.
import { CONFIG } from "./config.js";

export interface LlmRequest {
  system: string;
  user: string;
  maxTokens: number;
}

export function llmProvider(): "anthropic" | "openai" {
  return (process.env.LLM_PROVIDER ?? "anthropic") === "openai" ? "openai" : "anthropic";
}

/** is a usable key configured for the active provider? */
export function hasLlm(): boolean {
  return llmProvider() === "openai" ? Boolean(process.env.OPENAI_API_KEY) : Boolean(CONFIG.anthropicKey);
}

async function anthropic(req: LlmRequest): Promise<string | null> {
  if (!CONFIG.anthropicKey) return null;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": CONFIG.anthropicKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: CONFIG.chatModel,
      max_tokens: req.maxTokens,
      system: req.system,
      messages: [{ role: "user", content: req.user }],
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`anthropic api ${res.status}`);
  const data = (await res.json()) as { content: { type: string; text?: string }[] };
  return data.content?.find((c) => c.type === "text")?.text ?? null;
}

async function openai(req: LlmRequest): Promise<string | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const base = (process.env.LLM_BASE_URL ?? "https://api.openai.com/v1").replace(/\/+$/, "");
  const model = process.env.LLM_MODEL ?? "gpt-4o-mini";
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: req.maxTokens,
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: req.user },
      ],
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`openai-compatible api ${res.status}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content ?? null;
}

/** complete with the configured provider; null on any failure (caller falls back) */
export async function llmComplete(req: LlmRequest): Promise<string | null> {
  try {
    const text = llmProvider() === "openai" ? await openai(req) : await anthropic(req);
    return text?.trim() || null;
  } catch {
    return null;
  }
}
