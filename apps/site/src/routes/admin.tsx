// /admin — the old ops-panel, reborn in kumo's own skin (phase 2d).
// the admin key is entered client-side and held in COMPONENT STATE ONLY:
// never localStorage, never a cookie, gone on refresh. there is no key import,
// no private-key anything — the hot wallet key lives in render env, full stop.
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { Box } from "@/components/SiteChrome";
import { KUMO_API } from "@/lib/kumo-api";
import type { RoundPlan, RoundReceipt } from "@kumo/shared";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "admin :: kumo" }, { name: "robots", content: "noindex" }] }),
  component: Admin,
});

async function adminFetch<T>(key: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${KUMO_API}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      "X-Kumo-Admin-Key": key,
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(60_000),
  });
  const body = (await res.json().catch(() => null)) as (T & { error?: string; line?: string }) | null;
  if (!res.ok) throw new Error(body?.line || body?.error || `http ${res.status}`);
  return body as T;
}

/** two-step arm/fire button for anything irreversible — no accidental sends */
function ArmedButton({ label, onFire, danger = true }: { label: string; onFire: () => void; danger?: boolean }) {
  const [armed, setArmed] = useState(false);
  if (!armed) {
    return (
      <button onClick={() => setArmed(true)} className="box px-3 py-1 text-xs lowercase tracking-widest hover:box-inv">
        [ {label} ]
      </button>
    );
  }
  return (
    <span className="inline-flex gap-1">
      <button
        onClick={() => {
          setArmed(false);
          onFire();
        }}
        className={`box px-3 py-1 text-xs lowercase tracking-widest ${danger ? "text-red-400 border-red-400 hover:bg-red-400 hover:text-black" : "hover:box-inv"}`}
      >
        [ confirm: {label} ]
      </button>
      <button onClick={() => setArmed(false)} className="box px-3 py-1 text-xs lowercase tracking-widest hover:box-inv">
        [ abort ]
      </button>
    </span>
  );
}

function Pre({ data }: { data: unknown }) {
  return <pre className="text-xs leading-relaxed whitespace-pre-wrap break-all">{JSON.stringify(data, null, 2)}</pre>;
}

