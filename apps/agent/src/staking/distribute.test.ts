// share-math assertions: `npx tsx src/staking/distribute.test.ts`
import { computeShares, splitPoolAmount, clampWeights, dustKey } from "./distribute.js";
import type { Recipient } from "./recipients.js";

let failed = 0;
const check = (label: string, cond: boolean) => {
  console.log(`${cond ? "ok " : "FAIL"} ${label}`);
  if (!cond) failed++;
};

const A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
const B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const;
const C = "0xcccccccccccccccccccccccccccccccccccccccc" as const;

// 1. pro-rata: weights 1:3, no dust threshold
{
  const recipients: Recipient[] = [
    { address: A, weight: 100n, boosted: false },
    { address: B, weight: 300n, boosted: false },
  ];
  const r = computeShares(recipients, 4_000_000n, 100, 18, 0, new Map());
  check("pro-rata 1:3 split", r.paid.length === 2 && r.paid[0].amount === 1_000_000n && r.paid[1].amount === 3_000_000n);
  check("total conserved", r.totalPaid === 4_000_000n);
}

// 2. dust guard: tiny share skips and accrues; big share pays
{
  const recipients: Recipient[] = [
    { address: A, weight: 1n, boosted: false }, // ~0.0001% -> dust
    { address: B, weight: 999_999n, boosted: false },
  ];
  // token worth $100/unit, 18 decimals, min $0.25 -> minRaw = 0.0025 * 1e18
  const total = 10n ** 18n; // 1 token = $100
  const r = computeShares(recipients, total, 100, 18, 0.25, new Map());
  check("tiny share skipped as dust", r.skipped.length === 1 && r.skipped[0].address === A && r.skipped[0].accrued > 0n);
  check("big share paid", r.paid.length === 1 && r.paid[0].address === B);
}

// 3. carried dust pushes a recipient over the threshold
{
  const recipients: Recipient[] = [
    { address: A, weight: 1n, boosted: false },
    { address: B, weight: 999n, boosted: false },
  ];
  const total = 10n ** 15n; // small round
  const minRaw = (25n * 10n ** 14n) / 1000n; // $0.25 at $100/unit = 0.0025 token
  const carried = new Map<string, bigint>([[A.toLowerCase(), 10n ** 16n]]); // big prior dust
  const r = computeShares(recipients, total, 100, 18, 0.25, carried);
  const aPaid = r.paid.find((p) => p.address === A);
  check("carried dust pays out once over threshold", Boolean(aPaid && aPaid.amount > 10n ** 16n && aPaid.dustCarried === 10n ** 16n));
  check("minRaw sanity", minRaw > 0n);
}

// 4. boost affects weights upstream (weight already multiplied) — conservation only
{
  const recipients: Recipient[] = [
    { address: A, weight: 110n, boosted: true }, // 100 * 1.10
    { address: B, weight: 100n, boosted: false },
    { address: C, weight: 100n, boosted: false },
  ];
  const r = computeShares(recipients, 310_000n, 1, 18, 0, new Map());
  check("boosted recipient gets more", r.paid[0].amount > r.paid[1].amount);
  check("sum <= total (round-down)", r.totalPaid <= 310_000n);
}

// 5. zero cases
{
  const r = computeShares([], 1000n, 1, 18, 0, new Map());
  check("no recipients -> nothing", r.paid.length === 0 && r.totalPaid === 0n);
  const r2 = computeShares([{ address: A, weight: 1n, boosted: false }], 0n, 1, 18, 0, new Map());
  check("zero amount -> nothing", r2.paid.length === 0);
  const r3 = computeShares([{ address: A, weight: 5n, boosted: false }], 1000n, 0, 18, 0.25, new Map());
  check("unknown price -> min disabled, still pays", r3.paid.length === 1);
}

