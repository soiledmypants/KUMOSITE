// the ONLY place in the codebase that talks to the twitter write api.
// pipeline: killswitch -> daily cap -> dedupe -> guardrails -> DRY_RUN or post.
// nothing else may import twitter-api-v2's write surface.
import { createHash } from "node:crypto";
import { TwitterApi } from "twitter-api-v2";
import { db } from "../db.js";
import { say } from "../voice.js";
import { guardOrDrop } from "./guardrails.js";

const MAX_TWEETS_PER_DAY = Number(process.env.TWITTER_MAX_TWEETS_PER_DAY ?? 30);

let client: TwitterApi | null = null;
let selfUserId: string | null = null;
let selfHandle: string | null = null;
let disabledLogged = false;

export function twitterConfigured(): boolean {
  return Boolean(
    process.env.TWITTER_API_KEY &&
      process.env.TWITTER_API_SECRET &&
      process.env.TWITTER_ACCESS_TOKEN &&
      process.env.TWITTER_ACCESS_SECRET,
  );
}

export function dryRun(): boolean {
  return (process.env.TWITTER_DRY_RUN ?? "true") === "true";
}

/** halt everything instantly via env, checked before EVERY post */
export function killswitchOn(): boolean {
  const v = process.env.KILLSWITCH ?? process.env.TWITTER_KILLSWITCH ?? "";
  return v === "true" || v === "1";
}

export function getClient(): TwitterApi | null {
  if (client) return client;
  if (!twitterConfigured()) {
    if (!disabledLogged) {
      console.log("[kumo/twitter] no api credentials — twitter module inactive" + (dryRun() ? " (dry-run composing still works)" : ""));
      disabledLogged = true;
    }
    return null;
  }
  client = new TwitterApi({
    appKey: process.env.TWITTER_API_KEY!,
    appSecret: process.env.TWITTER_API_SECRET!,
    accessToken: process.env.TWITTER_ACCESS_TOKEN!,
    accessSecret: process.env.TWITTER_ACCESS_SECRET!,
  });
  return client;
}

export async function selfId(): Promise<{ id: string; handle: string } | null> {
  if (selfUserId && selfHandle) return { id: selfUserId, handle: selfHandle };
  const c = getClient();
  if (!c) return null;
  const me = await c.v2.me();
  selfUserId = me.data.id;
  selfHandle = me.data.username.toLowerCase();
  return { id: selfUserId, handle: selfHandle };
}

function norm(text: string): string {
  return createHash("sha256").update(text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()).digest("hex");
}

async function tweetsToday(): Promise<number> {
  const midnight = new Date();
  midnight.setUTCHours(0, 0, 0, 0);
  const row = await db.get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM tweets WHERE ts > ? AND status = 'posted'",
    [midnight.getTime()],
  );
  return Number(row?.n ?? 0);
}

async function isDuplicate(hash: string): Promise<boolean> {
  const row = await db.get("SELECT id FROM tweets WHERE text_hash = ? AND ts > ?", [
    hash,
    Date.now() - 7 * 86_400_000,
  ]);
  return Boolean(row);
}

export interface PostResult {
  posted: boolean;
  dryRun?: boolean;
  tweetId?: string;
  dropped?: string; // reason
}

export async function postTweet(
  text: string,
  opts: { kind: string; inReplyTo?: string } = { kind: "tweet" },
): Promise<PostResult> {
  if (killswitchOn()) {
    console.warn(`[kumo/twitter] killswitch on — dropped ${opts.kind}`);
    return { posted: false, dropped: "killswitch" };
  }
  if ((await tweetsToday()) >= MAX_TWEETS_PER_DAY) {
    return { posted: false, dropped: "daily tweet cap" };
  }

  const hash = norm(text);
  if (await isDuplicate(hash)) {
    return { posted: false, dropped: "duplicate of recent tweet" };
  }

  // the hard filter — runs on every path, last, right before the wire
  const safe = guardOrDrop(text, opts.kind);
  if (safe === null) {
    await db.run("INSERT INTO tweets (ts, kind, text, text_hash, status) VALUES (?, ?, ?, ?, 'blocked')", [
      Date.now(),
      opts.kind,
      text.slice(0, 500),
      hash,
    ]);
    return { posted: false, dropped: "guardrails" };
  }

  if (dryRun()) {
    console.log(`[kumo/twitter] DRY_RUN ${opts.kind}${opts.inReplyTo ? ` (reply to ${opts.inReplyTo})` : ""}: ${safe}`);
    say("agent", `kumo drafted a tweet (dry-run): "${safe.slice(0, 80)}${safe.length > 80 ? "..." : ""}"`);
    await db.run("INSERT INTO tweets (ts, kind, text, text_hash, in_reply_to, status) VALUES (?, ?, ?, ?, ?, 'dry-run')", [
      Date.now(),
      opts.kind,
      safe,
      hash,
      opts.inReplyTo ?? null,
    ]);
    return { posted: false, dryRun: true };
  }

  const c = getClient();
  if (!c) return { posted: false, dropped: "no credentials" };

  const res = await c.v2.tweet(safe, opts.inReplyTo ? { reply: { in_reply_to_tweet_id: opts.inReplyTo } } : undefined);
  await db.run(
    "INSERT INTO tweets (ts, kind, text, text_hash, in_reply_to, tweet_id, status) VALUES (?, ?, ?, ?, ?, ?, 'posted')",
    [Date.now(), opts.kind, safe, hash, opts.inReplyTo ?? null, res.data.id],
  );
  say("agent", `kumo tweeted. the humans will see it shortly.`);
  return { posted: true, tweetId: res.data.id };
}
