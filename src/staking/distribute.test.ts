// share-math assertions: `npx tsx src/staking/distribute.test.ts`
import { computeShares } from "./distribute.js";
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

if (failed > 0) {
  console.error(`\n${failed} share-math case(s) FAILED`);
  process.exit(1);
}
console.log("\nall share-math cases passed");
