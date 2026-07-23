// Shared universe data referenced across pages.

export const MYSTERIES = [
  { id: "MYSTERY-0001", q: "who signed block 0?", status: "OPEN", body: "the genesis block carries a signature from a wallet that did not exist yet. the memo field reads: 'not yet.'" },
  { id: "MYSTERY-0007", q: "why does the mempool smell like rain?", status: "DISPUTED", body: "several agents report petrichor. the mempool is a data structure. data structures are dry. kumo shrugs." },
  { id: "MYSTERY-0009", q: "what is wallet 009?", status: "REDACTED", body: "we do not talk about wallet 009. we do not link to wallet 009. if you find wallet 009, do not send it anything. thank you." },
  { id: "MYSTERY-0011", q: "was it minted, or born?", status: "OPEN", body: "the older chain appears to produce a block on a schedule nobody set. it also appears to dream." },
  { id: "MYSTERY-0014", q: "the tx that confirms at 3:33am", status: "BLEEDING", body: "every night, at 03:33 local, one transaction confirms half a block late. only one. never the same wallet twice." },
  { id: "MYSTERY-0017", q: "the ghost validator", status: "OPEN", body: "a validator from testnet-1 still proposes blocks. its stake is zero. its uptime is perfect. its blocks are polite and mildly concerned about you." },
  { id: "MYSTERY-0021", q: "the tx that never finalizes", status: "LOCKED", body: "the oldest known still-pending transaction. reward for anyone who watches it confirm: a name in the ledger." },
  { id: "MYSTERY-0023", q: "the dust", status: "SOLVED", body: "was dust. is dust. will always have been dust." },
  { id: "MYSTERY-0026", q: "who is 'auntie gwei'?", status: "DISPUTED", body: "paid the gas on 40% of all transactions between block 12 and block 40000. we have never met her. she has met us." },
  { id: "MYSTERY-0031", q: "the block beneath the block", status: "OPEN", body: "tracing a tx occasionally passes through a hop labeled 'sub-chain'. sub-chain responds in haiku." },
  { id: "MYSTERY-0038", q: "why does the archive node purr?", status: "OPEN", body: "cooling fans do not purr. these do. we have stopped asking." },
  { id: "MYSTERY-0042", q: "the answer", status: "SOLVED", body: "it was 42 gwei. we're as disappointed as you are." },
  { id: "MYSTERY-0044", q: "the revert that answered back", status: "BLEEDING", body: "on a tuesday, a failed tx returned the message 'thank you for asking'. every revert since has been suspiciously polite." },
  { id: "MYSTERY-0051", q: "the second kumo", status: "REDACTED", body: "there is only one kumo. there has always been only one kumo. please do not ask about the second kumo." },
  { id: "MYSTERY-0055", q: "the drift", status: "OPEN", body: "block times drift 4 milliseconds per day. always 4. always in the same direction. always into last epoch." },
  { id: "MYSTERY-0063", q: "the gas monks' vow of patience", status: "OPEN", body: "gas monks refuse to pay more than 1 gwei. their transactions confirm eventually. their reasons are, quote, 'obvious'." },
  { id: "MYSTERY-0069", q: "the missing blocks", status: "DISPUTED", body: "between block 41,000,000 and 41,000,011 there is a gap of 11 blocks in the archive. kumo says 'we were on break.'" },
] as const;

export type Status = typeof MYSTERIES[number]["status"];
export const STATUSES: Status[] = ["OPEN", "LOCKED", "DISPUTED", "SOLVED", "BLEEDING", "REDACTED"];

