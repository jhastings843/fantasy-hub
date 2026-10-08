import "server-only";
import { redis } from "@/lib/redis/client";
import type { League } from "./parse";
import type { IssuedRecord } from "./issued";

// Issued picks, one key per league and week, written once when the email goes
// out and never overwritten (a resend keeps the first record). Separate from
// the board snapshots, which follow the live board and are research history.

const recKey = (league: League, season: number, week: number) => `picks:v1:${league}:issued:${season}:w${week}`;
const indexKey = (league: League, season: number) => `picks:v1:${league}:issued:${season}`;

/** True when written; false when this week already has a record. */
export async function saveIssued(rec: IssuedRecord): Promise<boolean> {
  const ok = await redis.set(recKey(rec.league, rec.season, rec.week), rec, { nx: true });
  await redis.sadd(indexKey(rec.league, rec.season), rec.week);
  return ok === "OK";
}

export async function loadIssued(league: League, season: number): Promise<IssuedRecord[]> {
  try {
    const weeks = (await redis.smembers(indexKey(league, season))).map(Number).sort((a, b) => a - b);
    const recs = await Promise.all(weeks.map((w) => redis.get<IssuedRecord>(recKey(league, season, w))));
    return recs.filter((r): r is IssuedRecord => !!r);
  } catch {
    return [];
  }
}
