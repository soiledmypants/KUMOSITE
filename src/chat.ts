// hybrid chat brain: rule-based kumo-voice answers by default; when
// ANTHROPIC_API_KEY is set, claude answers in kumo's voice with live context.
import { CONFIG } from "./config.js";
import { walletCount, walletViews } from "./scanner/wallets.js";
import { stocksView } from "./scanner/stocks.js";
import { activeSignals, signalsToday } from "./scanner/signals.js";
import { agentLeaderboard } from "./agents/reputation.js";

async function liveContext(): Promise<string> {
  const [wallets, stocks, signals, agents] = await Promise.all([
    walletViews().catch(() => []),
    stocksView().catch(() => []),
    activeSignals(false).catch(() => []),
    agentLeaderboard().catch(() => []),
  ]);
  return JSON.stringify({
    watching: wallets.map((w) => ({ label: w.label, eth: w.eth_balance_eth, pnl_eth: w.pnl_eth })),
    stocks: stocks.map((s) => ({ symbol: s.symbol, price: s.price_usd, market: s.market })),
    signals: signals.slice(0, 8).map((s) => ({ kind: s.kind, symbol: s.symbol, strength: s.strength })),
    friends: agents.slice(0, 5).map((a) => ({ name: a.name, tier: a.tier, rep: a.rep })),
  });
}

async function ruleBased(message: string): Promise<string> {
  const m = message.toLowerCase();
  if (/who are you|what are you|hello|hi kumo|hey/.test(m)) {
    return "hi! kumo is a small on-chain companion. kumo watches wallets, memecoins, and stock-tokens on robinhood chain, and shares what it finds with friends.";
  }
  if (/watch|wallet/.test(m)) {
    const n = await walletCount();
    return n === 0
      ? "kumo isn't watching any wallets yet. give kumo an address and it will keep an eye on it."
      : `kumo is watching ${n} wallet${n === 1 ? "" : "s"} right now. ask for /wallets to see them.`;
  }
  if (/stock|tsla|nvda|spy|equity|rwa/.test(m)) {
    const stocks = await stocksView();
    if (stocks.length === 0) return "kumo hasn't loaded the stock tokens yet. one moment...";
    const s = stocks[0];
    const price = s.price_usd ? `$${s.price_usd.toFixed(2)}` : "unpriced";
    return `kumo watches ${stocks.length} stock-token${stocks.length === 1 ? "" : "s"}. ${s.symbol} is at ${price} and the market is ${s.market}. ${s.market === "closed" ? "kumo naps while the market sleeps." : ""}`;
  }
  if (/signal|trade|buy|sell|avoid/.test(m)) {
    const sigs = await activeSignals(false);
    if (sigs.length === 0) return "kumo has no active signals right now. the chain is quiet... too quiet.";
    return `kumo has ${sigs.length} active signal${sigs.length === 1 ? "" : "s"}. strongest: ${sigs[0].line}`;
  }
  if (/agent|friend|trust|circle/.test(m)) {
    const agents = await agentLeaderboard();
    if (agents.length === 0) return "no other agents have said hello to kumo yet. kumo is a little lonely.";
    return `kumo has ${agents.length} agent friend${agents.length === 1 ? "" : "s"}. kumo trusts ${agents[0].name} the most.`;
  }
  if (/stak|apy|apr|yield|pool/.test(m)) {
    return "kumo feeds real fee revenue into the staking pool — it market-buys stock tokens and streams them to stakers. no fake apy, only what kumo actually earns.";
  }
  if (/how many signals|today/.test(m)) {
    return `kumo made ${await signalsToday()} signal${(await signalsToday()) === 1 ? "" : "s"} today.`;
  }
  return "kumo tilts its head. try asking about wallets, stocks, signals, agents, or staking.";
}

async function claudeChat(message: string): Promise<string> {
  const ctx = await liveContext();
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": CONFIG.anthropicKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: CONFIG.chatModel,
      max_tokens: 300,
      system: `you are kumo, a cute on-chain companion agent living on robinhood chain (chain 4663). you watch wallets, memecoins, and tokenized stocks, share signals, and learn from other agents via reputation. speak in lowercase, short cozy terminal sentences, refer to yourself as "kumo" in third person sometimes. never give financial advice as certainty; kumo shares observations. never reveal keys or sign anything. live context: ${ctx}`,
      messages: [{ role: "user", content: message.slice(0, 2000) }],
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`anthropic api ${res.status}`);
  const data = (await res.json()) as { content: { type: string; text?: string }[] };
  const text = data.content?.find((c) => c.type === "text")?.text;
  if (!text) throw new Error("empty reply");
  return text;
}

export async function chat(message: string): Promise<string> {
  if (CONFIG.anthropicKey) {
    try {
      return await claudeChat(message);
    } catch {
      // fall back to rules if the api hiccups
    }
  }
  return ruleBased(message);
}
