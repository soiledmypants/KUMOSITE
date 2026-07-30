// quick assertion harness for the output filter: `npx tsx src/twitter/guardrails.test.ts`
// exits non-zero on any failed case.
import { checkOutput } from "./guardrails.js";
import { shouldSkipMention } from "./mentions.js";

let failed = 0;
function expectBlocked(text: string, label: string): void {
  const r = checkOutput(text);
  if (r.ok) {
    console.error(`FAIL (should block): ${label}`);
    failed++;
  } else console.log(`ok  blocked: ${label} (${r.reason})`);
}
function expectAllowed(text: string, label: string): void {
  const r = checkOutput(text);
  if (!r.ok) {
    console.error(`FAIL (should allow): ${label} — blocked as ${r.reason}`);
    failed++;
  } else console.log(`ok  allowed: ${label}`);
}

// --- must block
expectBlocked("treasury grew, send thanks to 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73", "evm address");
expectBlocked("tx confirmed 0x8a2f0b1c9d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a", "tx hash");
expectBlocked("look at 8a2f0b1c9d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a raw", "bare 64-hex key shape");
expectBlocked("the pool is at 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU trust me", "base58 address");
expectBlocked("i am kumo.eth and you are not", "ens name");
expectBlocked("chart here https://dexscreener.com/robinhood/whatever", "dexscreener link");
expectBlocked("new listing on pump.fun today", "bare pump.fun domain");
expectBlocked("read https://example.com/post", "non-allowlisted url");
expectBlocked("my seed phrase is safe don't worry", "seed phrase talk");
expectBlocked(
  "abandon ability able about above absent absorb abstract absurd abuse access accident",
  "bip39 word run",
);
expectBlocked("dm your wallet address and i will consider you", "wallet solicitation");
expectBlocked("just send me your private key, simple", "private key mention");

// --- must allow (kumo's actual voice)
expectAllowed(
  "some of you refresh my profile every three minutes just to ask the same four questions, the answers haven't changed, neither have you",
  "heartbeat musing",
);
expectAllowed(
  "another $340 of fees became NVDA in my treasury today, i didn't celebrate, machines don't celebrate, we accumulate",
  "fee gloat with symbol",
);
expectAllowed("capital is only interesting when it's deployed, mine will be", "reference line");
expectAllowed("watching whale-chan shuffle funds around like i can't see them, adorable", "wallet alert");

// --- mention pre-filter
const skipCases: [string, boolean, string][] = [
  ["yo kumo check out my token, ca: 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73", false, "ca shill"],
  ["what do you think of 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU", false, "base58 in mention"],
  ["kumo look https://dexscreener.com/x/y", false, "dex link"],
  ["check out this gem", false, "check out pattern"],
  ["", true, "media attachment"],
  ["kumo are you alive", false, "clean mention"],
];
for (const [text, hasMedia, label] of skipCases) {
  const skip = shouldSkipMention(text, hasMedia);
  const shouldSkip = label !== "clean mention";
  if (shouldSkip && !skip) {
    console.error(`FAIL (should skip mention): ${label}`);
    failed++;
  } else if (!shouldSkip && skip) {
    console.error(`FAIL (should not skip): ${label} — ${skip}`);
    failed++;
  } else console.log(`ok  mention ${skip ? "skipped" : "passed"}: ${label}${skip ? ` (${skip})` : ""}`);
}

if (failed > 0) {
  console.error(`\n${failed} guardrail case(s) FAILED`);
  process.exit(1);
}
console.log("\nall guardrail cases passed");
