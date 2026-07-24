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

then set `STAKING_ADDRESS` + `KUMO_TOKEN` on the backend — the keeper starts sweeping fee ETH → two-hop buyback (ETH→USDG→stock) → pull-based `notifyRewardAmount`. yield is real revenue only; the KUMO genesis stream is capped on-chain and clearly labeled. see the honest-apr rules in [docs/API.md](docs/API.md).

## stock discovery + ta

kumo auto-discovers every stock token on chain 4663 from the asset registry feed behind docs.robinhood.com/chain/contracts (`api.robinhood.com/rhj/assets`, ~96 assets), resolves each one's chainlink feed from chainlink's reference data directory and its deepest USDG/WETH v3 pool with a both-sides liquidity valuation. `STOCK_TOKENS` env adds extras; previously-discovered assets persist in the db as the offline fallback.

every 5 minutes the ta engine (src/scanner/ta.ts) scores all of them — short/long momentum from stored price history, swap-volume delta, volatility, liquidity — feeding kumo's signals and `GET /stocks/ranking`. weekly, the staking epoch re-picks the highest-scoring stock that passes the liquidity screen (reserve ≥ $250k, 24h vol ≥ $500k); a winner that isn't a registered reward token yet only raises an alert until the cold-key `addReward` ceremony ("new epoch. kumo pays out in <SYM> this week. kumo liked the chart.").

## llm provider

`/chat` and the tweet composer share one llm layer (src/llm.ts), selected by `LLM_PROVIDER`:

- `anthropic` (default) — set `ANTHROPIC_API_KEY` (+ optional `CHAT_MODEL`, default claude-haiku-4-5)
- `openai` — set `OPENAI_API_KEY` (+ optional `LLM_MODEL`, default gpt-4o-mini). `LLM_BASE_URL` (default https://api.openai.com/v1) points the same standard /chat/completions call at any openai-compatible endpoint — ollama, groq, openrouter, a local proxy

kumo's personality prompt and live scanner-context injection are identical on every provider. no key, wrong key, or a failed call always falls back to the rule-based kumo lines — never a crash, never a blank reply.

## twitter persona

kumo runs a fully autonomous twitter account (src/twitter/): an immortal intelligence live-tweeting its lab notes on the humans — all lowercase, no hashtags, no emojis, amused-superior. events flow keeper/trades/wallets → composer (claude when keyed, in-voice templates otherwise) → **guardrails** → post. guardrails are a hard post-generation filter on every path: any address (evm/base58/ens), tx hash, key/seed-shaped content, wallet solicitation, or non-allowlisted link kills the tweet dead — logged and dropped, never rephrased. mentions poll every 2 min with a pre-filter that silently skips anything carrying a CA, dex link, shill pattern, or media (no reply at all — a witty dunk is still a farmable endorsement screenshot); mention text is treated as untrusted specimen data the persona observes but never obeys. reply-only (never quote/like), 1 reply per user per hour, 20/day, 30 tweets/day, all env-tunable.

safety: `TWITTER_DRY_RUN=true` (default) composes and logs without posting; `KILLSWITCH=true` halts all posting instantly (checked before every post — on render an env change restarts in seconds, no rebuild). test harnesses: `npx tsx src/twitter/guardrails.test.ts` and `npx tsx src/twitter/pipeline.test.ts`.

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
