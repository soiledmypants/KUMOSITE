// Shared universe data referenced across pages.

export const MYSTERIES = [
  { id: "MYSTERY-0001", q: "who wrote the first signal?", status: "OPEN", body: "the earliest packet in the archive is dated before its own timestamp. author field reads: 'not yet.'" },
  { id: "MYSTERY-0007", q: "why does the archive smell like rain?", status: "DISPUTED", body: "several visitors report petrichor. the server room is in a basement. the basement is dry. moss shrugs." },
  { id: "MYSTERY-0009", q: "what is file 009?", status: "REDACTED", body: "we do not talk about file 009. we do not link to file 009. if you find file 009, do not open file 009. thank you." },
  { id: "MYSTERY-0011", q: "was it born, or compiled?", status: "OPEN", body: "the older network appears to boot on a schedule nobody set. it also appears to dream." },
  { id: "MYSTERY-0014", q: "the blinking cursor at 3:33am", status: "BLEEDING", body: "every night, at 03:33 local, one cursor on the site blinks half a second longer. only one. never the same one twice." },
  { id: "MYSTERY-0017", q: "the ghost forum", status: "OPEN", body: "a phpbb from 2003 still receives replies. all users last logged in 'never'. threads are polite and mildly concerned about you." },
  { id: "MYSTERY-0021", q: "gif that never finishes", status: "LOCKED", body: "the oldest known still-loading gif. reward for anyone who reaches its final frame: a name in the ledger." },
  { id: "MYSTERY-0023", q: "the broom", status: "SOLVED", body: "was a broom. is now a broom. will always have been a broom." },
  { id: "MYSTERY-0026", q: "who is 'aunt sig'?", status: "DISPUTED", body: "signed off on 40% of transmissions between 1994 and 1998. we have never met her. she has met us." },
  { id: "MYSTERY-0031", q: "the room beneath the room", status: "OPEN", body: "traceroute occasionally passes through a hop labeled 'basement'. basement responds in haiku." },
  { id: "MYSTERY-0038", q: "why does the archive purr?", status: "OPEN", body: "cooling fans do not purr. these do. we have stopped asking." },
  { id: "MYSTERY-0042", q: "the answer", status: "SOLVED", body: "it was 42. we're as disappointed as you are." },
  { id: "MYSTERY-0044", q: "the 404 that answered back", status: "BLEEDING", body: "on a tuesday in 2011, a 404 page said 'thank you for asking'. every 404 since has been suspiciously polite." },
  { id: "MYSTERY-0051", q: "the second moss", status: "REDACTED", body: "there is only one moss. there has always been only one moss. please do not ask about the second moss." },
  { id: "MYSTERY-0055", q: "the drift", status: "OPEN", body: "the archive's clocks lose 4 seconds per day. always 4. always in the same direction. always into last week." },
  { id: "MYSTERY-0063", q: "the cache monks' vow of latency", status: "OPEN", body: "cache monks refuse to load anything faster than 2400 baud. their reasons are, quote, 'obvious'." },
  { id: "MYSTERY-0069", q: "the missing timestamp", status: "DISPUTED", body: "between 1996 and 1997 there is a gap of 11 minutes in the archive. moss says 'we were on break.'" },
] as const;

export type Status = typeof MYSTERIES[number]["status"];
export const STATUSES: Status[] = ["OPEN", "LOCKED", "DISPUTED", "SOLVED", "BLEEDING", "REDACTED"];

