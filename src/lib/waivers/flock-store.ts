import "server-only";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { redis } from "@/lib/redis/client";
import { parseFlock, type FlockRow } from "./flock";

// Flock Fantasy's waiver email, out of Jack's inbox and into Redis.
//
// Same mailbox and app password as the Jingles inbox reader (jingles/inbox.ts).
// Read once by the midweek send before it builds, so the three league builds
// that follow read Redis rather than opening three IMAP sessions.

const SENDER = "flockfantasy@mail.beehiiv.com";
const TTL = 60 * 60 * 24 * 21;
const key = (season: string, week: number) => `waivers:v1:flock:${season}:w${week}`;

export interface StoredFlock {
  week: number;
  subject: string;
  receivedAt: string;
  rows: FlockRow[];
}

export async function readFlock(season: string, week: number): Promise<StoredFlock | null> {
  try {
    return (await redis.get<StoredFlock>(key(season, week))) ?? null;
  } catch {
    return null;
  }
}

/**
 * Store every Flock waiver email from the last ten days. Never throws: a dead
 * mailbox costs the backup source, not the email.
 */
export async function refreshFlock(season: string): Promise<string> {
  const user = process.env.GMAIL_USER || process.env.GMAIL_ADDRESS;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return "Flock: no inbox credentials";

  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user, pass },
    logger: false,
    socketTimeout: 30_000,
  });
  const stored: string[] = [];
  let lock;
  try {
    await client.connect();
    lock = await client.getMailboxLock("INBOX");
    const since = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    for await (const message of client.fetch({ from: SENDER, since }, { source: true, envelope: true })) {
      const subject = message.envelope?.subject ?? "";
      if (!/waiver/i.test(subject)) continue;
      const parsed = await simpleParser(message.source as Buffer).catch(() => null);
      const html = parsed ? String(parsed.html || parsed.textAsHtml || "") : "";
      const { week, rows } = parseFlock(html, subject);
      // A layout change that parses to nothing must not overwrite a good week.
      if (!week || !rows.some((r) => r.section === "add")) continue;
      const value: StoredFlock = { week, subject, receivedAt: (parsed?.date ?? new Date()).toISOString(), rows };
      await redis.set(key(season, week), value, { ex: TTL });
      stored.push(`week ${week} (${rows.length} rows)`);
    }
  } catch (e) {
    return `Flock: inbox unavailable (${(e as Error).message})`;
  } finally {
    if (lock) lock.release();
    try {
      await client.logout();
    } catch {
      /* already gone */
    }
  }
  return stored.length ? `Flock: stored ${stored.join(", ")}` : "Flock: no waiver email in the last 10 days";
}
