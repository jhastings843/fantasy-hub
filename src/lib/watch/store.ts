import "server-only";
import { redis } from "@/lib/redis/client";

// What Jack has already been told about this week's lineups, by change key
// (see watchItems). The Wednesday email seeds it; each watch email adds to it.
// A change stays "seen" even after he makes it, so undoing it would not
// re-alert, which is the right trade: the watch is for news, not for nagging.

const TTL = 60 * 60 * 24 * 10;
const seenKey = (season: string, week: number) => `watch:v1:seen:${season}:w${week}`;
const checkedKey = (season: string, week: number, day: number) =>
  `watch:v1:checked:${season}:w${week}:d${day}`;

export async function readSeen(season: string, week: number): Promise<string[]> {
  try {
    return (await redis.get<string[]>(seenKey(season, week))) ?? [];
  } catch {
    return [];
  }
}

export async function addSeen(season: string, week: number, keys: string[]): Promise<void> {
  try {
    const all = [...new Set([...(await readSeen(season, week)), ...keys])];
    await redis.set(seenKey(season, week), all, { ex: TTL });
  } catch {
    /* Worst case the next check repeats a change. */
  }
}

export async function checkedToday(season: string, week: number, day: number): Promise<boolean> {
  try {
    return (await redis.get(checkedKey(season, week, day))) != null;
  } catch {
    return false;
  }
}

export async function recordChecked(season: string, week: number, day: number): Promise<void> {
  try {
    await redis.set(checkedKey(season, week, day), Date.now(), { ex: TTL });
  } catch {
    /* A second check today costs a rebuild, and sends nothing already seen. */
  }
}