function Admin() {
  const [key, setKey] = useState(""); // memory only, by design
  const [unlocked, setUnlocked] = useState(false);
  const [state, setState] = useState<Record<string, unknown> | null>(null);
  const [wallet, setWallet] = useState<Record<string, unknown> | null>(null);
  const [claim, setClaim] = useState<Record<string, unknown> | null>(null);
  const [plan, setPlan] = useState<RoundPlan | null>(null);
  const [rounds, setRounds] = useState<RoundReceipt[] | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const note = useCallback((s: string) => setLog((xs) => [...xs.slice(-19), `[${new Date().toLocaleTimeString()}] ${s}`]), []);

  const refresh = useCallback(async (k: string) => {
    setError(null);
    const [st, w, c, r] = await Promise.allSettled([
      adminFetch<Record<string, unknown>>(k, "/admin/state"),
      adminFetch<Record<string, unknown>>(k, "/admin/wallet"),
      adminFetch<Record<string, unknown>>(k, "/admin/claim/status"),
      fetch(`${KUMO_API}/rounds?limit=10`).then((x) => x.json() as Promise<RoundReceipt[]>),
    ]);
    if (st.status === "fulfilled") setState(st.value);
    else throw st.reason;
    if (w.status === "fulfilled") setWallet(w.value);
    if (c.status === "fulfilled") setClaim(c.value);
    if (r.status === "fulfilled") setRounds(r.value);
  }, []);

  async function unlock() {
    try {
      await refresh(key);
      setUnlocked(true);
      note("unlocked. key held in memory only — refresh forgets it.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "no.");
    }
  }

  async function act(label: string, path: string, body?: unknown) {
    try {
      note(`${label}...`);
      const r = await adminFetch<{ line?: string }>(key, path, {
        method: "POST",
        body: JSON.stringify(body ?? {}),
      });
      note(`${label}: ${r.line ?? "done"}`);
      await refresh(key);
    } catch (e) {
      note(`${label} FAILED: ${e instanceof Error ? e.message : e}`);
    }
  }

  if (!unlocked) {
    return (
      <Box title="admin" meta="locked">
        <p className="lowercase text-sm dim">
          kumo's back office. the admin key is checked by the api on every call and held in memory only — nothing is
          stored in this browser. there is no key import here and never will be.
        </p>
        <div className="mt-3 flex gap-2">
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && unlock()}
            placeholder="x-kumo-admin-key"
            autoComplete="off"
            className="flex-1 bg-black border border-[#ccff00] px-2 py-1 text-[#ccff00] placeholder:text-[#4d6600] text-sm"
          />
          <button onClick={unlock} className="box px-4 py-1 lowercase tracking-widest hover:box-inv">
            [ unlock ]
          </button>
        </div>
        {error ? <div className="mt-2 text-xs lowercase text-red-400">!! {error}</div> : null}
      </Box>
    );
  }

  const dry = Boolean(state?.keeper_dry_run);
  return (
    <>
      <Box title="switchboard" meta="display only — flip in render">
        {state ? (
          <pre className="text-xs leading-relaxed whitespace-pre-wrap">
            {[
              `${dry ? "[on ]" : "[off]"} KEEPER_DRY_RUN     ${dry ? "rounds plan, never send" : "rounds SEND for real"}`,
              `${state.killswitch ? "[on ]" : "[off]"} KILLSWITCH         twitter halt (posting only — payouts unaffected)`,
              `${state.claim_enabled ? "[on ]" : "[off]"} CLAIM_ENABLED      pons fee claiming loop`,
              `${state.claim_dry_run ? "[on ]" : "[off]"} CLAIM_DRY_RUN      claims plan, never send`,
              `${state.trading_enabled ? "[on ]" : "[off]"} TRADING_ENABLED    manual /trade/execute`,
              `      AGENT_REWARD_MODE  ${String(state.agent_reward_mode)} (pool ${String(state.agent_pool_pct)}%, single-agent cap ${String(state.max_agent_share_pct)}%)`,
              `      cycle ${String(state.cycle_minutes)}m · distribute_min ${String(state.distribute_min_eth)} eth · mock ${String(state.mock)}`,
            ].join("\n")}
          </pre>
        ) : null}
      </Box>

      <Box title="hot wallet" meta={wallet ? `${String(wallet.eth_balance).slice(0, 8)} eth` : "…"}>
        {wallet ? (
          <div className="text-xs lowercase space-y-1">
            <div className="break-all"><span className="dim">address ::</span> {String(wallet.address)}</div>
            <div>
              <span className="dim">eth ::</span> {String(wallet.eth_balance)} <span className="dim">(reserve {String(wallet.gas_reserve_eth)}, distributable {String(wallet.distributable_eth)}, min {String(wallet.distribute_min_eth)})</span>{" "}
              {wallet.saving_up ? <span>— saving up</span> : <span>— ready to round</span>}
            </div>
            <div><span className="dim">weth/usdg ::</span> {String(wallet.weth_balance)} / {String(wallet.usdg_balance)}</div>
            <div>
              <span className="dim">stocks ::</span>{" "}
              {Array.isArray(wallet.stocks) && wallet.stocks.length > 0
                ? (wallet.stocks as { symbol: string; balance: string }[]).map((s) => `${s.symbol} ${s.balance}`).join(", ")
                : "none held"}
            </div>
          </div>
        ) : (
          <div className="dim text-xs lowercase">wallet card unavailable (no PRIVATE_KEY on the server?)</div>
        )}
      </Box>

      <Box title="fee claim" meta={claim?.dry_run ? "dry-run mode" : "live-capable"}>
        {claim ? <Pre data={claim} /> : null}
        <div className="mt-2 flex flex-wrap gap-2">
          <button onClick={() => act("dry claim cycle", "/admin/claim/run", { dryRun: true })} className="box px-3 py-1 text-xs lowercase tracking-widest hover:box-inv">
            [ dry claim cycle ]
          </button>
          <ArmedButton label="force LIVE claim cycle" onFire={() => act("LIVE claim cycle", "/admin/claim/run", { dryRun: false })} />
        </div>
      </Box>

      <Box title="payout round" meta={dry ? "keeper is dry" : "keeper is LIVE"}>
        <div className="flex flex-wrap gap-2">
          <button onClick={async () => {
            try {
              note("planning a round (nothing sent)...");
              setPlan(await adminFetch<RoundPlan>(key, "/admin/keeper/dry-run", { method: "POST", body: "{}" }));
              note("plan ready.");
            } catch (e) {
              note(`plan FAILED: ${e instanceof Error ? e.message : e}`);
            }
          }} className="box px-3 py-1 text-xs lowercase tracking-widest hover:box-inv">
            [ plan round (dry) ]
          </button>
          <ArmedButton label={dry ? "force round (server is dry — will plan)" : "force LIVE round"} onFire={() => act("force round", "/admin/keeper/run")} />
        </div>
        {plan ? (
          <div className="mt-3 text-xs lowercase space-y-2">
            <div className="uppercase tracking-widest">round plan :: phase = {plan.phase}</div>
            <div>{plan.note}</div>
            <div className="dim">wallet {plan.wallet} · balance {plan.balance_eth} eth · distributable {plan.distributable_eth} (min {plan.distribute_min_eth}, reserve {plan.gas_reserve_eth})</div>
            {plan.pick ? <div>pick :: {plan.pick.symbol} {plan.pick.passes_screen ? "[screen ok]" : "[screen FAIL]"} — {plan.pick.screen_note}</div> : null}
            {plan.planned_buy ? (
              <div>buy :: {plan.planned_buy.route} — {plan.planned_buy.amount_in_eth} eth → ~{plan.planned_buy.quoted_out} (min {plan.planned_buy.min_out}), impact {plan.planned_buy.impact_pct}% / cap {plan.planned_buy.max_impact_pct}%</div>
            ) : null}
            {plan.planned_distribution ? (
              <div>
                stakers :: {plan.planned_distribution.recipients} paid ({plan.planned_distribution.boosted} boosted), {plan.planned_distribution.skipped_dust} dust-accrued, total {plan.planned_distribution.total_planned}
              </div>
            ) : null}
            {plan.planned_agent_pool ? (
              <div>
                agent pool :: mode {plan.planned_agent_pool.mode}, {plan.planned_agent_pool.pool_pct}% → {plan.planned_agent_pool.eligible_agents} eligible agents, total {plan.planned_agent_pool.amount} ({plan.planned_agent_pool.skipped_dust} dust)
              </div>
            ) : null}
          </div>
        ) : null}
      </Box>

      <Box title="recent rounds" meta={rounds ? `${rounds.length}` : "…"}>
        {rounds && rounds.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs lowercase">
              <thead>
                <tr className="dim text-left uppercase tracking-widest">
                  <th className="pr-3">#</th><th className="pr-3">stock</th><th className="pr-3">bought</th>
                  <th className="pr-3">stakers</th><th className="pr-3">agents</th><th className="pr-3">dust</th><th>failed</th>
                </tr>
              </thead>
              <tbody>
                {rounds.map((r) => (
                  <tr key={r.id} className={r.failed > 0 ? "text-red-400" : ""}>
                    <td className="pr-3">{r.id}</td>
                    <td className="pr-3">{r.stock_symbol}</td>
                    <td className="pr-3">{r.tokens_bought}</td>
                    <td className="pr-3">{r.staker_count}</td>
                    <td className="pr-3">{r.agent_count}</td>
                    <td className="pr-3">{r.dust_skipped}</td>
                    <td>{r.failed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="dim text-xs lowercase">no rounds recorded yet.</div>
        )}
      </Box>

      <Box title="ops log" meta="this session">
        <pre className="text-xs leading-relaxed whitespace-pre-wrap">{log.length ? log.join("\n") : "quiet so far."}</pre>
      </Box>
    </>
  );
}