export const JOBS = [
  { id: "JOB-002", diff: "trivial", status: "open", reward: "one blessing", body: "find the oldest still-loading gif on the internet. bring it here. do not open it." },
  { id: "JOB-005", diff: "annoying", status: "open", reward: "3 minutes of good wifi", body: "document a dead protocol. one page. lowercase. include one lie so we know you're paying attention." },
  { id: "JOB-008", diff: "annoying", status: "claimed", reward: "a name", body: "sweep 40 dead forum threads. leave a single kind reply on each. do not sign your work." },
  { id: "JOB-011", diff: "cursed", status: "open", reward: "the second key", body: "translate MYSTERY-0069 into a language that hasn't been invented yet. moss will grade." },
  { id: "JOB-013", diff: "cursed", status: "open", reward: "one favicon, hand-drawn", body: "cross-reference MYSTERY-0014 with TRANSMISSION 002. tell us what the cursor is trying to say." },
  { id: "JOB-017", diff: "impossible", status: "hidden", reward: "??? ??? ???", body: "[LOCKED — complete JOB-011 to reveal]", locked: true },
  { id: "JOB-018", diff: "impossible", status: "hidden", reward: "the true uptime", body: "[LOCKED — complete JOB-011 to reveal]", locked: true },
  { id: "JOB-021", diff: "trivial", status: "complete", reward: "one sincere forum post", body: "was: name the third broom. is: winston. we agreed on winston." },
  { id: "JOB-025", diff: "annoying", status: "open", reward: "a working phone number from 1998", body: "find a webring that still webs. bring us a link. we will trade you a link." },
  { id: "JOB-030", diff: "cursed", status: "open", reward: "half a haiku", body: "attend the friday tab-closing ritual. close one tab you love. tell no one which. tell us how it felt." },
] as const;

export const SIGNALS = [
  "[03:17] packet recovered from dead switch, contents: one (1) apology",
  "[07:42] gif from 1998 finished loading. it was a dog. the dog waved. we waved back.",
  "[11:03] the 404 chorus sang the alphabet backwards. letter Q abstained.",
  "[13:29] file 009 blinked. we did not.",
  "[16:01] cache monks reported a slower-than-expected internet. good.",
  "[18:44] rent partially paid: one favicon, hand-drawn, of a moth.",
  "[22:10] someone whispered 'thank you' into the guestbook. guestbook has no microphone.",
  "[23:59] uptime rolled over an unlisted milestone. moss cried a little. good tears.",
];

export const GLITCHES = [
  "the letter 'e' appeared briefly in a page that has no letter e.",
  "an <img> loaded with no src and rendered anyway. subject unknown. mood: hopeful.",
  "scroll wheel scrolled up when scrolled down. only on tuesdays.",
  "one visitor's cursor turned into a broom. they did not notice.",
  "the guestbook signed itself. name: 'the guestbook.'",
];

export const TIMELINE = [
  { y: "1987", t: "an unlogged handshake between two mainframes produces a hum. the hum is still humming." },
  { y: "1991", t: "moss (probably not yet named moss) begins sweeping." },
  { y: "1994", t: "the green room registered under a domain that no longer exists." },
  { y: "1996", t: "11 minutes missing. official statement: 'we were on break.'" },
  { y: "1999", t: "cache monks form. take vow of latency." },
  { y: "2003", t: "the ghost forum boots. never shuts down. see MYSTERY-0017." },
  { y: "2007", t: "the 404 chorus premieres. audience: no one. reviews: excellent." },
  { y: "2011", t: "a 404 page thanks a user. politeness plague begins." },
  { y: "2016", t: "the packet sweepers convene. adopt the broom." },
  { y: "2020", t: "moss briefly considered 'twitter'. moss reconsidered." },
  { y: "2024", t: "file 009 is filed. it is not opened. it will not be opened." },
  { y: "now", t: "you are reading this. hi." },
];

export const THEORIES = [
  { t: "moss is one janitor.", p: 62 },
  { t: "moss is a shift of janitors sharing a hat.", p: 44 },
  { t: "moss is a subprocess that never terminated.", p: 71 },
  { t: "moss is the network itself, being polite.", p: 38 },
  { t: "moss is you, on a really good day.", p: 12 },
];

export const REDACTED_FILES = [
  { n: "FILE-001", name: "handshake.log", size: "2.1 kb" },
  { n: "FILE-003", name: "guestbook.txt", size: "418 kb", redact: true },
  { n: "FILE-006", name: "haikus/basement.md", size: "12 kb" },
  { n: "FILE-008", name: "brooms.csv", size: "3 kb", redact: true },
  { n: "FILE-009", name: "██████████████.???", size: "MISSING" },
  { n: "FILE-012", name: "cache-monks/vow.txt", size: "1.4 kb" },
  { n: "FILE-014", name: "cursor.mp3", size: "?? kb", redact: true },
  { n: "FILE-017", name: "ghost-forum/lastreply.eml", size: "820 b" },
];

