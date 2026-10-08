import "server-only";
import { redis } from "@/lib/redis/client";
import type { League } from "./parse";
import type { IssuedRecord } from "./issued";
import type { Slot } from "./update";

// Issued picks, one key per league, week and send, written once when the email
// goes out and never overwritten (a resend keeps the first record). Tuesday's
// card keeps the original key; game-day updates add ":sat" / ":sun". Separate
// from the board snapshots, which follow the live board and are research
// history.

const recKey = (league: League, season: number, week: number, slot: Slot = "tue") =>
  `picks:v1:${league}:issued:${season}:w${week}${slot === "tue" ? "" : `:${slot}`}`;
const indexKey = (league: League, season: number) => `picks:v1:${league}:issued:${season}`;
const member = (week: number, slot: Slot = "tue") => (slot === "tue" ? String(week) : `${week}:${slot}`);

/** True when written; false when this week and send already has a record. */
export async function saveIssued(rec: IssuedRecord): Promise<boolean> {
  const ok = await redis.set(recKey(rec.league, rec.season, rec.week, rec.slot), rec, { nx: true });
  await redis.sadd(indexKey(rec.league, rec.season), member(rec.week, rec.slot));
  return ok === "OK";
}

export async function loadIssued(league: League, season: number): Promise<IssuedRecord[]> {
  try {
    const members = (await redis.smembers(indexKey(league, season))).map(String);
    const recs = await Promise.all(
      members.map((m) => {
        const [w, slot] = m.split(":");
        return redis.get<IssuedRecord>(recKey(league, season, Number(w), (slot as Slot) ?? "tue"));
      }),
    );
    return recs.filter((r): r is IssuedRecord => !!r);
  } catch {
    return [];
  }
}
