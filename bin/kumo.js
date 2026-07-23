#!/usr/bin/env node
// kumo cli — a small wrapper around the kumo api.
// env: KUMO_URL (default http://localhost:8787), KUMO_ADMIN_KEY for admin commands.
import { Command } from "commander";

const BASE = (process.env.KUMO_URL ?? "http://localhost:8787").replace(/\/+$/, "");
const ADMIN_KEY = process.env.KUMO_ADMIN_KEY ?? "";

async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(ADMIN_KEY ? { "X-Kumo-Admin-Key": ADMIN_KEY } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(data.line ?? data.error ?? `http ${res.status}`);
    process.exit(1);
  }
  return data;
}

const program = new Command();
program.name("kumo").description("talk to your kumo agent").version("0.1.0");

program
  .command("status")
  .description("is kumo awake?")
  .action(async () => {
    const s = await api("GET", "/status");
    console.log(`kumo is ${s.state}. uptime ${s.uptime_s}s, watching ${s.watching} wallets, ${s.agents_connected} agent friends, ${s.signals_today} signals today.${s.mock ? " (mock mode)" : ""}`);
  });

program
  .command("watch <address>")
  .option("-l, --label <label>", "a cute name for the wallet")
  .description("ask kumo to watch a wallet")
  .action(async (address, opts) => {
    const r = await api("POST", "/watch", { address, label: opts.label });
    console.log(r.line);
  });

program
  .command("unwatch <address>")
  .description("stop watching a wallet")
  .action(async (address) => {
    const r = await api("DELETE", `/watch/${address}`);
    console.log(r.line);
  });

program
  .command("wallets")
  .description("what is kumo watching?")
  .action(async () => {
    const list = await api("GET", "/wallets");
    if (list.length === 0) return console.log("kumo isn't watching any wallets yet.");
    for (const w of list) {
      console.log(`${w.label}  ${w.address}`);
      console.log(`  eth: ${w.eth_balance_eth}  pnl: ${w.pnl_eth >= 0 ? "+" : ""}${w.pnl_eth} eth`);
      for (const m of w.last_moves.slice(0, 3)) {
        console.log(`  ${m.kind === "in" ? "<-" : "->"} ${m.amount} ${m.symbol}`);
      }
    }
  });

program
  .command("stocks")
  .description("stock-token watch")
  .action(async () => {
    const list = await api("GET", "/stocks");
    for (const s of list.slice(0, 25)) {
      const chg = s.change_24h === null || s.change_24h === undefined ? "" : ` (${s.change_24h >= 0 ? "+" : ""}${s.change_24h.toFixed(1)}%)`;
      const ta = s.ta_score === null || s.ta_score === undefined ? "" : `  ta ${(s.ta_score * 100).toFixed(0)}`;
      console.log(`${s.symbol}: ${s.price_usd ? "$" + s.price_usd : "unpriced"}${chg}${ta} — market ${s.market}`);
    }
    if (list.length > 25) console.log(`...and ${list.length - 25} more. kumo watches them all.`);
  });

program
  .command("ranking")
  .description("kumo's live ta rankings")
  .action(async () => {
    const list = await api("GET", "/stocks/ranking");
    if (list.length === 0) return console.log("kumo hasn't scored anything yet. give it a cycle.");
    for (const m of list.slice(0, 15)) {
      const mom = m.short_momentum_pct === null ? "?" : `${m.short_momentum_pct >= 0 ? "+" : ""}${m.short_momentum_pct}%`;
      console.log(
        `${String(m.symbol).padEnd(6)} ta ${(m.ta_score * 100).toFixed(0).padStart(3)}  1h ${mom}  volx ${m.volume_spike}  liq $${Math.round(m.liquidity_usd / 1000)}k`,
      );
    }
  });

program
  .command("signals")
  .description("kumo's active signals")
  .action(async () => {
    const list = await api("GET", "/signals");
    if (list.length === 0) return console.log("no active signals. the chain is quiet.");
    for (const s of list) console.log(`[${s.kind}] ${(s.strength * 100).toFixed(0)}%  ${s.line}`);
  });

const trade = program.command("trade").description("quotes and (flag-gated) trades");
trade
  .command("quote <tokenIn> <tokenOut> <amountIn>")
  .description("get a quote, e.g. kumo trade quote ETH NVDA 0.1")
  .action(async (tokenIn, tokenOut, amountIn) => {
    const q = await api("POST", "/trade/quote", { tokenIn, tokenOut, amountIn });
    console.log(q.line);
    console.log(`  ${amountIn} ${tokenIn} -> ~${q.amountOut} ${tokenOut} (min ${q.minOut}, route ${q.route})`);
  });
trade
  .command("execute <tokenOut> <amountEth>")
  .description("swap native ETH into a token (needs TRADING_ENABLED + admin key)")
  .action(async (tokenOut, amountEth) => {
    const r = await api("POST", "/trade/execute", { tokenOut, amountEth: Number(amountEth) });
    console.log(r.line, r.tx ?? "");
  });

program
  .command("chat <message...>")
  .description("talk to kumo")
  .action(async (words) => {
    const r = await api("POST", "/chat", { message: words.join(" ") });
    console.log(r.reply);
  });

program
  .command("connect <url>")
  .description("introduce kumo to another agent (admin)")
  .action(async (url) => {
    const r = await api("POST", "/admin/connect", { url });
    console.log(`kumo said hello to ${r.peer}.`);
    console.log(JSON.stringify(r.reply, null, 2));
  });

program
  .command("register")
  .description("register kumo in the erc-8004 registry on-chain (admin, one-time)")
  .action(async () => {
    const r = await api("POST", "/admin/register-erc8004");
    console.log(r.registered ? `kumo is agent #${r.agentId} on-chain now.` : r.reason);
  });

program
  .command("feed")
  .description("tail kumo's live feed (ctrl-c to stop)")
  .action(async () => {
    const res = await fetch(`${BASE}/feed?limit=15`, { headers: { accept: "text/event-stream" } });
    if (!res.ok || !res.body) {
      console.error("kumo's feed is unreachable.");
      process.exit(1);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split("\n\n");
      buf = parts.pop() ?? "";
      for (const part of parts) {
        const line = part.split("\n").find((l) => l.startsWith("data: "));
        if (!line) continue;
        try {
          const ev = JSON.parse(line.slice(6));
          console.log(`${new Date(ev.ts).toLocaleTimeString()}  ${ev.line}`);
        } catch {
          /* partial frame */
        }
      }
    }
  });

program.parseAsync().catch((err) => {
  console.error("kumo bonked its head:", err.message);
  process.exit(1);
});
