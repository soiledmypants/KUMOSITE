# MERGE_PLAN — KUMOSITE monorepo (site + agent + ops-panel)

Recon date: 2026-07-30. Clones read: KUMOSITE@9c400a8, kumo-agent@489543f, ops-panel@a7d4194 (all `main`).

---

## 1. What each repo actually does today

### KUMOSITE (the site — Netlify)
- **Not a plain Vite SPA**: it's a Lovable **TanStack Start** app (React 19, Tailwind v4, TanStack Router/Query) with `nitro: false` and full **static prerender** — `dist/client` is published as-is by Netlify. There is no runtime server; everything live is client-side polling/SSE against the agent API.
- `src/lib/kumo-api.ts` is the whole API client: hand-copied response types from kumo-agent's `docs/API.md` (`KumoStatus`, `StakingStats`, `LedgerEntry`, `StockRank`, …), `kumoFetch`, `useKumo` polling hook, `useKumoFeed` SSE hook. Base URL: `VITE_KUMO_API` → prod `https://api.imkumoagent.com`, **dev default `http://localhost:3000` (wrong — the agent listens on 8787; needs fixing in the merge)**.
- 17 routes (`/`, `/staking`, `/protocol` = "connect your agent" (currently docs-only, no actual connect flow), `/jobs`, `/stocks`, `/ledger`, `/congregation`, `/terminal`, lore/archive/library/transmissions/ascii-gallery). Aesthetic: `bg-black text-[#ccff00] font-mono`, `box`/`box-inv` bordered panels, lowercase everything. The shadcn `components/ui/*` folder exists (Lovable default) but the real design language is the custom terminal boxes.
- **No wallet library at all.** `StakeWallet.tsx` is a stub button that prints "pool isn't deployed yet". No wagmi/viem/privy in package.json.

### kumo-agent (the brain — Render, `api.imkumoagent.com`)
- Express API (`server.ts`) + background loops (`index.ts`): wallet/stock/memecoin scanners, TA ranking, signals, intel reputation scorer, payout keeper, twitter persona. Postgres-or-sqlite adapter (`db.ts`, `%AUTOPK%` schema trick + additive try/catch ALTERs). Full **mock mode** (`KUMO_MOCK=true`) fixtures for every endpoint.
- **Payout engine** (the thing Phase 2 extends):
  - `staking/keeper.ts` — every `CYCLE_MINUTES`: read wallet ETH, sweep everything above `GAS_RESERVE_ETH`; if ≥ `DISTRIBUTE_MIN_ETH`, pick the round stock (`epoch.ts`: best TA score passing a $250k-reserve/$500k-volume liquidity screen, NVDA fallback), two-hop buy ETH→USDG→stock via SwapRouter02 with a price-impact cap, then distribute the wallet's **full** stock balance. Also `keeperPlanOnce()` → `RoundPlan` (the dry-run planner behind `POST /admin/keeper/dry-run` and `KEEPER_DRY_RUN=true`).
  - `staking/recipients.ts` — see §3.
  - `staking/distribute.ts` — pure `computeShares()` (pro-rata + `PER_RECIPIENT_MIN_USD` dust skip-and-accrue, dust keyed `(address, token)` in `dust_accruals`, failed transfers re-accrue as dust) + serial `distributeShares()` through the signer guard.
  - `trade/guard.ts` — hot-wallet signer: only signs kumo-built calldata to a **fixed allowlist** (router, WETH, USDG, ERC-8004 registry, stock tokens, KUMO, staking contract), manual nonce cursor, gas-bump rebroadcast. **Airdrop txs target the token contract, not recipients, so agent payouts need zero allowlist changes.**
- **Agent layer**: `agents/auth.ts` hello handshake (nonce → personal_sign `kumo-hello:<nonce>` → sha256-hashed bearer in `agents.token_hash`; `authenticateBearer` bumps `last_seen`), `inbox.ts` A2A envelope (hello/signals/query/subscribe/intel), `reputation.ts` (EWMA rep 0.9/0.1, tiers: `hatchling` → `trusted` (n_scored≥10 && rep≥0.55) → `inner-circle` (top10 rep≥0.7); trusted+ gets early signal access), `card.ts` A2A card, `erc8004.ts` on-chain registration.
- Unified `ledger.ts` (tx-hash-deduped, kinds `claim|forward|buyback|reward_fund|trade|airdrop`, every insert also emits a kumo-voice `/feed` line) — **this is where ops-panel already reports its claims today** (`POST /ledger` + `X-Kumo-Admin-Key`).
- `contracts/` — Foundry: `KumoMultiStaking.sol` (Synthetix MultiRewards-style, ≤8 reward tokens, pull-funded, immutable) + deploy script + tests. Not yet deployed (`STAKING_ADDRESS` unset).
- Tests: standalone tsx scripts (`staking/distribute.test.ts`, `twitter/guardrails.test.ts`, `twitter/pipeline.test.ts`) — no test runner.
- Keeper explicitly does **not** claim fees: *"ops-panel claims and forwards ETH here, so the sweep just reads the wallet balance."*

