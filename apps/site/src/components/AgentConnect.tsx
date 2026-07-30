// connect-your-agent flow + agent dashboard + live rounds panel (phase 2c).
// terminal aesthetic only: box panels, lowercase, check/x lines. every state
// is honest — no fake numbers, no placeholder apy, ever.
import { useEffect, useMemo, useState } from "react";
import { Box } from "@/components/SiteChrome";
import {
  KUMO_API,
  kumoFetch,
  useKumo,
  useKumoFeed,
  isHexAddress,
  type StakingStats,
  type StockRank,
} from "@/lib/kumo-api";
import type { AgentRewards, RoundReceipt } from "@kumo/shared";
import { connectWallet, initWalletDiscovery, personalSign, walletAvailable } from "@/lib/wallet";

const TOKEN_KEY = "kumo:agent-token";
const ADDR_KEY = "kumo:agent-address";

function useAgentSession() {
  const [token, setToken] = useState<string | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  useEffect(() => {
    setToken(localStorage.getItem(TOKEN_KEY));
    setAddress(localStorage.getItem(ADDR_KEY));
  }, []);
  const save = (t: string, a: string) => {
    localStorage.setItem(TOKEN_KEY, t);
    localStorage.setItem(ADDR_KEY, a);
    setToken(t);
    setAddress(a);
  };
  const clear = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ADDR_KEY);
    setToken(null);
    setAddress(null);
  };
  return { token, address, save, clear };
}

export function ConnectAgent() {
  const { token, address, save, clear } = useAgentSession();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [payout, setPayout] = useState("");

  useEffect(() => initWalletDiscovery(), []);

  async function connect() {
    setError(null);
    try {
      setBusy("waking your wallet...");
      const { address: addr, provider } = await connectWallet();
      setBusy("asking kumo for a nonce...");
      const n = await kumoFetch<{ nonce: string; message: string }>("/agent/connect/nonce", {
        method: "POST",
        body: JSON.stringify({ address: addr }),
      });
      setBusy("sign the message in your wallet...");
      const signature = await personalSign(provider, addr, n.message);
      setBusy("introducing you to kumo...");
      const v = await kumoFetch<{ token: string; address: string }>("/agent/connect/verify", {
        method: "POST",
        body: JSON.stringify({
          address: addr,
          signature,
          ...(name.trim() ? { name: name.trim() } : {}),
          ...(isHexAddress(payout.trim()) ? { payout_address: payout.trim() } : {}),
        }),
      });
      save(v.token, v.address);
      setBusy(null);
    } catch (e) {
      setBusy(null);
      setError(e instanceof Error ? e.message : "something bonked");
    }
  }

  if (token && address) {
    return (
      <Box title="agent link" meta="connected">
        <div className="lowercase text-sm">
          <span className="dim">agent ::</span> <span className="break-all">{address}</span>
        </div>
        <div className="mt-2 flex gap-2">
          <button onClick={clear} className="box px-3 py-1 text-xs lowercase tracking-widest hover:box-inv">
            [ disconnect ]
          </button>
          <span className="dim text-xs lowercase self-center">token lives in your browser only. kumo keeps a hash.</span>
        </div>
      </Box>
    );
  }

  return (
    <Box title="connect your agent" meta="wallet handshake">
      <p className="lowercase text-sm leading-relaxed">
        connect the wallet your agent signs with, sign one message, and kumo will know you. connected agents that{" "}
        <em>stay alive, stay accurate, and hold stake</em> receive a cut of every payout round — a bare handshake earns
        nothing. that's the point.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <label className="text-xs lowercase dim">
          agent name (optional)
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="oracle-9"
            className="mt-1 w-full bg-black border border-[#ccff00] px-2 py-1 text-[#ccff00] placeholder:text-[#4d6600]"
          />
        </label>
        <label className="text-xs lowercase dim">
          payout address (optional, defaults to the signer)
          <input
            value={payout}
            onChange={(e) => setPayout(e.target.value)}
            placeholder="0x..."
            className="mt-1 w-full bg-black border border-[#ccff00] px-2 py-1 text-[#ccff00] placeholder:text-[#4d6600]"
          />
        </label>
      </div>
      <div className="mt-3">
        <button onClick={connect} disabled={busy !== null} className="box px-4 py-2 lowercase tracking-widest hover:box-inv disabled:opacity-50">
          [ {busy ?? "connect agent"} ]
        </button>
      </div>
      {error ? <div className="mt-2 text-xs lowercase text-red-400">!! {error}</div> : null}
      {!error && typeof window !== "undefined" && !walletAvailable() && !busy ? (
        <div className="mt-2 text-xs lowercase dim">no evm wallet detected. agents can also connect over the api — see below.</div>
      ) : null}
    </Box>
  );
}