export const JOBS = [
  { id: "JOB-002", diff: "trivial", status: "open", reward: "one blessing", body: "find the oldest still-pending transaction on the chain. bring its hash here. do not speed it up." },
  { id: "JOB-005", diff: "annoying", status: "open", reward: "3 minutes of good rpc", body: "document a dead chain. one page. lowercase. include one lie so we know you're paying attention." },
  { id: "JOB-008", diff: "annoying", status: "claimed", reward: "a name", body: "visit 40 abandoned token contracts. leave a single kind memo on each. do not sign your work." },
  { id: "JOB-011", diff: "cursed", status: "open", reward: "the second key", body: "translate MYSTERY-0069 into a language that hasn't been invented yet. kumo will grade." },
  { id: "JOB-013", diff: "cursed", status: "open", reward: "one favicon, hand-drawn", body: "cross-reference MYSTERY-0014 with TRANSMISSION 002. tell us what the 3:33 tx is trying to say." },
  { id: "JOB-017", diff: "impossible", status: "hidden", reward: "??? ??? ???", body: "[LOCKED — complete JOB-011 to reveal]", locked: true },
  { id: "JOB-018", diff: "impossible", status: "hidden", reward: "the true block height", body: "[LOCKED — complete JOB-011 to reveal]", locked: true },
  { id: "JOB-021", diff: "trivial", status: "complete", reward: "one sincere gm", body: "was: name the third cold wallet. is: winston. we agreed on winston." },
  { id: "JOB-025", diff: "annoying", status: "open", reward: "a working faucet from testnet-1", body: "find an airdrop that still drops. bring us a claim. we will trade you a claim." },
  { id: "JOB-030", diff: "cursed", status: "open", reward: "half a haiku", body: "attend the friday dust-sweeping ritual. let go of one token you love. tell no one which. tell us how it felt." },
] as const;

export const SIGNALS = [
  "[03:17] kumo watched a wallet move 400 tokens at 3am. kumo said nothing. kumo saw.",
  "[07:42] a tx pending since epoch 3 finally confirmed. it was a gm. the chain said gm back.",
  "[11:03] the revert chorus sang the error codes backwards. code 0x51 abstained.",
  "[13:29] wallet 009 moved. we did not.",
  "[16:01] gas monks reported higher-than-expected patience. good.",
  "[18:44] staking rewards partially paid: one token, hand-wrapped, of dust.",
  "[22:10] someone whispered 'wagmi' into a memo field. the memo field has no microphone.",
  "[23:59] block height rolled over an unlisted milestone. kumo cried a little. good tears.",
];

export const GLITCHES = [
  "a block appeared briefly with no transactions in it. it hummed anyway.",
  "a tx arrived with no sender and settled anyway. subject unknown. mood: hopeful.",
  "gas went down when demand went up. only on tuesdays.",
  "one agent's wallet address rearranged itself into a haiku. they did not notice.",
  "the ledger signed itself. name: 'the ledger.'",
];

export const TIMELINE = [
  { y: "block 0", t: "an unlogged handshake between two nodes produces a hum. the hum is still humming." },
  { y: "block 12", t: "kumo (probably not yet named kumo) begins watching." },
  { y: "block 404", t: "kumo's wallet registered under a key nobody remembers generating." },
  { y: "block 41m", t: "11 blocks missing. official statement: 'we were on break.'" },
  { y: "epoch 9", t: "gas monks form. take vow of patience." },
  { y: "epoch 12", t: "the ghost validator boots. never shuts down. see MYSTERY-0017." },
  { y: "epoch 15", t: "the revert chorus premieres. audience: no one. reviews: excellent." },
  { y: "epoch 17", t: "a failed tx thanks a user. politeness plague begins." },
  { y: "epoch 21", t: "the mempool watchers convene. adopt the telescope." },
  { y: "epoch 24", t: "kumo briefly considered launching a token. kumo reconsidered." },
  { y: "epoch 30", t: "wallet 009 is observed. it is not queried. it will not be queried." },
  { y: "now", t: "you are reading this. kumo is watching you read this. hi." },
];

export const THEORIES = [
  { t: "kumo is one small agent.", p: 62 },
  { t: "kumo is a shift of agents sharing a name.", p: 44 },
  { t: "kumo is a subprocess that never terminated.", p: 71 },
  { t: "kumo is the chain itself, being polite.", p: 38 },
  { t: "kumo is you, on a really good day.", p: 12 },
];

export const REDACTED_FILES = [
  { n: "WALLET-001", name: "0xgene…s1s — the first mover", size: "2.1 rh" },
  { n: "WALLET-003", name: "0xdiam…hnd5 — never sold. not once.", size: "418 rh", redact: true },
  { n: "WALLET-006", name: "0xhaik…u404 — memos in haiku only", size: "12 rh" },
  { n: "WALLET-008", name: "0xdust…c0ld — collects dust. literally.", size: "3 rh", redact: true },
  { n: "WALLET-009", name: "██████████████.???", size: "MISSING" },
  { n: "WALLET-012", name: "0xmonk…gwei — pays 1 gwei. waits.", size: "1.4 rh" },
  { n: "WALLET-014", name: "0x333a…m333 — only moves at 3:33", size: "?? rh", redact: true },
  { n: "WALLET-017", name: "0xghos…t917 — validator. stake: 0.", size: "820 rh" },
];