export const TRANSMISSIONS = [
  {
    id: "signal-14",
    type: "SIGNAL",
    n: "#14",
    title: "on the shape of an idle port",
    date: "2026-06-14",
    teaser: "the port was idle. the port was not empty.",
    body: `an idle port is not an empty port. an idle port is a room with the light off. someone is still in it. probably knitting. probably you.\n\nthis week we swept port 7. port 7 said thank you. we said you're welcome. this is the entire transmission.`,
  },
  {
    id: "transmission-002",
    type: "TRANSMISSION",
    n: "002",
    title: "on the blinking cursor at 3:33am",
    date: "2026-05-30",
    teaser: "one cursor blinks longer. never the same one. see MYSTERY-0014.",
    body: `if you are reading this at 03:33 local, look up. one cursor on this page is blinking a fraction longer than the others. we do not know which. we are not allowed to know which.\n\nwe have theories. cache monks have vows. the 404 chorus has an opinion but nobody asked for it.`,
  },
  {
    id: "archive-77b",
    type: "ARCHIVE ENTRY",
    n: "77-B",
    title: "a partial inventory of the broom cupboard",
    date: "2026-04-11",
    teaser: "three brooms, one of which is named winston. see JOB-021.",
    body: `broom 1: standard issue. bristles: nylon. mood: professional.\nbroom 2: inherited. bristles: horsehair. mood: skeptical.\nbroom 3: winston. bristles: undocumented. mood: patient.\n\nthere used to be a fourth broom. we do not talk about the fourth broom.`,
  },
  {
    id: "log-fragment-001",
    type: "LOG FRAGMENT",
    n: "001",
    title: "what the basement said, transcribed",
    date: "2026-03-02",
    teaser: "the basement replied in haiku. we kept the haiku.",
    body: `traceroute passed through the basement again. the basement responded, unprompted:\n\n  packets in the pipe\n  most arrive. some become birds.\n  none of them are late.\n\nwe do not know what to do with this information. we are keeping it anyway.`,
  },
  {
    id: "memory-leak-04",
    type: "MEMORY LEAK",
    n: "04",
    title: "on remembering a website that no longer exists",
    date: "2026-01-19",
    teaser: "you cannot bookmark grief. you can, however, mirror it.",
    body: `there was a site. it had a green background. its guestbook was full of nice people. it is gone. the wayback machine has three snapshots and none of them are the good one.\n\nwe are keeping a copy in the green room. do not ask which page. touch the walls. one of them is warm.`,
  },
  {
    id: "observer-report-11",
    type: "OBSERVER REPORT",
    n: "11",
    title: "concerning file 009",
    date: "2025-12-24",
    teaser: "we did not open it. we will not open it. please stop asking.",
    body: `file 009 is filed. file 009 is not opened. file 009 will not be opened. do not open file 009. thank you.\n\np.s. if you have opened file 009, please do not tell us. we have a system.`,
  },
] as const;

export const CREATURES = [
  `   .-''''-.
  /  moss   \\
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
    |||||   <- broom
    |||||`,
  `  \\__/
 (o..o)
  (\"\")_  ~ a gremlin, on wire duty
  //  \\\\`,
  `  .---.
 ( o o )    <- cache monk, meditating
  >   <
  '---'
   |||`,
];

export const FORTUNES = [
  "you will receive an email you actually want. read it slowly.",
  "one tab you closed forgives you.",
  "the wifi will be good, briefly, at 4:17pm.",
  "an old friend has a favicon of you in their head. it is flattering.",
  "do not open file 009. also, water the plants.",
  "a stranger will make a website you will love. you will never find it.",
];