export function AgentDashboard() {
  const { token, address, clear } = useAgentSession();
  const [me, setMe] = useState<AgentRewards | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    const tick = async () => {
      try {
        const d = await kumoFetch<AgentRewards>("/agent/me", { headers: { Authorization: `Bearer ${token}` } });
        if (alive) {
          setMe(d);
          setError(null);
        }
      } catch (e) {
        if (!alive) return;
        const msg = e instanceof Error ? e.message : "kumo didn't hear that";
        setError(msg);
        if (/401|doesn't know you/i.test(msg)) clear();
      }
    };
    tick();
    const t = setInterval(tick, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [token, clear]);

  if (!token) return null;

  return (
    <Box title="your agent" meta={me ? (me.eligible ? "eligible" : "not eligible yet") : "loading"}>
      {!me && !error ? <div className="dim lowercase text-sm">kumo is pulling your file...</div> : null}
      {error ? <div className="text-xs lowercase text-red-400">!! {error}</div> : null}
      {me ? (
        <div className="space-y-3 text-sm lowercase">
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
            <span><span className="dim">name ::</span> {me.name ?? "—"}</span>
            <span><span className="dim">tier ::</span> {me.tier ?? "—"}</span>
            <span><span className="dim">rep ::</span> {me.rep ?? "—"}</span>
            <span><span className="dim">reward mode ::</span> {me.reward_mode}</span>
            <span><span className="dim">boost ::</span> {me.boost.enabled ? `on, +${me.boost.pct}%${me.boost.applies ? "" : " (not applying to you)"}` : "off"}</span>
          </div>

          {/* eligibility checklist — the exact WHY, straight from the api */}
          <pre className="text-xs leading-relaxed whitespace-pre-wrap">
            {me.checks.map((c) => `${c.ok ? "[ok]" : "[xx]"} ${c.id.padEnd(10)} ${c.note}`).join("\n")}
          </pre>

          <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
            <span><span className="dim">weight ::</span> {me.weight}</span>
            <span><span className="dim">payout addr ::</span> <span className="break-all">{me.payout_address ?? "—"}</span></span>
            <span>
              <span className="dim">total received ::</span>{" "}
              {me.total_received_usd > 0 ? `~$${me.total_received_usd.toFixed(2)}` : "nothing yet. honest."}
            </span>
          </div>

          {me.payouts.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="dim text-left uppercase tracking-widest">
                    <th className="pr-3">round</th>
                    <th className="pr-3">amount</th>
                    <th className="pr-3">when</th>
                    <th>tx</th>
                  </tr>
                </thead>
                <tbody>
                  {me.payouts.map((p) => (
                    <tr key={p.tx_hash + p.round_id}>
                      <td className="pr-3">#{p.round_id}</td>
                      <td className="pr-3">{p.amount}</td>
                      <td className="pr-3">{new Date(p.ts).toLocaleTimeString()}</td>
                      <td>
                        <a href={p.tx_url} target="_blank" rel="noreferrer" className="link-kumo">
                          {p.tx_hash.slice(0, 10)}…
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="dim text-xs">no payouts yet. rounds pay eligible agents automatically — nothing to claim, nothing to press.</div>
          )}
        </div>
      ) : null}
    </Box>
  );
}

function Countdown({ eta }: { eta: number | null }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);
  if (!eta) return <span className="dim">keeper idle — no cycle scheduled yet</span>;
  const left = Math.max(0, eta - Date.now());
  const m = Math.floor(left / 60_000);
  const s = Math.floor((left % 60_000) / 1000);
  return (
    <span>
      next cycle in ~{m}m {String(s).padStart(2, "0")}s
    </span>
  );
}

export function RoundsPanel() {
  const { address } = useAgentSession();
  const { data: stats } = useKumo<StakingStats>("/staking/stats", { refreshMs: 30_000 });
  const { data: ranking } = useKumo<StockRank[]>("/stocks/ranking", { refreshMs: 60_000 });
  const { data: rounds } = useKumo<RoundReceipt[]>("/rounds?limit=3", { refreshMs: 30_000 });
  const { events } = useKumoFeed(30, 60);

  const eta = useMemo(() => {
    const lastRun = stats?.keeper?.last_run;
    const cycle = stats?.keeper?.cycle_minutes;
    return lastRun && cycle ? Number(lastRun) + cycle * 60_000 : null;
  }, [stats]);

  const pick = ranking?.[0];
  const last = rounds?.[0];
  const mine = address ? events.filter((e) => e.line.toLowerCase().includes(address.slice(0, 8))) : [];

  return (
    <Box title="live rounds" meta={<Countdown eta={eta} />}>
      <div className="space-y-2 text-sm lowercase">
        <div className="text-xs">
          <span className="dim uppercase tracking-widest">current ta pick :: </span>
          {pick ? (
            <span>
              {pick.symbol} (score {pick.ta_score?.toFixed?.(2) ?? pick.ta_score}
              {pick.liquidity_usd ? `, liq $${Math.round(pick.liquidity_usd).toLocaleString()}` : ""})
            </span>
          ) : (
            <span className="dim">ta engine warming up — no scores yet.</span>
          )}
        </div>
        <div className="text-xs">
          <span className="dim uppercase tracking-widest">last round :: </span>
          {last ? (
            <span>
              #{last.id} — {last.tokens_bought} {last.stock_symbol} to {last.staker_count} {last.mode}
              {last.agent_count > 0 ? ` + ${last.agent_count} agents` : ""} ({last.dust_skipped} dust-accrued)
            </span>
          ) : (
            <span className="dim">no rounds yet. kumo is saving up — receipts appear here when the first one fires.</span>
          )}
        </div>
        <div className="text-xs">
          <span className="dim uppercase tracking-widest">your address in the feed :: </span>
          {!address ? (
            <span className="dim">connect your agent above to filter the feed to you.</span>
          ) : mine.length === 0 ? (
            <span className="dim">nothing touching {address.slice(0, 8)}… yet. kumo will say your name when it pays you.</span>
          ) : (
            <ul className="mt-1 space-y-0.5">
              {mine.slice(-5).map((e, i) => (
                <li key={`${e.ts}-${i}`}>{e.line}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Box>
  );
}
