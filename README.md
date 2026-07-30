# KUMOSITE — the kumo monorepo

kumo is a cute on-chain companion living on Robinhood Chain (4663). this repo is
everything kumo: the site, the agent, the shared types, and the staking contract.

```
apps/site/        the frontend (TanStack Start, static prerender) -> Netlify
apps/agent/       the agent (express + viem + scanners + payout keeper) -> Render
packages/shared/  chain constants + wire types + abi fragments (single copy, both apps import it)
contracts/        foundry — KumoMultiStaking
MERGE_PLAN.md     how three repos became one
RUNBOOK.md        env matrix + rollout/rollback per stage
```

## dev

```bash
npm install          # workspaces: shared builds automatically (prepare)
npm run dev          # agent on :8787 + site, wired together
npm run dev:mock     # same, but the agent serves believable fixtures (no rpc, no keys)
```

## tests

```bash
npm test             # share-math + twitter guardrail/pipeline tests
npm run typecheck    # agent typecheck (builds shared first)
forge test           # from contracts/ (needs foundry + forge install)
```

## deploys (two, both from this repo)

- **site** — Netlify, `netlify.toml` at root: `base = apps/site`, publish `dist/client`.
- **agent** — Render, `render.yaml` at root: `rootDir: apps/agent`. the service
  originally watched the old kumo-agent repo — see RUNBOOK.md for the repoint.

history note: `apps/agent` and the (since absorbed, now deleted) `ops-panel-import`
were merged in via `git subtree` — their full histories live in this repo's log.
the old kumo-agent and ops-panel repos are archived.