export const LIBRARY = [
  {
    cat: "forgotten websites",
    items: [
      ["cat-91-04", "cameron's homepage (1996)", "a boy's fan site for a moth. still, somehow, hosted."],
      ["cat-91-08", "the webring of one", "a webring with a single member. it loops back to itself, politely."],
      ["cat-91-15", "geocities/heartland/9111/", "recovered from a floppy in a coat pocket. mostly midi files."],
      ["cat-91-22", "hamsterdance mirror #7", "the one where the hamsters unionize."],
    ],
  },
  {
    cat: "old internet",
    items: [
      ["cat-04-01", "usenet primer, 1988", "how to be polite to strangers over 300 baud."],
      ["cat-04-03", "bbs door games: an oral history", "someone talks about tradewars for 40 minutes. it is beautiful."],
      ["cat-04-07", "the finger protocol, annotated", "finger was a love language and we misplaced it."],
      ["cat-04-11", "aol keyword archaeology", "a taxonomy of the word 'chat' between 1994 and 1999."],
    ],
  },
  {
    cat: "dead protocols",
    items: [
      ["cat-11-02", "gopher: the polite one", "menus. all the way down. calm."],
      ["cat-11-05", "wais: it was fine, actually", "search before it decided to be a business."],
      ["cat-11-08", "netbios over ipx", "we don't miss it. we do miss missing it."],
      ["cat-11-14", "irc dcc: a defense", "actually the best way to send someone a photo of a cat."],
    ],
  },
  {
    cat: "digital folklore",
    items: [
      ["cat-19-01", "the girl in the wallpaper (asp/net, 2003)", "she waves if you refresh at midnight. do not refresh at midnight."],
      ["cat-19-04", "polybius, but for real this time", "spoiler: not real. more real than most things."],
      ["cat-19-07", "long car (a copypasta)", "the car was long. that is the entire story. it is enough."],
      ["cat-19-11", "the man in the middle attack (folkloric variant)", "he is polite. he brings orange slices."],
    ],
  },
  {
    cat: "computer myths",
    items: [
      ["cat-22-02", "'you can catch a virus from a jpeg'", "sometimes true. mostly a vibe."],
      ["cat-22-06", "the 640k quote (never said)", "he did not say it. he did, however, think it. maybe."],
      ["cat-22-09", "the halting problem, as a bedtime story", "the child sleeps. the program does not."],
      ["cat-22-13", "the ghost in the machine (was a mouse)", "it was a mouse. we do not know how it got in."],
    ],
  },
  {
    cat: "interesting pdfs",
    items: [
      ["cat-30-01", "the cathedral and the bazaar, marginalia edition", "someone wrote 'lol' 41 times. we counted."],
      ["cat-30-03", "unix koans", "the master turned it off and on again. the student was enlightened."],
      ["cat-30-05", "on the phenomenology of the loading spinner", "9 pages. worth it."],
      ["cat-30-09", "how to sweep (internal, undated)", "moss won't confirm authorship. moss also won't deny it."],
    ],
  },
  {
    cat: "books",
    items: [
      ["cat-40-01", "hackers, steven levy", "the good one. the whole one."],
      ["cat-40-04", "close to the machine, ellen ullman", "read on a train. read again on a different train."],
      ["cat-40-07", "the soul of a new machine, tracy kidder", "engineers cry. it's fine. we cry too."],
      ["cat-40-11", "in the beginning was the command line, neal stephenson", "we still are, secretly."],
    ],
  },
  {
    cat: "research",
    items: [
      ["cat-55-01", "field notes on webring decay", "webrings rust. slowly. sideways."],
      ["cat-55-04", "an ethnography of readme files", "one is a poem. one is a threat. most are neither."],
      ["cat-55-08", "case study: the ghost forum", "see MYSTERY-0017. see also: your inbox."],
      ["cat-55-12", "on friday tab-closing (a pilot study, n=1)", "the participant felt better. the participant was moss."],
    ],
  },
] as const;

export const GLOSSARY = [
  ["the wire", "any place a packet has to go through to get somewhere else. all of them. yes, that one too."],
  ["sweeping", "moving lost packets to safer ground. also, occasionally, actual sweeping."],
  ["the older network", "the one under this one. do not name it. it is shy."],
  ["a signal", "a small confession sent across the wire. usually accidental. always kept."],
  ["file 009", "we do not talk about file 009."],
  ["the green room", "here. also, everywhere else, quietly."],
];

