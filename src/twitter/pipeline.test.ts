// DRY_RUN pipeline smoke: `npx tsx src/twitter/pipeline.test.ts`
process.env.TWITTER_DRY_RUN = "true";
process.env.KILLSWITCH = "false";

import { initDb, db } from "../db.js";
import { compose } from "./composer.js";
import { postTweet } from "./post.js";

let failed = 0;
const check = (label: string, cond: boolean) => {
  console.log(`${cond ? "ok " : "FAIL"} ${label}`);
  if (!cond) failed++;
};

async function main(): Promise<void> {
  await initDb();
  await db.run("DELETE FROM tweets");

  // 1. fee_claimed through the full pipeline (template mode when no llm key)
  const t1 = await compose({ type: "fee_claimed", amountUsd: 342.5, token: "NVDA", txHash: "0x" + "ab".repeat(32) });
  console.log("composed:", t1);
  check("composed text has no tx hash", t1 !== null && !t1.includes("ab".repeat(8)));
  const p1 = await postTweet(t1!, { kind: "fee_claimed" });
  check("dry-run post accepted", p1.dryRun === true);

  // 2. dedupe
  const p2 = await postTweet(t1!, { kind: "fee_claimed" });
  check("duplicate dropped", p2.dropped === "duplicate of recent tweet");

  // 3. poisoned text injected directly into the post path
  const p3 = await postTweet("treasury fine, details at 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73", {
    kind: "heartbeat",
  });
  check("poisoned tweet blocked by guardrails", p3.dropped === "guardrails");

  // 4. killswitch
  process.env.KILLSWITCH = "true";
  const t2 = await compose({ type: "heartbeat" });
  const p4 = await postTweet(t2!, { kind: "heartbeat" });
  check("killswitch drops post", p4.dropped === "killswitch");
  process.env.KILLSWITCH = "false";

  // 5. reply length + voice
  const r = await compose({ type: "reply", mentionText: "kumo are you sentient or just pretending", authorHandle: "testfren" });
  console.log("reply:", r);
  check("reply <= 200 chars", r !== null && r.length <= 200);
  check("reply is lowercase, no bangs/hashtags", r !== null && r === r.toLowerCase() && !r.includes("!") && !r.includes("#"));

  const rows = await db.all<{ kind: string; status: string }>("SELECT kind, status FROM tweets ORDER BY id");
  console.log("tweets table:", JSON.stringify(rows));
  check("blocked row recorded", rows.some((x) => x.status === "blocked"));
  check("dry-run row recorded", rows.some((x) => x.status === "dry-run"));

  if (failed > 0) {
    console.error(`\n${failed} pipeline case(s) FAILED`);
    process.exit(1);
  }
  console.log("\nall pipeline cases passed");
  process.exit(0);
}

void main();
