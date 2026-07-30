# ops-panel

Reusable on-chain ops console + engine for EVM token projects (built for Robinhood Chain 4663, works on any EVM chain via `projects.json`). One Node process serves:

- **engine** — pons.family fee claiming (scheduled loop), ERC-20 holder snapshots (Transfer-event indexer), Uniswap v3 buybacks (SwapRouter02), batch airdrop rounds (ETH or token, flat or pro-rata)
- **panel** — password-gated dark-terminal web console: dashboard with live WebSocket feed, holders table, round trigger with confirm modal, encrypted key vault

Phase 1 of this repo was the standalone pons fee-claimer; its claim loop is unchanged, now per-project under `src/engine/claim.ts`.

## How pons fees work (verified on-chain)

pons tokens trade in Uniswap V3 pools quoted against WETH — no bonding curve. Creator fees accrue **inside the token's locked LP position** as two ERC20s: **WETH + the token itself** (never native ETH). Claimed per-token via `collectFees(address)` on the verified `PonsLaunchLocker`:

| generation | locker | protocol share |
|---|---|---|
| current (block 8991118+) | `0x736D76699C26D0d966744cAe304C000d471f7F35` | 30% |
| legacy (block 8600612+) | `0x31ca5E101941A93A7DD6d0497928700625CF54B5` | 10% |

`collectFees` **always pays the on-chain recipient** (`feeRedirects[token]` falling back to the deployer) no matter who calls, so the project's key must derive that wallet — verified at boot, live claiming disabled (loudly) otherwise. Claimable is read by simulating `collectFees` via `eth_call`.

## Architecture

```
src/
  config.ts      global env config (PORT, DRY_RUN master, ADMIN_PASSWORD, KEY_SECRET, DATA_DIR, gas)
  projects.ts    projects.json loader → per-project clients/sender/caps (${ENV_VAR} interpolation)
  keyvault.ts    AES-256-GCM encrypted key store (data/keys.json, scrypt(KEY_SECRET))
  send.ts        per-project allowlisted sender: manual nonce + same-nonce gas-bump resend
  engine/        claim | holders | swap | airdrop | rounds | journal (JSONL) | events (bus)
  server/        auth (session cookie + login rate limit) | api | ws hub | http
panel/           no-build static console: index.html, app.js, style.css, ws.js
```

Security model:
- `ADMIN_PASSWORD` required to boot; session cookie (httpOnly, SameSite=Lax, Secure behind https); login rate-limited (5 fails → 15 min lockout); every `/api/*` route and the ws handshake check the session.
- Sends are **hard-allowlisted** per project: locker, WETH, token, treasury, kumo, router — plus, only while a round executes, that round's frozen recipient set. There is no free-form send endpoint.
- Caps: `maxRoundEth`, `maxAirdropRecipients`, `maxForwardEth`, `gasReserveEth` per project.
- `DRY_RUN=true` (default) is a master switch: every action logs what it would do, sends nothing, regardless of panel flags.
- Imported keys: encrypted at rest (AES-256-GCM via `KEY_SECRET`), never logged, never returned to the client — only the derived address. Env-var keys remain the primary path (`keyRef: "env:PRIVATE_KEY"`).

## Rounds

`[ TRIGGER ROUND ]` = plan → confirm → execute:
1. **plan** freezes the recipient set (latest snapshot, minBalance/topN filters) and exact per-recipient amounts, quotes the optional buyback, estimates gas, enforces caps — returned to the confirm modal.
2. **execute** re-validates (plans expire after 10 min, single-use), optionally buys the token with the ETH budget (actual swap output re-split, not the quote), then batch-sends with per-recipient failure isolation. Live progress streams over the ws feed; every tx lands in the append-only journal.

## Run locally

```bash
npm install
cp .env.example .env   # fill in at minimum ADMIN_PASSWORD + the pons project vars
npm run dev            # panel on http://localhost:8787, DRY_RUN by default
```

## Deploy

Railway — see **RAILWAY.md** for the click-by-click (Dockerfile build, volume at `/data`, env vars, domain).

## Endpoints

`GET /health` (public) · panel at `/` · ws at `/ws` · REST under `/api/*` (session-gated): projects, status, claim, snapshot, holders, rounds plan/execute, journal, stats, keys.