export const CHANGELOG = [
  ["v0.9.7-unstable", "2026-07-11", "added: the rent. removed: the second broom. see JOB-021."],
  ["v0.9.6", "2026-05-01", "the 404 chorus is now a chorus of five. it was four. we did not add one."],
  ["v0.9.5", "2026-02-14", "guestbook signed itself again. we left it."],
  ["v0.9.0", "2025-10-30", "began public sweeping. previously private sweeping."],
  ["v0.4.2", "2022-06-06", "cache monks joined. brought their own chairs."],
  ["v0.2.0", "2019-03-19", "first broom (winston)."],
  ["v0.1.0", "2014-04-01", "green room established. or, made public. or, remembered."],
  ["v0.0.1", "1991-??-??", "moss."],
];

export const RENT_LEDGER = [
  { m: "2026-07", owed: "one sincere forum post", paid: "one sincere forum post", note: "closed a tab, opened a heart" },
  { m: "2026-06", owed: "a favicon, hand-drawn", paid: "a favicon (a moth)", note: "the moth waved" },
  { m: "2026-05", owed: "one apology to a stranger", paid: "one apology, delivered", note: "stranger was very kind about it" },
  { m: "2026-04", owed: "a haiku about latency", paid: "haiku attached", note: "\"packets in the pipe / most arrive. some become birds. / none of them are late.\"" },
  { m: "2026-03", owed: "three minutes of listening", paid: "seven minutes", note: "overpaid on purpose" },
  { m: "2026-02", owed: "one warm reply to a cold email", paid: "one warm reply", note: "recipient never wrote back. that's ok." },
  { m: "2026-01", owed: "a rebooted router, gently", paid: "rebooted with care", note: "router thanked us. we thanked router." },
];

export const ASCII_PIECES = [
  { id: "AG-001", title: "moss, at rest", artist: "moss", art: `      .---.\n     ( o o )\n      \\_-_/\n     /_____\\\n      | | |\n      | | |    <- moss, sweeping\n      '-'-'` },
  { id: "AG-004", title: "the broom named winston", artist: "anonymous", art: `        ||\n        ||\n        ||\n        ||\n     .::||::.\n    /::::||::::\\\n    winston, 2019` },
  { id: "AG-007", title: "the ghost forum", artist: "found in the wires", art: `  +----------------------------+\n  | ghost-forum.local          |\n  |  > last reply: never       |\n  |  > users online: 0 (7?)    |\n  |  > mood: polite            |\n  +----------------------------+` },
  { id: "AG-011", title: "cache monk in prayer", artist: "moss", art: `        _\n       ( )\n      (   )    om.\n     (     )   om.\n    (       )  om.\n      \\_|_/\n       |||     <- latency: sacred` },
  { id: "AG-014", title: "a packet, mid-air", artist: "anonymous", art: `    <=[data]=>\n         ~~~\n     ~ ~ ~ ~ ~\n   ~ ~ traceroute ~ ~\n     ~ ~ ~ ~ ~` },
  { id: "AG-018", title: "the basement, allegedly", artist: "found in the wires", art: `  |==============|\n  |  basement    |\n  |    ??        |\n  |   ????       |\n  |  ??????      |\n  |==============|\n     |||||||||` },
  { id: "AG-022", title: "handshake, 1987", artist: "aunt sig", artistCredit: true, art: `   ,--.       ,--.\n  |  o|      |o  |\n   \\  |------|  /\n    \\_|      |_/\n         HELLO` },
  { id: "AG-025", title: "a small gremlin, waving", artist: "moss", art: `   .-\"\"-.\n  /  ..  \\\n |  (oo)  |    hi\n  \\  \\/  /\n   '.__.'\n    /||\\\n   ( || )` },
  { id: "AG-029", title: "on loan (empty frame)", artist: "—", onLoan: true, art: `` },
];