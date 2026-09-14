import "server-only";
import { redis } from "@/lib/redis/client";

// One of each email per week, however many times the pulse fires.
//
// The Thursday email and the FAAB guide each grew their own copy of this when
// they were the only two. There are five now and the heartbeat calls them
// every fifteen minutes until the send log says they went, so the log is no
// longer a safety net against a cron retry: it IS the schedule. Hence one
// implementation, keyed by which email it is.
//
// The two older logs are deliberately left where they are. They hold live
// records for this week, and moving a key is how you send a duplicate.

/** Long enough to cover the week, short enough that a season does not pile up. */
const TTL = 60 * 60 * 24 * 10;

const key = (id: string, season: string, week: number) =>
  `email:v1:sent:${id}:${season}:w${week}`;

export interface SentRecord {
  sentAt: string;
  subject: string;
  messageId?: string;
  /** For the alarm, which sends only sometimes: what set it off. */
  note?: string;
}

export async function alreadySent(
  id: string,
  season: string,
  week: number,
): Promise<SentRecord | null> {
  try {
    return (await redis.get<SentRecord>(key(id, season, week))) ?? null;
  } catch {
    // A store that cannot be read must not become a store that blocks the
    // send: missing the record risks a duplicate, refusing loses the week.
    return null;
  }
}

export async function recordSent(
  id: string,
  season: string,
  week: number,
  record: SentRecord,
): Promise<void> {
  try {
    await redis.set(key(id, season, week), record, { ex: TTL });
  } catch {
    /* The send happened. Failing to write the receipt is not worth throwing. */
  }
}

export async function clearSent(id: string, season: string, week: number): Promise<void> {
  try {
    await redis.del(key(id, season, week));
  } catch {
    /* Nothing to undo. */
  }
}

/**
 * A short lock held while a send is being decided and made.
 *
 * The send log makes an email idempotent per week, but only once it has been
 * WRITTEN. Between reading "not sent yet" and recording the send there is a
 * gap several seconds wide, because building the report is the slow part, and
 * two callers now land in that gap on the same morning: the Vercel cron at
 * 08:00 and the pulse, which is also due at 08:00. One of them has to lose.
 *
 * Deliberately short. If a run dies holding this, the next pulse fifteen
 * minutes later must be able to take it, and two minutes is longer than any
 * send has ever taken.
 */
const LOCK_TTL = 120;

const lockKey = (id: string) => `email:v1:lock:${id}`;

export async function acquireSendLock(id: string): Promise<boolean> {
  try {
    const got = await redis.set(lockKey(id), Date.now(), { nx: true, ex: LOCK_TTL });
    return got === "OK";
  } catch {
    // Same argument as the read above: an unreachable store must not stop the
    // week's email. The send log still catches the duplicate on the next run.
    return true;
  }
}

export async function releaseSendLock(id: string): Promise<void> {
  try {
    await redis.del(lockKey(id));
  } catch {
    /* It expires on its own. */
  }
}

/**
 * Run a send under its lock, or say who has it.
 *
 * Wraps the whole decision, not just the send, because the decision is the
 * part that takes time.
 */
export async function withSendLock(
  id: string,
  run: () => Promise<Response>,
): Promise<Response> {
  if (!(await acquireSendLock(id))) {
    return Response.json({
      ok: true,
      skipped: true,
      reason: `Another run is already sending the ${id} email.`,
    });
  }
  try {
    return await run();
  } finally {
    await releaseSendLock(id);
  }
}
