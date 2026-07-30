# Deploying ops-panel to Railway (click-by-click)

One service, one volume. The Dockerfile in the repo root is picked up automatically.

## 1. Create the project

1. Go to https://railway.app → log in (GitHub account).
2. Click **New Project** → **Deploy from GitHub repo**.
3. If Railway hasn't seen your GitHub yet: **Configure GitHub App** → grant access to `soiledmypants/ops-panel` (private repos need this).
4. Select **soiledmypants/ops-panel**. Railway detects the Dockerfile and starts a build — the FIRST deploy will crash-loop until the variables below exist. That's expected.

## 2. Set variables

Click the service → **Variables** tab → **Raw Editor** and paste (then fill in the values):

```
ADMIN_PASSWORD=<long random password — this is the panel login>
KEY_SECRET=<long random string — encrypts imported keys; losing it = imported keys unrecoverable>
DRY_RUN=true
DATA_DIR=/data

PRIVATE_KEY=<claim wallet key for the pons project>
TOKEN_ADDRESS=<your pons token CA>
TREASURY_WALLET=<treasury address>
KUMO_WALLET=<kumo agent hot wallet>
HOLDERS_START_BLOCK=<block your token launched at (Blockscout token page → creation tx) — speeds up the first holder scan>

KUMO_API=https://api.imkumoagent.com
KUMO_ADMIN_KEY=<kumo admin key — every successful claim/forward tx is reported to kumo's ledger; leave both unset to disable>
```

Notes:
- `PORT` is injected by Railway automatically — do not set it.
- Keep `DRY_RUN=true` until the panel's dry runs look right (step 6).
- Optional tuning vars (defaults in parentheses): `SESSION_TTL_HOURS` (24), `MAX_FEE_GWEI` (50), `MAX_PRIORITY_GWEI` (2), `GAS_BUMP_PCT` (25), `TX_WAIT_MS` (90000), `PUBLIC_STATS` (false).

## 3. Attach the volume (journal + holder index + key vault live here)

1. Right-click the service (or the **⋮** menu) → **Attach Volume** (Command Palette: `⌘K` → "volume").
2. Mount path: **/data**. Size: 1 GB is plenty.
3. This must match `DATA_DIR=/data` from step 2.

## 4. Expose it

1. Service → **Settings** → **Networking** → **Generate Domain**.
2. Pick the suggested `*.up.railway.app` domain (or add a custom one).

## 5. First login

1. Open the generated URL — you should see the `OPS-PANEL // AUTH` login.
2. Log in with `ADMIN_PASSWORD`.
3. Dashboard should show your wallet balances and (if the token is launched and `TOKEN_ADDRESS` is set) the live claimable amount. The `MASTER DRY RUN` badge should be visible in the header.

## 6. Go live (when ready)

1. Run a few dry actions from the panel: FORCE FEE CLAIM (dry), SNAPSHOT, PLAN ROUND (dry) — check the live feed and `/api/journal`.
2. Variables → set `DRY_RUN=false` → Railway redeploys.
3. Do one tiny live round with small caps (`maxRoundEth` in projects.json is the hard ceiling) and verify the txs on Blockscout.

## Redeploys / updates

Every `git push` to `main` auto-deploys. The volume (journal, holder DBs, imported keys) survives deploys; sessions don't (you just log in again).

## Troubleshooting

- **Crash loop, log says `ADMIN_PASSWORD env var is required`** — step 2 not done.
- **`project "pons": tokenAddress is empty`** — set `TOKEN_ADDRESS` (or remove the project from projects.json until launch).
- **`fee recipient is 0x…, not the bot wallet`** — the panel stays up but live claiming is disabled; run with the recipient wallet's key or call `setFeeRedirect` (message in the dashboard tells you exactly which wallet).
- **Holder snapshot slow the first time** — it scans Transfer events from `HOLDERS_START_BLOCK`; set it near the token's launch block, not 0.
