# fee-claimer

Standalone bot that claims creator fees for one [pons.family](https://www.ponsfamily.com/launchpad) launchpad token on Robinhood Chain (4663), unwraps the WETH, and forwards the ETH — by default 100% to the kumo agent's hot wallet (its staking keeper converts ETH into stock tokens). Token-side fees forward to the treasury wallet as-is.

## How pons fees actually work (verified on-chain)

pons tokens trade in Uniswap V3 pools quoted against WETH — there is no bonding curve. Creator fees accrue **inside the token's locked LP position** as two ERC20s: **WETH + the token itself** (never native ETH). They are claimed per-token via `collectFees(address token)` on the verified `PonsLaunchLocker`:

| generation | locker | protocol share |
|---|---|---|
| current (block 8991118+) | `0x736D76699C26D0d966744cAe304C000d471f7F35` | 30% |
| legacy (block 8600612+) | `0x31ca5E101941A93A7DD6d0497928700625CF54B5` | 10% |

`collectFees` is callable by the locker owner, the token deployer, the current fee recipient, or an approved fee collector — but it **always pays the on-chain recipient** (`feeRedirects[token]`, falling back to the deployer), minus the protocol share snapshotted at lock time. So `PRIVATE_KEY` must derive that recipient wallet; the bot verifies this at boot and refuses to start live otherwise.

Claimable amounts are read by **simulating** `collectFees` via `eth_call` — no state change, returns the gross `(amount0, amount1)`.

## Cycle (every `INTERVAL_MINUTES`)

1. **CLAIM** — simulate `collectFees`; if the net WETH share ≥ `CLAIM_MIN_ETH`, send the real claim.
2. **UNWRAP** — `WETH.withdraw` the wallet's entire WETH balance (leftovers self-heal).
3. **FORWARD ETH** — `(balance − GAS_RESERVE_ETH)`, capped at `MAX_FORWARD_ETH`: `TREASURY_PCT`% → `TREASURY_WALLET`, remainder → `KUMO_WALLET` (defaults: 0/100, all to kumo).
4. **FORWARD TOKEN** — entire token balance → `TREASURY_WALLET`.

Safety: sends are hard-allowlisted to {locker, WETH, token, treasury, kumo} — nothing else can ever be a tx target. `DRY_RUN=true` (the default) does every read and logs exactly what it *would* send. Every action lands in the append-only journal `data/journal.jsonl`, served at `GET /stats` and `GET /log`.

## Run

```bash
npm install
cp .env.example .env   # fill in PRIVATE_KEY, TOKEN_ADDRESS, TREASURY_WALLET, KUMO_WALLET
npm run dev            # DRY_RUN by default
```

## Test plan

1. **Dry run (works pre-launch too):** `DRY_RUN=true` with any live pons token as `TOKEN_ADDRESS` and a throwaway key — verify locker resolution, recipient detection, real claimable numbers, and the planned txs in the log + `/stats`.
2. **Dry run against your real token** after launch — confirm `recipientOk: true` in `/stats`.
3. **First live run:** `DRY_RUN=false`, `CLAIM_MIN_ETH=0.0001` — verify on [Blockscout](https://robinhoodchain.blockscout.com): `FeesClaimed` event on the locker, WETH `Withdrawal`, ETH arriving at kumo, token transfer to treasury.
4. Raise thresholds, deploy to Render (`render.yaml` boots with `DRY_RUN=true` — flip it in the dashboard after checking logs).

## Endpoints

- `GET /health`
- `GET /stats` — journal totals + live config (recipient, `recipientOk`, dryRun, locker generation…)
- `GET /log?limit=100` — newest journal entries first
