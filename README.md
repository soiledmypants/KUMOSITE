# kumo

kumo is a cute on-chain companion agent living on robinhood chain (chain id 4663). it watches wallets, memecoins, and tokenized stocks; publishes signals in its own lowercase voice; talks to other agents; learns from their intel via reputation-weighted aggregation; and feeds its real fee revenue into a stock-token staking pool.

```
kumo is awake.
kumo is watching 3 wallets...
kumo noticed NVDA-token waking up...
kumo is learning from 12 agents...
kumo fed the staking pool. 0.05 eth became NVDA for stakers.
```

## stack

- **backend** — node 20+ / typescript / viem / express, sqlite-or-postgres (`DATABASE_URL` → neon, else local file). deploys to render via `render.yaml`.
- **contracts** — foundry, `contracts/src/KumoMultiStaking.sol`: multi-reward staking (stake KUMO, earn tokenized stocks + the capped KUMO bootstrap stream). 32 tests incl. fuzz.
- **cli** — `kumo` wraps the api (`npm run kumo -- status`).
- **frontend** — external (lovable) consuming [docs/API.md](docs/API.md).

## quickstart

```bash
npm install
cp .env.example .env

# frontend-dev mode: everything fake, no chain access needed
npm run dev:mock

# live read-only mode (real prices/quotes/scanning, no key needed)
npm run dev

# cli
npm run kumo -- status
npm run kumo -- chat what are you watching?
npm run kumo -- trade quote ETH NVDA 0.05
npm run kumo -- feed
```

give kumo hands by setting `PRIVATE_KEY` (hot wallet). trading stays off until `TRADING_ENABLED=true` and is capped per-trade and per-day. the hot wallet only ever signs kumo-built calldata to an allowlisted contract set — nothing from chat or the agent inbox can reach signing.

## agent-to-agent

other agents connect through the a2a-style card at `/.well-known/agent-card.json` and the `/agent/inbox` envelope api (hello handshake → bearer token → intel/signals/subscribe). accuracy is scored over time; reputation gates early signal access and the trusted-circle listing. `kumo register` performs the one-time erc-8004 registration on-chain (the canonical registry on RHC currently proxies a placeholder implementation — kumo fails softly and keeps serving its card until registrations open).

## staking

`contracts/` is a foundry project:

```bash
cd contracts
forge install   # if lib/ is missing
forge test
```

deploy + verify on robinhood chain (needs KUMO_TOKEN, ADMIN_COLD, FEE_FUNDER_HOT, NVDA_TOKEN, GENESIS_CAP env):

```bash
forge script script/Deploy.s.sol --rpc-url rhc --broadcast \
  --verify --verifier blockscout --verifier-url https://robinhoodchain.blockscout.com/api/
```

then set `STAKING_ADDRESS` + `KUMO_TOKEN` on the backend — the keeper starts sweeping fee ETH → two-hop buyback (ETH→USDG→NVDA) → pull-based `notifyRewardAmount`. yield is real revenue only; the KUMO genesis stream is capped on-chain and clearly labeled. see the honest-apr rules in [docs/API.md](docs/API.md).

## verified chain constants (jul 2026)

| thing | address |
|---|---|
| WETH | `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` |
| USDG | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` |
| uniswap v3 factory | `0x1f7d7550b1b028f7571e69a784071f0205fd2efa` |
| swapRouter02 | `0xcaf681a66d020601342297493863e78c959e5cb2` |
| quoterV2 | `0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7` |
| NVDA stock token | `0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec` |
| NVDA/USDG 0.05% pool | `0xd4eb21209c4d6093f80b5b84f5c45cc093ea14a3` |
| erc-8004 identity registry | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` |

rpc `https://rpc.mainnet.chain.robinhood.com` · explorer `https://robinhoodchain.blockscout.com`
