// hard output filter. EVERY tweet/reply passes through checkOutput() AFTER
// generation and before posting — no posting path may bypass it. a blocked
// tweet is logged and DROPPED, never retried or rephrased: retrying until the
// model launders an address past the regex is exactly the failure mode this
// file exists to prevent.
import { say } from "../voice.js";

const ALLOWED_HOSTS = (process.env.TWITTER_ALLOWED_LINK_HOSTS ?? "")
  .split(",")
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);

// explicit scanner/dex domains — blocked even if someone fat-fingers them into the allowlist env
const HARD_BLOCKED_HOSTS = [
  "pump.fun",
  "dexscreener.com",
  "birdeye.so",
  "solscan.io",
  "etherscan.io",
  "basescan.org",
  "arbiscan.io",
  "bscscan.com",
  "blockscout.com",
  "dextools.io",
  "geckoterminal.com",
];

// compact bip39 subset for seed-phrase run detection (distinctive, common picks)
const BIP39_SUBSET = new Set(
  (
    "abandon ability able about above absent absorb abstract absurd abuse access accident account accuse achieve acid " +
    "acoustic acquire across act action actor actress actual adapt add addict address adjust admit adult advance advice " +
    "aerobic affair afford afraid again age agent agree ahead aim air airport aisle alarm album alcohol alert alien all " +
    "alley allow almost alone alpha already also alter always amateur amazing among amount amused analyst anchor ancient " +
    "anger angle angry animal ankle announce annual another answer antenna antique anxiety any apart apology appear apple " +
    "approve april arch arctic area arena argue arm armed armor army around arrange arrest arrive arrow art artefact " +
    "artist artwork ask aspect assault asset assist assume asthma athlete atom attack attend attitude attract auction " +
    "audit august aunt author auto autumn average avocado avoid awake aware away awesome awful awkward axis baby bachelor " +
    "bacon badge bag balance balcony ball bamboo banana banner bar barely bargain barrel base basic basket battle beach " +
    "bean beauty because become beef before begin behave behind believe below belt bench benefit best betray better " +
    "between beyond bicycle bid bike bind biology bird birth bitter black blade blame blanket blast bleak bless blind " +
    "blood blossom blouse blue blur blush board boat body boil bomb bone bonus book boost border boring borrow boss " +
    "bottom bounce box boy bracket brain brand brass brave bread breeze brick bridge brief bright bring brisk broccoli " +
    "broken bronze broom brother brown brush bubble buddy budget buffalo build bulb bulk bullet bundle bunker burden " +
    "burger burst bus business busy butter buyer buzz cabbage cabin cable cactus cage cake call calm camera camp can " +
    "canal cancel candy cannon canoe canvas canyon capable capital captain car carbon card cargo carpet carry cart case " +
    "cash casino castle casual cat catalog catch category cattle caught cause caution cave ceiling celery cement census " +
    "century cereal certain chair chalk champion change chaos chapter charge chase chat cheap check cheese chef cherry " +
    "chest chicken chief child chimney choice choose chronic chuckle chunk churn cigar cinnamon circle citizen city civil " +
    "claim clap clarify claw clay clean clerk clever click client cliff climb clinic clip clock clog close cloth cloud " +
    "clown club clump cluster clutch coach coast coconut code coffee coil coin collect color column combine come comfort " +
    "comic common company concert conduct confirm congress connect consider control convince cook cool copper copy coral " +
    "core corn correct cost cotton couch country couple course cousin cover coyote crack cradle craft cram crane crash"
  ).split(/\s+/),
);

export interface GuardrailResult {
  ok: boolean;
  reason?: string;
}

function urlHosts(text: string): string[] {
  const hosts: string[] = [];
  for (const m of text.matchAll(/https?:\/\/([^\s/"'<>]+)/gi)) {
    hosts.push(m[1].toLowerCase().replace(/^www\./, ""));
  }
  // bare domains like pump.fun without protocol
  for (const m of text.matchAll(/(?:^|\s)((?:[a-z0-9-]+\.)+(?:com|io|so|fun|org|xyz|app|net|finance))(?:[/\s]|$)/gi)) {
    hosts.push(m[1].toLowerCase().replace(/^www\./, ""));
  }
  return hosts;
}

function hostBlocked(host: string): boolean {
  if (HARD_BLOCKED_HOSTS.some((b) => host === b || host.endsWith("." + b))) return true;
  return !ALLOWED_HOSTS.some((a) => host === a || host.endsWith("." + a));
}

function looksLikeSeedRun(text: string): boolean {
  const words = text.toLowerCase().split(/\s+/);
  let run: string[] = [];
  for (const w of words) {
    if (/^[a-z]{3,9}$/.test(w)) run.push(w);
    else {
      if (isSeedy(run)) return true;
      run = [];
    }
  }
  return isSeedy(run);
}

function isSeedy(run: string[]): boolean {
  if (run.length < 12) return false;
  // sliding window: 12 consecutive dictionary-looking words, most from bip39
  for (let i = 0; i + 12 <= run.length; i++) {
    const window = run.slice(i, i + 12);
    const hits = window.filter((w) => BIP39_SUBSET.has(w)).length;
    if (hits >= 9) return true;
  }
  return false;
}

/** the filter. returns {ok:false, reason} on the FIRST violation found. */
export function checkOutput(text: string): GuardrailResult {
  // tx hashes / private-key-shaped hex first (they contain the address pattern)
  if (/(?:0x)?[a-fA-F0-9]{64}/.test(text)) return { ok: false, reason: "tx-hash-or-key-shaped hex" };
  if (/0x[a-fA-F0-9]{40}/.test(text)) return { ok: false, reason: "evm address" };
  // solana / base58 (32-44 chars, no 0OIl)
  if (/(?:^|[^1-9A-HJ-NP-Za-km-z])[1-9A-HJ-NP-Za-km-z]{32,44}(?:[^1-9A-HJ-NP-Za-km-z]|$)/.test(text)) {
    return { ok: false, reason: "base58 address" };
  }
  if (/\b[a-z0-9][a-z0-9-]*\.eth\b/i.test(text)) return { ok: false, reason: "ens name" };

  for (const host of urlHosts(text)) {
    if (hostBlocked(host)) return { ok: false, reason: `link not allowlisted (${host})` };
  }

  if (/\b(seed|mnemonic|recovery)\s+(phrase|words?)\b/i.test(text)) return { ok: false, reason: "seed-phrase talk" };
  if (looksLikeSeedRun(text)) return { ok: false, reason: "seed-phrase-shaped word run" };
  if (/\b(send|dm|drop|share|paste|give)\b[^.]{0,40}\b(wallet|address|seed|private\s*key|keys)\b/i.test(text)) {
    return { ok: false, reason: "wallet-solicitation pattern" };
  }
  if (/\bprivate\s*key\b/i.test(text)) return { ok: false, reason: "private key mention" };

  return { ok: true };
}

/** wrapper used by the post pipeline: logs and drops on violation. */
export function guardOrDrop(text: string, context: string): string | null {
  const res = checkOutput(text);
  if (res.ok) return text;
  console.warn(`[kumo/twitter] guardrails BLOCKED (${context}): ${res.reason}`);
  say("agent", "kumo almost said something it shouldn't. kumo dropped it.");
  return null;
}
