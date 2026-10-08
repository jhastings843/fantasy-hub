import "server-only";
import { redis } from "@/lib/redis/client";
import type { League } from "./parse";
import { key } from "./engine";
import type { TotalsSeen } from "./totals";

// The forward archive for totals agreement. Neither site keeps a history of
// its totals, so the first time a game has both models' projected totals and
// a current quote on the board together, that triple is saved and never
// rewritten. Later moves in either model or the market do not change it,
// which keeps the archive free of hindsight. One key per week.

const weekKey = (league: League, season: number, week: number) => `picks:v1:${league}:totals:${season}:w${week}`;
const indexKey = (league: League, season: number) => `picks:v1:${league}:totals:${season}`;

/** Adds games not on file yet. Returns how many were new. */
export async function archiveTotals(league: League, season: number, week: number, rows: TotalsSeen[]): Promise<number> {
  if (!rows.length) return 0;
  const stored = (await redis.get<TotalsSeen[]>(weekKey(league, season, week))) ?? [];
  const have = new Set(stored.map(key));
  const fresh = rows.filter((r) => !have.has(key(r)));
  if (!fresh.length) return 0;
  await redis.set(weekKey(league, season, week), [...stored, ...fresh]);
  await redis.sadd(indexKey(league, season), week);
  return fresh.length;
}

export async function loadTotalsSeen(league: League, season: number): Promise<TotalsSeen[]> {
  try {
    const weeks = (await redis.smembers(indexKey(league, season))).map(Number);
    const all = await Promise.all(weeks.map((w) => redis.get<TotalsSeen[]>(weekKey(league, season, w))));
    return all.flatMap((x) => x ?? []);
  } catch {
    return [];
  }
}
