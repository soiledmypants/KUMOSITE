// mention poller: every 2 min, since_id cursor in db, reply-only (never quote,
// never like). mention text is UNTRUSTED — a hard pre-filter runs BEFORE the
// composer ever sees it: anything carrying a contract address, tx hash, dex
// link, or shill pattern gets silently skipped. no witty dunk — any reply to a
// CA mention is farmable as a fake endorsement screenshot.
import { db, getMeta, setMeta } from "../db.js";
import { compose } from "./composer.js";
import { getClient, postTweet, selfId, killswitchOn } from "./post.js";

const MAX_REPLIES_PER_DAY = Number(process.env.TWITTER_MAX_REPLIES_PER_DAY ?? 20);
const MAX_REPLIES_PER_USER_PER_HOUR = Number(process.env.TWITTER_MAX_REPLIES_PER_USER_HOUR ?? 1);
const CURSOR_KEY = "twitter_mentions_since_id";

/** true when a mention must never reach the composer */
export function shouldSkipMention(text: string, hasMedia: boolean): string | null {
  if (hasMedia) return "has media (could be an address screenshot)";
  if (/0x[a-fA-F0-9]{40}/.test(text)) return "contains evm address";
  if (/(?:0x)?[a-fA-F0-9]{64}/.test(text)) return "contains tx hash";
  if (/(?:^|[^1-9A-HJ-NP-Za-km-z])[1-9A-HJ-NP-Za-km-z]{32,44}(?:[^1-9A-HJ-NP-Za-km-z]|$)/.test(text)) {
    return "contains base58 address";
  }
  if (/\b[a-z0-9][a-z0-9-]*\.eth\b/i.test(text)) return "contains ens name";
  if (/pump\.fun|dexscreener|birdeye|solscan|etherscan|basescan|blockscout|dextools|geckoterminal/i.test(text)) {
    return "contains dex/scanner link";
  }
  if (/\bcheck\s+out\s+(my|this|our)\b|\b(shill|ape)\s+(this|my)\b|\bnew\s+(token|coin|gem)\b.{0,30}\bca\b/i.test(text)) {
    return "token shill pattern";
  }
  if (/\bca\s*[:=]\s*\S/i.test(text)) return "ca: pattern";
  return null;
}

async function repliesToday(): Promise<number> {
  const midnight = new Date();
  midnight.setUTCHours(0, 0, 0, 0);
  const row = await db.get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM mentions WHERE handled_at > ? AND status = 'replied'",
    [midnight.getTime()],
  );
  return Number(row?.n ?? 0);
}

async function repliedToUserRecently(author: string): Promise<boolean> {
  const row = await db.get(
    "SELECT id FROM mentions WHERE author = ? AND status = 'replied' AND handled_at > ?",
    [author.toLowerCase(), Date.now() - 3_600_000 / Math.max(1, MAX_REPLIES_PER_USER_PER_HOUR)],
  );
  return Boolean(row);
}

async function markMention(id: string, author: string, status: string, note?: string): Promise<void> {
  await db.run(
    "INSERT INTO mentions (mention_id, author, status, note, handled_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (mention_id) DO NOTHING",
    [id, author.toLowerCase(), status, note ?? null, Date.now()],
  );
}

export async function pollMentionsOnce(): Promise<void> {
  if (killswitchOn()) return;
  const c = getClient();
  if (!c) return;
  const self = await selfId();
  if (!self) return;

  const sinceId = await getMeta(CURSOR_KEY);
  const timeline = await c.v2.userMentionTimeline(self.id, {
    ...(sinceId ? { since_id: sinceId } : {}),
    max_results: 25,
    expansions: ["author_id", "attachments.media_keys"],
    "tweet.fields": ["author_id", "attachments", "referenced_tweets"],
    "user.fields": ["username"],
  });

  const tweets = timeline.data.data ?? [];
  if (tweets.length === 0) return;

  // advance the cursor first — a crash mid-batch must not cause double replies
  const newest = tweets.reduce((a, b) => (BigInt(a.id) > BigInt(b.id) ? a : b));
  await setMeta(CURSOR_KEY, newest.id);

  const users = new Map((timeline.data.includes?.users ?? []).map((u) => [u.id, u.username]));

  // oldest first
  for (const t of [...tweets].sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1))) {
    const author = (users.get(t.author_id ?? "") ?? "someone").toLowerCase();
    if (author === self.handle) continue; // never reply to ourselves

    const already = await db.get("SELECT id FROM mentions WHERE mention_id = ?", [t.id]);
    if (already) continue;

    const hasMedia = Boolean(t.attachments?.media_keys?.length);
    const skip = shouldSkipMention(t.text ?? "", hasMedia);
    if (skip) {
      await markMention(t.id, author, "skipped", skip);
      continue;
    }
    if ((await repliesToday()) >= MAX_REPLIES_PER_DAY) {
      await markMention(t.id, author, "skipped", "daily reply cap");
      continue;
    }
    if (await repliedToUserRecently(author)) {
      await markMention(t.id, author, "skipped", "per-user rate limit");
      continue;
    }

    const reply = await compose({ type: "reply", mentionText: t.text ?? "", authorHandle: author });
    if (!reply) {
      await markMention(t.id, author, "skipped", "composer returned nothing");
      continue;
    }
    const result = await postTweet(reply, { kind: "reply", inReplyTo: t.id });
    await markMention(t.id, author, result.posted || result.dryRun ? "replied" : "skipped", result.dropped);
  }
}
