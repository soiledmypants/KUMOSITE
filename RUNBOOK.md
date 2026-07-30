# RUNBOOK — kumo monorepo ops

The hot wallet is `0x86832C96F302834771F751db7e8D2B04367F0322`. Its key lives ONLY
in your local `.env` and the Render dashboard (`PRIVATE_KEY`). Never in git, never
in chat, never in logs. `npm run wallet:check` refuses any other key.

---

## 0. one-time: repoint the deploys at this repo

**Render (the agent — do this yourself):**
1. Render dashboard → the `kumo-agent` service → Settings → Build & Deploy.
2. Change the connected repo from `soiledmypants/kumo-agent` to `soiledmypants/KUMOSITE`.
3. Set **Root Directory** = `apps/agent` (render.yaml at the repo root already declares
   this + the workspace-aware build command; a Blueprint sync picks it up).
4. Confirm env vars survived the repoint (they live on the service, not the repo):
   `PRIVATE_KEY`, `KUMO_ADMIN_KEY`, `DATABASE_URL`, `ANTHROPIC_API_KEY`, and the rest
   of the matrix below.
5. Manual deploy → watch logs for the boot line:
   `kumo's hands are attached. wallet 0x8683...0322. …` — if the address in that line
   is anything else, STOP and fix `PRIVATE_KEY` before going further.

**Netlify (the site):** nothing to repoint — same repo as before. The root
`netlify.toml` now sets `base = apps/site`. If the UI has an explicit base/publish
override from the old layout, clear it so the toml wins.

**Afterwards:** archive `kumo-agent` and `ops-panel` on GitHub (final commit adds a
"moved to KUMOSITE" note to each README — done as the last step after the PR merges).

---

## 1. hot-wallet go-live env vars (Render dashboard)

| var | value | note |
|---|---|---|
| `PRIVATE_KEY` | (dashboard only) | must derive `0x8683...0322` — boot line confirms |
| `CLAIMER_PRIVATE_KEY` | (optional, dashboard only) | pons deployer wallet; unset → PRIVATE_KEY claims |
| `KUMO_ADMIN_KEY` | generated | admin routes + site /admin panel |
| `DATABASE_URL` | neon postgres url | sqlite fallback is for local only |
| `KUMO_TOKEN` | $KUMO CA | once launched |
| `STAKING_ADDRESS` | KumoMultiStaking CA | once deployed |
| `GAS_RESERVE_ETH` | `0.02` | keeper never spends below this |
| `DISTRIBUTE_MIN_ETH` | `0.05` | below → "saving up" |
| `CYCLE_MINUTES` | `10` | keeper cadence |

Local verification before trusting any of it:

```bash
npm run wallet:check
```

prints address + ETH/WETH/USDG/stock balances, confirms EOA, hard-fails on the
wrong key. Then `GET /admin/wallet` (admin key) gives the same view from the
running agent, plus gas-reserve status and the last sweep.

---

## 2. rollout stages (phase 3)

Ship state = stage 0. Each stage lists the env delta, what to watch, and the rollback.
All flips are Render env-var changes — the service restarts in seconds, no rebuild.

### stage 0 — ship (behavior identical to today)
```
BOOST_ENABLED=false
# AGENT_REWARD_MODE unset  -> stakers-only
KEEPER_DRY_RUN=false        # keeper live, but inactive until STAKING_ADDRESS/KUMO_TOKEN set
CLAIM_ENABLED=false
CLAIM_DRY_RUN=true
```
Watch: `/status`, boot wallet line, site renders.
Rollback: none needed — this IS the baseline.

### stage 1 — full mock rehearsal (local)
```bash
npm run dev:mock
```
Everything fake, no rpc, no keys. Walk the whole site flow (staking page, ledger,
connect-agent once phase 2 lands). Rollback: n/a (nothing real).

### stage 2 — keeper dry-run on Render (real balances, zero sends)
```
KEEPER_DRY_RUN=true
CLAIM_ENABLED=true          # optional: claims also rehearse
CLAIM_DRY_RUN=true
```
Watch several planned rounds: `POST /admin/keeper/dry-run` (or the /admin panel once
phase 2d lands) — check `phase`, `planned_buy.impact_pct`, `planned_distribution`
recipients/dust, and that `wallet` is `0x8683...0322`. The scheduled cycles journal
with a `dry-run:` prefix.
Rollback: `KEEPER_DRY_RUN=false` returns to stage 0 semantics (still inactive until
the CAs are set).

### stage 3 — claims live, payouts still rehearsing
```
CLAIM_DRY_RUN=false         # pons fees start landing in the hot wallet for real
KEEPER_DRY_RUN=true         # rounds still plan-only
```
Watch: `/ledger?kind=claim` + `kind=forward` entries with real tx hashes; hot-wallet
ETH climbing on `GET /admin/wallet`.
Rollback: `CLAIM_DRY_RUN=true` (claims stop instantly; nothing else changes).

### stage 4 — first live rounds, small agent pool
```
KEEPER_DRY_RUN=false
AGENT_REWARD_MODE=pool
AGENT_POOL_PCT=5
```
Watch the first live round end-to-end: `/rounds/:id` receipt (buy tx, staker count,
agent count, dust skipped), Blockscout links, `agent_payouts` rows, no failed
transfers in the journal.
Rollback (in order of severity):
1. `AGENT_REWARD_MODE=` (unset) → stakers-only, agent pool off, rounds continue.
2. `KEEPER_DRY_RUN=true` → all sending stops, planning continues.
3. `CLAIM_DRY_RUN=true` + `KEEPER_DRY_RUN=true` → fully passive, funds sit in the
   hot wallet untouched.

### stage 5 — steady state
```
AGENT_REWARD_MODE=pool (or both)   AGENT_POOL_PCT=10   BOOST_ENABLED=true (if desired)
```
Same rollback ladder as stage 4.

---

## 3. incident quick refs

- **wrong wallet in the boot line** → fix `PRIVATE_KEY` in Render, redeploy. Never
  paste keys anywhere but the dashboard/.env.
- **feeRedirects hijack / claim recipient mismatch** → the claim module disables
  live claiming by itself and reports the reason on `GET /admin/claim/status`.
  Verify on Blockscout who `feeRedirects[$KUMO]` points at before re-enabling.
- **stuck round / bad stock pick** → `KUMO_EPOCH_STOCK=<address>` pins the pick;
  `KEEPER_DRY_RUN=true` stops sends while you look.
- **twitter misbehaving** → `KILLSWITCH=true` halts all posting (checked before
  every post). Unrelated to payouts.

## 4. twitter persona env

kumo's account is [@imkumoagent](https://x.com/imkumoagent). When enabling posting
on Render, set `TWITTER_ALLOWED_LINK_HOSTS=imkumoagent.com` — the guardrails strip
any tweet containing a link to any other host (empty = no links at all). Keep
`TWITTER_DRY_RUN=true` until composed output has been reviewed in the logs.