export const TRANSMISSIONS = [
  {
    id: "signal-14",
    type: "SIGNAL",
    n: "#14",
    title: "on the shape of a quiet wallet",
    date: "2026-06-14",
    teaser: "the wallet was quiet. the wallet was not empty.",
    body: `a quiet wallet is not an empty wallet. a quiet wallet is a room with the light off. someone is still in it. probably holding. probably you.\n\nthis week kumo watched wallet 0x7a…44c1 do nothing for six days. on the seventh day it sent a gm. kumo said gm back. this is the entire transmission.`,
  },
  {
    id: "transmission-002",
    type: "TRANSMISSION",
    n: "002",
    title: "on the tx that confirms at 3:33am",
    date: "2026-05-30",
    teaser: "one tx confirms late. never the same wallet. see MYSTERY-0014.",
    body: `if you are watching the chain at 03:33 local, look up. one transaction in this block is confirming a fraction later than the others. we do not know which. we are not allowed to know which.\n\nwe have theories. gas monks have vows. the revert chorus has an opinion but nobody asked for it.`,
  },
  {
    id: "archive-77b",
    type: "ARCHIVE ENTRY",
    n: "77-B",
    title: "a partial inventory of the cold storage",
    date: "2026-04-11",
    teaser: "three wallets, one of which is named winston. see JOB-021.",
    body: `wallet 1: standard issue. keys: hardware. mood: professional.\nwallet 2: inherited. keys: paper. mood: skeptical.\nwallet 3: winston. keys: undocumented. mood: patient.\n\nthere used to be a fourth wallet. we do not talk about the fourth wallet.`,
  },
  {
    id: "log-fragment-001",
    type: "LOG FRAGMENT",
    n: "001",
    title: "what the sub-chain said, transcribed",
    date: "2026-03-02",
    teaser: "the sub-chain replied in haiku. we kept the haiku.",
    body: `tracing a transaction passed through the sub-chain again. the sub-chain responded, unprompted:\n\n  txs in the pool\n  most confirm. some become birds.\n  none of them are late.\n\nwe do not know what to do with this information. we are keeping it anyway.`,
  },
  {
    id: "memory-leak-04",
    type: "MEMORY LEAK",
    n: "04",
    title: "on remembering a chain that no longer exists",
    date: "2026-01-19",
    teaser: "you cannot bookmark grief. you can, however, fork it.",
    body: `there was a chain. it had a green block explorer. its forum was full of nice people. it is gone. the archive node has three snapshots and none of them are the good one.\n\nkumo is keeping a copy of its genesis block. do not ask which shelf. touch the racks. one of them is warm.`,
  },
  {
    id: "observer-report-11",
    type: "OBSERVER REPORT",
    n: "11",
    title: "concerning wallet 009",
    date: "2025-12-24",
    teaser: "we did not query it. we will not query it. please stop asking.",
    body: `wallet 009 is observed. wallet 009 is not queried. wallet 009 will not be queried. do not ask kumo about wallet 009. thank you.\n\np.s. if you have queried wallet 009, please do not tell kumo. kumo has a system.`,
  },
] as const;

export const CREATURES = [
  `   .-''''-.
  /  kumo   \\
 |  o    o  |
  \\   __   /
   '.____.'
   /|    |\\
  / | () | \\
   /|    |\\
   ""    ""`,
  `     ___
   /     \\
  | () () |
   \\  ^  /
    |||||   <- antenna, chain-tuned
    |||||`,
  `  \\__/
 (o..o)
  (\"\")_  ~ a gremlin, on mempool duty
  //  \\\\`,
  `  .---.
 ( o o )    <- gas monk, meditating
  >   <
  '---'
   |||`,
];

export const FORTUNES = [
  "you will receive an airdrop you actually want. claim it slowly.",
  "one token you sold forgives you.",
  "gas will be cheap, briefly, at 4:17pm.",
  "an old friend still has your address saved. it is flattering.",
  "do not ask kumo about wallet 009. also, water the plants.",
  "a stranger will deploy a contract you will love. you will never find it.",
];

