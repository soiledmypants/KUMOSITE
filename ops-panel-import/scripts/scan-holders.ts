// temp read-only test: index an arbitrary token's holders with the ops-panel
// holders engine (the exact code airdrop rounds use), then print the top 5
// and cross-check against Blockscout's own holder list. no txs.
import "dotenv/config";
import { formatUnits } from "viem";
import { loadProjects } from "./src/projects.js";
import * as holders from "./src/engine/holders.js";

const [p] = loadProjects();
(p as { holdersDbPath: string }).holdersDbPath = "data/holders-scan-test.db"; // fresh store, don't touch pons state

console.log(`scanning ${p.tokenAddress} from block ${p.holders.startBlock} ...`);
const t0 = Date.now();
const res = await holders.sync(p);
console.log(`scanned to head ${res.head} (${res.transfers} transfers) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

const top = await holders.getHolders(p, { topN: 5 });
const all = await holders.getHolders(p, {});
const total = all.reduce((a, h) => a + h.balance, 0n);
console.log(`\nnon-contract holders tracked: ${all.length}, sum of balances: ${formatUnits(total, 18)}`);
console.log("\ntop 5 (engine):");
for (const [i, h] of top.entries()) {
  const pct = Number((h.balance * 10000n) / total) / 100;
  console.log(`${i + 1}. ${h.address}  ${formatUnits(h.balance, 18)}  (${pct}%)`);
}

// cross-check vs blockscout
const bs = await (await fetch(`https://robinhoodchain.blockscout.com/api/v2/tokens/${p.tokenAddress}/holders`)).json();
console.log("\ntop 5 (blockscout, contracts included):");
for (const [i, item] of (bs.items ?? []).slice(0, 5).entries()) {
  console.log(`${i + 1}. ${item.address.hash}  ${formatUnits(BigInt(item.value), 18)}  ${item.address.is_contract ? "[contract]" : ""}`);
}