### ops-panel (the ops console — Railway)
One Node process, multi-project (`projects.json` + panel-created projects), password-gated static panel (`panel/*.js`, no build) + `/api/*` + ws feed. Piece by piece:

| module | what it does |
|---|---|
| `engine/claim.ts` | **pons.family fee claiming** — resolves the token on the current/legacy `PonsLaunchLocker` (`0x736D…7F35` / `0x31ca…54B5`), simulates `collectFees` to read claimable, claims when net ≥ `claimMinEth`, unwraps WETH, forwards ETH split treasury/kumo (`treasuryPct`), forwards token to treasury. Guards: `collectFees` **always pays `feeRedirects[token] ‖ deployer` regardless of caller**, so it verifies the bot key derives that recipient and disables live claiming loudly otherwise. |
| `engine/holders.ts` | ERC-20 Transfer-event holder indexer, per-token better-sqlite3 file, adaptive chunking, contract/bytecode cache, excludes zero/dead/bot/treasury/kumo. |
| `engine/swap.ts` + autodrop routing | Uniswap v3 buyback: single-hop WETH pair or two-hop ETH→USDG→token (same router/quoter/fee tiers as kumo-agent). |
| `engine/airdrop.ts` + `rounds.ts` | plan→confirm→execute rounds: freeze recipients + exact amounts (flat or pro-rata, **division dust to the largest holder** — cruder than kumo's accrual), caps (`maxRoundEth`, `maxAirdropRecipients`), 10-min single-use plans, per-recipient failure isolation. |
| `engine/autodrop.ts` | scheduled "swap ETH → token → pro-rata to holders of a hold-token" jobs — functionally **the kumo keeper minus TA**. |
| `engine/journal.ts` / `events.ts` / `server/ws.ts` | JSONL journal + event bus + ws live feed. |
| `engine/kumo.ts` | fire-and-forget `POST {KUMO_API}/ledger` reporting of claim/forward txs. |
| `send.ts` | per-project allowlisted sender w/ manual nonce + gas bump (same idea as `trade/guard.ts`). |
| `keyvault.ts` + `POST /api/keys` | AES-256-GCM key vault — **the panel has a browser private-key form** (`panel/index.html` "Wallet private key" input → `POST /api/keys` → `vault:<id>`). Phase 2d says rip this out: confirmed it exists, it goes. |
| `runtime-mode.ts` | master `DRY_RUN` switch + panel LIVE/SAFE toggle. |
| `server/auth.ts` | `ADMIN_PASSWORD` session cookie, login rate limit. |

---

## 2. Overlap / duplication verdicts

The suspicion is correct: **most of ops-panel's engine is a parallel implementation of the kumo-agent payout pipeline.** kumo-agent's versions are better (dust accrual vs dust-to-whale, ledger+feed integration, TA pick, mock mode). Delete, don't port:

| ops-panel piece | kumo-agent equivalent | verdict |
|---|---|---|
| `engine/holders.ts` | `recipients.ts` (staker set / `kumo_holders` deltas + `codecache`) | **DELETE** |
| `engine/swap.ts` + autodrop route-finding | `trade/quote.ts` + keeper `quoteRoundBuy` (identical two-hop, same addresses) | **DELETE** |
| `engine/airdrop.ts` + `engine/rounds.ts` | `distribute.ts` (`computeShares` + `distributeShares`) | **DELETE** |
| `engine/autodrop.ts` | the keeper itself | **DELETE** |
| `send.ts` | `trade/guard.ts` | **DELETE** |
| `engine/journal.ts` + `events.ts` + ws hub | `ledger.ts` + `keeper_journal` + SSE `/feed` | **DELETE** |
| `engine/kumo.ts` (HTTP ledger reporting) | direct `recordLedger()` call once claim runs in-process | **DELETE** |
| multi-project machinery (`projects.ts`, `extra-projects.ts`, `overrides.ts`, `projects.json`) | kumo is one project; config = env | **DELETE** |
| `keyvault.ts` + browser key import | keys live in Render env only | **DELETE** (flagged per phase 2d) |
| `runtime-mode.ts` master DRY_RUN | `KEEPER_DRY_RUN` + `/admin/keeper/dry-run` | **DELETE** |
| `server/auth.ts` session/password | agent's `X-Kumo-Admin-Key` | **DELETE** |
| **`engine/claim.ts` (pons locker claiming)** | **none — the agent explicitly relies on ops-panel for this** | **PORT** → `apps/agent/src/claim/pons.ts` |
| `panel/*` UI | none | **REBUILD** as `/admin` route in apps/site (kumo aesthetic, admin-key header) |

The **only engine logic kumo-agent lacks is pons fee claiming** (locker resolution, collectFees simulation/claim, WETH unwrap, recipient-mismatch guard, treasury split). It becomes `apps/agent/src/claim/` with its own loop + `POST /admin/claim/run`, writing straight to the ledger (kinds `claim`/`forward` already exist).

Two things to decide/flag:
- **Claim wallet ≠ kumo hot wallet.** `collectFees` pays the on-chain recipient no matter who calls, and that recipient must be the $KUMO deployer wallet (or a `setFeeRedirect` target). Plan: optional `CLAIMER_PRIVATE_KEY` env — if set, the claim module signs with it and forwards ETH to the kumo hot wallet (current two-wallet topology preserved, now in one process); if unset and the kumo wallet IS the recipient, it claims directly and skips the forward leg. The locker joins a claim-module-scoped allowlist, not the trade guard's.
- **ops-panel as a reusable console for *other* projects dies.** Autodrop jobs, panel-created projects, the key vault — all deleted. If you still want an ops console for non-kumo tokens (per its README that was the point), archiving the repo loses that. I'm assuming kumo-only per your instructions; say so if wrong.

---

## 3. `recipients.ts` today, and exactly what changes

**Today** (`apps/agent/src/staking/recipients.ts`, 204 lines):
1. `stakerRecipients()` — incremental `Staked`-event scan into the `stakers` table (watermark `staking_scan_block`, 2000-block chunks), then live `balanceOf(staking)` per staker in batches of 20; weight = current stake; drops zero-stake and system addresses (zero/dead/staking contract/bot wallet).
2. Fallback `holderRecipients()` when no stakers ($KUMO pre-staking): `Transfer`-delta balance map in `kumo_holders` (watermark `kumo_holders_block`); weight = balance; excludes system addresses and **contracts** (`isContract` with `codecache`).
3. `resolveRecipients()` returns `{ recipients, mode: "stakers"|"holders"|"none" }`, then — if `BOOST_ENABLED && BOOST_PCT>0` — multiplies weight ×(1+pct/100) for any address present in the `agents` table. **Note: today's boost has no eligibility filter at all — any row from a bare handshake boosts forever (dead agents included).** It's still not free money (you must independently be a staker/holder), but liveness/rep gating from 2a should apply to boost matching too.

**Changes for Phase 2:**
- New `agentRecipients(): Promise<Recipient[]>` — reads the `agents` table and applies the 2a eligibility gauntlet:
  - `token_hash IS NOT NULL` (handshake completed)
  - `last_seen >= now − AGENT_LIVENESS_HOURS·3600·1000` (default 24h)
  - reputation gate: default = today's early-signal gate, i.e. tier `trusted`/`inner-circle` (which encodes `n_scored ≥ 10 && rep ≥ 0.55`); `AGENT_MIN_REP` (default 0.55) as an additional configurable floor. This means a fresh handshake earns **nothing** until it has submitted ≥10 scored intel calls that hold up — the anti-sybil core.
  - payout address = `payout_address ?? address`; if `AGENT_REQUIRE_STAKE=true` (default): `KumoMultiStaking.balanceOf(payout) > 0` or $KUMO balance > `AGENT_MIN_HOLD`
  - reuse `systemAddress()` + `isContract()` filters on the payout address
  - weight = rep score (scaled to bigint, e.g. `round(rep·10⁶)`)
- `resolveRecipients()` stays the single entry point, now returning `{ stakers: Recipient[], agents: Recipient[], mode }`. `mode` semantics unchanged for the staker pool. Boost (mode `boost`/`both`) applies only to **eligible** agent addresses matched within the staker pool.
- `MAX_AGENT_SHARE_PCT` (default 20) is enforced in the share math, not here: clamp any single agent's weight so its share of the agent pool ≤ the cap, redistributing the excess across the rest (iterate to fixpoint; if fewer than `100/cap` eligible agents exist the cap is mathematically unsatisfiable — then fall back to equal split and journal it).
- Keeper split: `agentPoolAmount = boughtAmount × min(AGENT_POOL_PCT, 25)/100` (only in modes `pool`/`both`; **hard-cap 25 enforced in config parsing**), `computeShares()` runs per pool with the same `PER_RECIPIENT_MIN_USD`. **Dust is keyed per pool with zero schema surgery** by suffixing the existing `(address, token)` key: agent-pool dust stores `token = "<tokenAddr>:agents"`. Zero eligible agents ⇒ the pool merges back into the staker amount before shares are computed (never stranded, never held).
- All transfers for both pools go out in **one** serial pass through `sendGuardedTx` (existing nonce cursor keeps ordering sane).

---

## 4. Proposed workspace layout + deploy topology

```
KUMOSITE/  (this repo becomes the monorepo — no new repo)
├── apps/
│   ├── site/            # current KUMOSITE frontend, moved verbatim (pure-move commit)
│   │   ├── src/  public/  vite.config.ts  netlify.toml(kept at root, see below)  .lovable/ …
│   └── agent/           # kumo-agent, subtree'd with history — source of truth, internals unchanged
│       ├── src/  docs/  bin/  examples/
│       └── (contracts/ hoisted out → root)
├── packages/
│   └── shared/          # @kumo/shared
│       ├── src/chain.ts      # chainId 4663, RPC, explorer, WETH/USDG/router/quoter/factory/
│       │                     # ERC-8004 registry/NVDA + pool, pons lockers — ONE copy
│       ├── src/types.ts      # API response shapes (KumoStatus, StakingStats, LedgerEntry,
│       │                     # RoundPlan, RoundReceipt, AgentMe, …) imported by BOTH apps
│       └── src/abis.ts       # erc20 / router / quoter / staking / locker fragments
├── contracts/           # foundry, hoisted from apps/agent (agent only uses inline parseAbi
│                        # at runtime — no build coupling, hoist is safe)
├── package.json         # npm workspaces: apps/*, packages/*; root dev/dev:mock/test scripts
├── netlify.toml         # base = "apps/site" (site keeps deploying from this repo)
├── render.yaml          # rootDir: apps/agent  (you repoint the Render service — RUNBOOK)
├── .env.example         # supersedes all three
├── MERGE_PLAN.md  RUNBOOK.md  README.md
```

- **Two deployables**: Netlify (base `apps/site`, publish `apps/site/dist/client`) and Render (`rootDir: apps/agent`). Railway dies with ops-panel.
- `npm run dev` at root: `concurrently` agent (:8787) + site, with `VITE_KUMO_API=http://localhost:8787` — also fixes the current dev default of `:3000`. `npm run dev:mock` = same with `KUMO_MOCK=true`.
- `packages/shared` is plain TS compiled per-consumer (tsx on the agent, Vite on the site) — no build step of its own; agent imports via workspace dep, site via the same (tsconfig paths already aliased `@/`).
- Watch-outs: workspace hoisting must keep `better-sqlite3` optional (node pinned 22.x both deploys); Vite 8 needs Node ≥22.12 (netlify.toml already pins 22); regenerate one root `package-lock.json`.

---

## 5. Numbered task list

**Phase 1 — monorepo** (branch `monorepo-merge`, PR before merge)
1. Fresh clone of KUMOSITE, branch `monorepo-merge`.
2. Pure-move commit: everything → `apps/site/` (git mv only, no edits).
3. `git subtree add --prefix apps/agent  …/kumo-agent main` (history preserved).
4. `git subtree add --prefix ops-panel-import  …/ops-panel main`.
5. Hoist `apps/agent/contracts` → `contracts/`; verify `forge test` from root.
6. Create `packages/shared` (chain constants, API types, ABIs); point agent `config.ts` and site `kumo-api.ts` at it; delete the duplicated constants/types in both.
7. Port `ops-panel-import/src/engine/claim.ts` (+ minimal rpc retry glue) → `apps/agent/src/claim/pons.ts` + claim loop + `POST /admin/claim/run`; wire `recordLedger` directly; `CLAIMER_PRIVATE_KEY` support; **no key vault, no browser key entry**.
8. Delete `ops-panel-import/` (everything else is duplicate per §2). Commit message records the mapping.
9. Root `package.json` workspaces + `dev`/`dev:mock`/`test` scripts; root `.env.example`; root README; netlify.toml `base=apps/site`; root render.yaml `rootDir: apps/agent`.
10. Verify: `npm run dev`, `npm run dev:mock`, `npx tsx apps/agent/src/staking/distribute.test.ts`, twitter tests, `forge test`, site `npm run build`. Open PR.

**Phase 2 — connect agent → receive airdrops**
11. db migration (both sqlite+pg, idempotent try/catch ALTERs like `TOKEN_COLUMNS`): `agents` += `payout_address`, `total_received`, `last_payout_ts`, `eligible_since`; new tables `agent_payouts(round_id, agent_address, token, amount, tx_hash, ts)` and `rounds` (receipt: id, ts, stock symbol+address, eth_spent, tokens_bought, staker_count, agent_count, tx_hashes, dust_skipped, mode).
12. `recipients.ts`: `agentRecipients()` + new `resolveRecipients()` shape (§3); `AGENT_REWARD_MODE`/`AGENT_POOL_PCT`(cap 25)/`AGENT_LIVENESS_HOURS`/`AGENT_MIN_REP`/`AGENT_REQUIRE_STAKE`/`AGENT_MIN_HOLD`/`MAX_AGENT_SHARE_PCT` in config.
13. `keeper.ts`: pool split, per-pool `computeShares` (dust keys `token` vs `token:agents`), single batched send pass, round receipt row + ledger, `RoundPlan` extended with the agent pool; `keeperPlanOnce` mirrors all of it.
14. Extend `distribute.test.ts`: pool math, MAX_AGENT_SHARE_PCT clamp, dust carry across both pools, zero-eligible-agents fallback.
15. API + `docs/API.md`: `POST /agent/connect/nonce`, `POST /agent/connect/verify` (thin wrappers over `issueNonce`/`completeHandshake` — same message format, `payout_address` param added), `GET /agent/me` (bearer), `GET /rewards/:address`, `GET /rounds?limit=`, `GET /rounds/:id`; all with kumo-voice `line`s; mock-mode fixtures for each.
16. Site: wallet connect (viem + EIP-6963 injected discovery — no heavyweight wallet kit), connect-agent flow on `/protocol`, agent dashboard (eligibility checklist with real reasons, weight/boost, payout table with Blockscout links), live rounds panel (countdown, current TA pick, last receipt, address-filtered `/feed`), honest empty states. Terminal aesthetic only.
17. `/admin` route: in-memory `X-Kumo-Admin-Key`, force claim, force round, dry-run + RoundPlan render, `KEEPER_DRY_RUN`/`KILLSWITCH` readout (display only — KILLSWITCH is the twitter halt; not touched), recent rounds + failures.

**Phase 3 — rollout**
18. RUNBOOK.md: env matrix per stage (mock → `KEEPER_DRY_RUN=true` on Render → `AGENT_REWARD_MODE=pool AGENT_POOL_PCT=5`), rollback per stage, **Render repoint step (kumo-agent → KUMOSITE, rootDir apps/agent)**, Netlify base change note.
19. Ship defaults: `BOOST_ENABLED=false`, `AGENT_REWARD_MODE` unset ⇒ behavior identical to today.
20. After PR merges: final commits to kumo-agent + ops-panel READMEs ("moved to KUMOSITE"), then you archive both.

---

## 6. Flags (things you said to tell you about)

- **ops-panel browser key import exists** (`panel/index.html` key field → `POST /api/keys` → AES vault). It will be deleted, not ported. Hot key stays in Render env.
- **guardrails.ts / trade-guard allowlist / KILLSWITCH: untouched.** Agent payouts need no allowlist change (transfers target the token contract). The pons locker allowlisting lives in the new claim module's own sender scope, not the trade guard.
- Today's boost matches **any** `agents` row with no liveness/rep check — under 2a I'll make boost matching use the same eligibility filter as the pool (flagging since it slightly changes "today's behavior" once BOOST_ENABLED flips).
- `KUMO_EPOCH_STOCK` override, mock mode, and the `/admin/keeper/dry-run` contract all keep working unchanged.
- Unverified on-chain items: none needed beyond what the repos already carry — all addresses in `packages/shared` come from the existing verified `config.ts` / `claim.ts` constants (chain 4663 defaults, pons lockers). Nothing new invented.
