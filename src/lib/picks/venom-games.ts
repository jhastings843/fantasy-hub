// Venom Analytics' NFL Game Cheat Code as an outside source (Jack, 2026-11-08:
// "add it, tracked only"). scripts/venom-reader.mjs reads the tab in Jack's own
// Chrome each Tuesday and Wednesday (and backfilled Weeks 3-9 of 2026; Weeks 1-2
// have no board) and scripts/venom-upload.mjs stores one row per game:
//
//   venom:v1:nfl:games:{season}:w{week}   { read, rows: VenomGameRow[] }
//   venom:v1:nfl:games:{season}:weeks     set of weeks
//
// Lines are home side, betting style, as the picks engine uses. Members-only
// data: Redis only, never the repo. Venom never bets on his own; his records
// sit on the NFL ATS page beside PEM's and his third-vote cuts are tracked.

import "server-only";
import { redis } from "@/lib/redis/client";
import type { VenomLine } from "./engine";

export interface VenomGameRow extends VenomLine {
  away: string;
  home: string;
  kickoff: string;
}

export interface VenomGamesWeek {
  week: number;
  /** The day the reader read the board (backfilled weeks were read after the games). */
  read: string | null;
  rows: VenomGameRow[];
}

const KEY = (season: number, week: number) => `venom:v1:nfl:games:${season}:w${week}`;
const WEEKS = (season: number) => `venom:v1:nfl:games:${season}:weeks`;

export async function venomGameWeeks(season: number): Promise<VenomGamesWeek[]> {
  try {
    const weeks = (await redis.smembers(WEEKS(season))).map(Number).sort((a, b) => a - b);
    const all = await Promise.all(weeks.map(async (w) => ({ w, d: await redis.get<{ read: string | null; rows: VenomGameRow[] }>(KEY(season, w)) })));
    return all.filter((x) => x.d && Array.isArray(x.d.rows)).map((x) => ({ week: x.w, read: x.d!.read, rows: x.d!.rows }));
  } catch {
    return [];
  }
}

/** One line per game, keyed like engine.key: "week:AWAY@HOME". */
export function venomLines(weeks: VenomGamesWeek[]): Map<string, VenomLine> {
  const out = new Map<string, VenomLine>();
  for (const w of weeks)
    for (const r of w.rows)
      out.set(`${w.week}:${r.away}@${r.home}`, { model: r.model, market: r.market, modelTotal: r.modelTotal, total: r.total, edgeSide: r.edgeSide, edgeTotal: r.edgeTotal });
  return out;
}
