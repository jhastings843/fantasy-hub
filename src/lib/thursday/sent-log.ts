import "server-only";
import { redis } from "@/lib/redis/client";

// One Thursday email per week, however many times the route is called.
//
// The same argument the guillotine guide makes: Vercel retries a cron run that
// fails or times out, the send happens near the end of the handler, and a retry
// after a slow Sleeper response means a second identical email. Two arrived 44
// seconds apart while that one was being built, which is why this exists here
// from the start rather than after it happens again.
//
// Keyed by week rather than by day, because the email for week 4 is the email
// for week 4. A second call in the same week is a no-op unless it is told
// otherwise.

const TTL = 60 * 60 * 24 * 10;

const key = (season: string, week: number) => `thursday:v1:sent:${season}:w${week}`;

export interface ThursdaySendRecord {
  sentAt: string;
  subject: string;
  messageId?: string;
}

export async function alreadySent(
  season: string,
  week: number,
): Promise<ThursdaySendRecord | null> {
  try {
    return (await redis.get<ThursdaySendRecord>(key(season, week))) ?? null;
  } catch {
    // A store that cannot be read must not become a store that blocks the send.
    // Missing the record risks a duplicate; refusing to send loses the week.
    return null;
  }
}

export async function recordSent(
  season: string,
  week: number,
  record: ThursdaySendRecord,
): Promise<void> {
  try {
    await redis.set(key(season, week), record, { ex: TTL });
  } catch {
    /* The send happened. Failing to write the receipt is not worth throwing. */
  }
}

export async function clearSent(season: string, week: number): Promise<void> {
  try {
    await redis.del(key(season, week));
  } catch {
    /* Nothing to undo. */
  }
}
