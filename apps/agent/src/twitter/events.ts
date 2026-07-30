// internal event bus feeding the tweet pipeline: emitters anywhere in the
// backend call emitKumoEvent() -> composer -> guardrails -> post. the keeper
// emits fee_claimed after a successful buyback+notify, trade execution emits
// trade_found, the wallet scanner emits wallet_alert, and a jittered timer
// emits heartbeats. all of it lands in postTweet(), the single guarded door.
import { compose, type KumoEvent } from "./composer.js";
import { postTweet, twitterConfigured, dryRun, killswitchOn } from "./post.js";
import { pollMentionsOnce } from "./mentions.js";

const MENTIONS_POLL_MS = Number(process.env.TWITTER_MENTIONS_POLL_MS ?? 120_000);
const HEARTBEAT_MS = Number(process.env.TWITTER_HEARTBEAT_MS ?? 4 * 3600 * 1000);
const EVENT_COOLDOWN_MS = Number(process.env.TWITTER_EVENT_COOLDOWN_MS ?? 15 * 60_000);

const lastByType = new Map<string, number>();
let started = false;

export function emitKumoEvent(ev: Exclude<KumoEvent, { type: "reply" }>): void {
  void (async () => {
    try {
      if (killswitchOn()) return;
      if (!twitterConfigured() && !dryRun()) return;
      // per-type cooldown so a busy keeper/scanner doesn't flood the timeline
      const last = lastByType.get(ev.type) ?? 0;
      if (ev.type !== "fee_claimed" && Date.now() - last < EVENT_COOLDOWN_MS) return;
      lastByType.set(ev.type, Date.now());

      const text = await compose(ev);
      if (!text) return;
      await postTweet(text, { kind: ev.type });
    } catch (err) {
      console.error("[kumo/twitter] event pipeline error:", (err as Error).message);
    }
  })();
}

export function startTwitter(): void {
  if (started) return;
  started = true;

  if (!twitterConfigured() && !dryRun()) {
    console.log("[kumo/twitter] inactive (no credentials, dry-run off)");
    return;
  }
  console.log(`[kumo/twitter] persona active (dry_run=${dryRun()}, killswitch=${killswitchOn()})`);

  // heartbeat musings with +-25% jitter so the timeline doesn't look cron-shaped
  const scheduleHeartbeat = () => {
    const jitter = HEARTBEAT_MS * (0.75 + Math.random() * 0.5);
    setTimeout(() => {
      emitKumoEvent({ type: "heartbeat" });
      scheduleHeartbeat();
    }, jitter).unref();
  };
  scheduleHeartbeat();

  // mentions poll (needs real credentials to read the timeline)
  if (twitterConfigured()) {
    let polling = false;
    setInterval(() => {
      if (polling) return;
      polling = true;
      pollMentionsOnce()
        .catch((err) => console.error("[kumo/twitter] mentions poll error:", (err as Error).message))
        .finally(() => {
          polling = false;
        });
    }, MENTIONS_POLL_MS).unref();
  }
}