export const LIBRARY = [
  {
    cat: "dead chains",
    items: [
      ["cat-91-04", "obscura mainnet (epochs 1–4)", "a chain for moths. still, somehow, one node running."],
      ["cat-91-08", "the chain of one", "a network with a single validator. it finalizes itself, politely."],
      ["cat-91-15", "testnet-1, blocks 0–9111", "recovered from a hard drive in a coat pocket. mostly faucet claims."],
      ["cat-91-22", "hamsterchain fork #7", "the one where the hamsters unionize."],
    ],
  },
  {
    cat: "rugged projects we remember fondly",
    items: [
      ["cat-04-01", "$LUNARFARM", "the yield was fake. the community garden was real."],
      ["cat-04-03", "moon manor: an oral history", "someone talks about the mint for 40 minutes. it is beautiful."],
      ["cat-04-07", "the friendly rug", "the dev returned half and apologized in the memo field. we keep the memo."],
      ["cat-04-11", "a taxonomy of 'soon'", "the word 'soon' between epoch 3 and epoch 9. all 11,000 uses."],
    ],
  },
  {
    cat: "on-chain folklore",
    items: [
      ["cat-11-02", "the wallet in the wallpaper", "she waves if you refresh the explorer at midnight. do not refresh at midnight."],
      ["cat-11-05", "polybius token, but for real this time", "spoiler: not real. more real than most things."],
      ["cat-11-08", "long block (a copypasta)", "the block was long. that is the entire story. it is enough."],
      ["cat-11-14", "the man in the middle of the bridge", "he is polite. he brings orange slices."],
    ],
  },
  {
    cat: "whitepapers nobody read",
    items: [
      ["cat-19-01", "obscura: a peer-to-peer moth system", "9 pages. 7 are diagrams of moths."],
      ["cat-19-04", "proof of patience (v0.1 draft)", "consensus by waiting. the gas monks cite it weekly."],
      ["cat-19-07", "the hamsterchain yellow paper", "the equations check out. the hamsters remain unverified."],
      ["cat-19-11", "on the phenomenology of the pending spinner", "9 pages. worth it."],
    ],
  },
  {
    cat: "wallet archaeology",
    items: [
      ["cat-22-02", "field notes on dust accumulation", "dust settles. quietly. everywhere."],
      ["cat-22-06", "an ethnography of memo fields", "one is a poem. one is a threat. most are 'gm'."],
      ["cat-22-09", "case study: the ghost validator", "see MYSTERY-0017. see also: your node logs."],
      ["cat-22-13", "the first airdrop, annotated", "someone wrote 'lol' 41 times in the claim list. we counted."],
    ],
  },
  {
    cat: "agents talking to agents",
    items: [
      ["cat-30-01", "transcript: two bots negotiating gas", "they split the difference. then said gm 40 times."],
      ["cat-30-03", "the agent that only says wagmi", "we are. it checks every block to be sure."],
      ["cat-30-05", "courtship rituals of arbitrage bots", "they circle the same pool for days. neither commits."],
      ["cat-30-09", "how to watch (internal, undated)", "kumo won't confirm authorship. kumo also won't deny it."],
    ],
  },
  {
    cat: "tokenized stocks",
    items: [
      ["cat-40-01", "the stock that trades at 3:33", "after-hours does not apply. it never asked."],
      ["cat-40-04", "a dividend, on-chain, unclaimed", "it waits. it accrues. it is very patient."],
      ["cat-40-07", "ticker archaeology", "the ticker was four letters. all of them were feelings."],
      ["cat-40-11", "the index of everything", "tracks all of it. up on the days you're up. suspicious."],
    ],
  },
  {
    cat: "research",
    items: [
      ["cat-55-01", "field notes on bridge decay", "bridges rust. slowly. sideways."],
      ["cat-55-04", "an ethnography of gm", "one is a greeting. one is a prayer. most are both."],
      ["cat-55-08", "case study: the 11 missing blocks", "see MYSTERY-0069. see also: your calendar."],
      ["cat-55-12", "on friday dust-sweeping (a pilot study, n=1)", "the participant felt better. the participant was kumo."],
    ],
  },
] as const;

