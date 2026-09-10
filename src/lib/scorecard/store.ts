import "server-only";
import { redis } from "@/lib/redis/client";
import type { WeekVerdict } from "./pure";

// One record per league per week. Written twice: once before the slate locks,
// with what was recommended, and once after it finishes, with what happened.
//
// Two writes rather than one because the first has to be made before anybody
// could know the answer. A record assembled afterwards would be a story about
// what the app would have said, and the whole point is that it cannot be.

const TTL = 60 * 60 * 24 * 400; // A season plus room to look back at it.

const key = (season: string, week: number, leagueId: string) =>
  `scorecard:v1:${season}:w${week}:${leagueId}`;
const indexKey = (season: string) => `scorecard:v1:${season}:index`;

export interface Snapshot {
  season: string;
  week: number;
  leagueId: string;
  leagueName: string;
  /** When the recommendation was frozen. Before the lock, or it means nothing. */
  takenAt: string;
  rosterPositions: string[];
  roster: string[];
  /** Player ids in slot order for each candidate lineup. */
  started: string[];
  advised: string[];
  raw: string[];
  /** His "Last Updated" line, so a bad week can be traced to a stale list. */
  listUpdatedLabel: string | null;
  /** Names, kept so a settled week reads without a second player fetch. */
  names: Record<string, string>;
  positions: Record<string, string>;
}

export interface Settled extends Snapshot {
  settledAt: string;
  perfect: string[];
  verdict: WeekVerdict;
  points: Record<string, number>;
}

export type Record_ = Snapshot | Settled;

export function isSettled(r: Record_): r is Settled {
  return "settledAt" in r;
}

export async function readWeek(
  season: string,
  week: number,
  leagueId: string,
): Promise<Record_ | null> {
  try {
    return (await redis.get<Record_>(key(season, week, leagueId))) ?? null;
  } catch {
    return null;
  }
}

export async function writeWeek(record: Record_): Promise<void> {
  try {
    await redis.set(key(record.season, record.week, record.leagueId), record, { ex: TTL });
    // An index, because there is no key listing on this client and a scorecard
    // that cannot enumerate its own weeks cannot show a season total.
    const seen = (await redis.get<string[]>(indexKey(record.season))) ?? [];
    const entry = `${record.week}:${record.leagueId}`;
    if (!seen.includes(entry)) {
      await redis.set(indexKey(record.season), [...seen, entry].slice(-400), { ex: TTL });
    }
  } catch {
    /* A missing record costs one week of evidence, never the lineup itself. */
  }
}

/** Every record for a league this season, oldest week first. */
export async function readSeason(season: string, leagueId: string): Promise<Record_[]> {
  try {
    const seen = (await redis.get<string[]>(indexKey(season))) ?? [];
    const weeks = seen
      .map((e) => e.split(":"))
      .filter(([, id]) => id === leagueId)
      .map(([w]) => Number(w))
      .filter((w) => Number.isFinite(w))
      .sort((a, b) => a - b);
    const out = await Promise.all(weeks.map((w) => readWeek(season, w, leagueId)));
    return out.filter((r): r is Record_ => r !== null);
  } catch {
    return [];
  }
}