// 6. the hot wallet (and other system addresses) never receive airdrops
{
  const { systemAddress } = await import("./recipients.js");
  const fakeBot = "0x1111111111111111111111111111111111111111";
  check("hot wallet excluded from recipients", systemAddress(fakeBot, fakeBot));
  check("hot wallet exclusion is case-insensitive", systemAddress(fakeBot.toUpperCase().replace("0X", "0x"), fakeBot));
  check("zero address excluded", systemAddress("0x0000000000000000000000000000000000000000", fakeBot));
  check("dead address excluded", systemAddress("0x000000000000000000000000000000000000dead", fakeBot));
  check("normal staker not excluded", !systemAddress(A, fakeBot));
}

// 7. agent pool split: pct carve-out, hard cap, zero-agents fallback
{
  const s1 = splitPoolAmount(10_000n, 10, 5);
  check("pool split 10% carved", s1.agentAmount === 1_000n && s1.stakerAmount === 9_000n);
  const s2 = splitPoolAmount(10_000n, 40, 5); // over the hard cap
  check("pool pct hard-capped at 25", s2.agentAmount === 2_500n);
  const s3 = splitPoolAmount(10_000n, 10, 0); // nobody eligible
  check("zero eligible agents -> pool reverts to stakers", s3.agentAmount === 0n && s3.stakerAmount === 10_000n);
  const s4 = splitPoolAmount(0n, 10, 5);
  check("zero total -> zero pool", s4.agentAmount === 0n && s4.stakerAmount === 0n);
}

// 8. MAX_AGENT_SHARE_PCT clamping
{
  const whale: Recipient[] = [
    { address: A, weight: 1_000_000n, boosted: false }, // would take ~91%
    { address: B, weight: 50_000n, boosted: false },
    { address: C, weight: 50_000n, boosted: false },
    { address: "0xdddddddddddddddddddddddddddddddddddddddd", weight: 50_000n, boosted: false },
    { address: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", weight: 50_000n, boosted: false },
  ];
  const clamped = clampWeights(whale, 20);
  const total = clamped.reduce((a, r) => a + r.weight, 0n);
  const whaleShare = Number((clamped[0].weight * 10_000n) / total) / 100;
  check("single agent clamped to ~max share", whaleShare <= 21);
  check("clamp conserves the others", clamped[1].weight === 50_000n);
  // unsatisfiable cap (2 agents, 20% max) -> equal split fallback
  const two = clampWeights(
    [
      { address: A, weight: 900n, boosted: false },
      { address: B, weight: 100n, boosted: false },
    ],
    20,
  );
  check("unsatisfiable cap -> equal split", two[0].weight === two[1].weight);
}

// 9. dust keys are pool-scoped: same address+token never collides across pools
{
  const t = "0xD0601ce157DB5bdc3162bbAC2A2c8AF5320d9EEC";
  check("staker dust key is the bare token", dustKey(t) === t.toLowerCase());
  check("agent dust key is suffixed", dustKey(t, "agents") === `${t.toLowerCase()}:agents`);
  check("keys differ", dustKey(t, "stakers") !== dustKey(t, "agents"));
}

// 10. dust carry stays inside its pool: agent dust re-adds only via the agent map
{
  const rec: Recipient[] = [{ address: A, weight: 100n, boosted: false, agent: "0xagent" } as Recipient];
  const agentDust = new Map<string, bigint>([[A.toLowerCase(), 500n]]);
  const withDust = computeShares(rec, 1_000n, 0, 18, 0, agentDust);
  const withoutDust = computeShares(rec, 1_000n, 0, 18, 0, new Map());
  check("agent-pool dust re-added in its own pool", withDust.paid[0].amount === 1_500n);
  check("staker pass unaffected without its own dust", withoutDust.paid[0].amount === 1_000n);
  check("agent identity carried onto the share", withDust.paid[0].agent === "0xagent");
}

if (failed > 0) {
  console.error(`\n${failed} share-math case(s) FAILED`);
  process.exit(1);
}
console.log("\nall share-math cases passed");