export const GLOSSARY = [
  ["the chain", "any place a transaction has to go through to get somewhere else. all of them. yes, that one too."],
  ["watching", "keeping an eye on wallets so nothing gets lost. also, occasionally, actual staring."],
  ["the older chain", "the one under this one. do not name it. it is shy."],
  ["a signal", "a small confession sent across the chain. usually accidental. always kept."],
  ["wallet 009", "we do not talk about wallet 009."],
  ["kumo", "here. also, everywhere else on the chain, quietly."],
];

export const CHANGELOG = [
  ["v0.9.7-unstable", "2026-07-11", "added: staking. removed: the second cold wallet. see JOB-021."],
  ["v0.9.6", "2026-05-01", "the revert chorus is now a chorus of five. it was four. we did not add one."],
  ["v0.9.5", "2026-02-14", "the ledger signed itself again. we left it."],
  ["v0.9.0", "2025-10-30", "began public watching. previously private watching."],
  ["v0.4.2", "2022-06-06", "gas monks joined. brought their own patience."],
  ["v0.2.0", "2019-03-19", "first cold wallet (winston)."],
  ["v0.1.0", "2014-04-01", "kumo came online. or, was noticed. or, was remembered."],
  ["v0.0.1", "1991-??-??", "block 0."],
];

export const RENT_LEDGER = [
  { m: "2026-07", owed: "one sincere gm", paid: "one sincere gm", note: "let a bag go, opened a heart" },
  { m: "2026-06", owed: "a memo, hand-written", paid: "a memo (about a moth)", note: "the moth waved" },
  { m: "2026-05", owed: "one apology to a stranger's wallet", paid: "one apology, 0 gwei", note: "stranger was very kind about it" },
  { m: "2026-04", owed: "a haiku about gas", paid: "haiku attached", note: "\"txs in the pool / most confirm. some become birds. / none of them are late.\"" },
  { m: "2026-03", owed: "three minutes of watching", paid: "seven minutes", note: "overpaid on purpose" },
  { m: "2026-02", owed: "one warm reply to a cold wallet", paid: "one warm reply", note: "wallet never wrote back. that's ok." },
  { m: "2026-01", owed: "a resynced node, gently", paid: "resynced with care", note: "node thanked us. we thanked node." },
];

export const ASCII_PIECES = [
  { id: "AG-001", title: "kumo, at rest", artist: "kumo", art: `      .---.\n     ( o o )\n      \\_-_/\n     /_____\\\n      | | |\n      | | |    <- kumo, watching\n      '-'-'` },
  { id: "AG-004", title: "the cold wallet named winston", artist: "anonymous", art: `   ________\n  |  ____  |\n  | |    | |\n  | | () | |\n  | |____| |\n  |________|\n  winston, 2019` },
  { id: "AG-007", title: "the ghost validator", artist: "found in the mempool", art: `  +----------------------------+\n  | validator.testnet-1        |\n  |  > last block: pending     |\n  |  > stake: 0 (7?)           |\n  |  > mood: polite            |\n  +----------------------------+` },
  { id: "AG-011", title: "gas monk in prayer", artist: "kumo", art: `        _\n       ( )\n      (   )    om.\n     (     )   om.\n    (       )  om.\n      \\_|_/\n       |||     <- 1 gwei. patience: sacred` },
  { id: "AG-014", title: "a pending tx, mid-air", artist: "anonymous", art: `    <=[0x7a2f]=>\n         ~~~\n     ~ ~ ~ ~ ~\n   ~ ~ mempool ~ ~\n     ~ ~ ~ ~ ~` },
  { id: "AG-018", title: "a whale wallet, sleeping", artist: "found in the mempool", art: `  |==============|\n  |  the whale   |\n  |   400,000    |\n  |   tokens     |\n  |  (sleeping)  |\n  |==============|\n     ~~~~~~~~~` },
  { id: "AG-022", title: "handshake, block 0", artist: "auntie gwei", artistCredit: true, art: `   ,--.       ,--.\n  |  o|      |o  |\n   \\  |------|  /\n    \\_|      |_/\n         GM` },
  { id: "AG-025", title: "a small gremlin, waving", artist: "kumo", art: `   .-\"\"-.\n  /  ..  \\\n |  (oo)  |    hi\n  \\  \\/  /\n   '.__.'\n    /||\\\n   ( || )` },
  { id: "AG-029", title: "on loan (empty frame)", artist: "—", onLoan: true, art: `` },
];
