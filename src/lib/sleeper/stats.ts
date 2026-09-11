import "server-only";
import { scoreStatLine, type ScoringSettings } from "@/lib/guillotine/scoring";

// What players have actually scored this week.
//
// Deliberately uncached, unlike the projection feed next door. A projection is
// settled for the week and worth six hours in Redis; a live score moves every
// few minutes while games are on, and a lineup page quoting a number eight
// minutes old is quoting a number Jack can see is wrong on his phone.
//
// The fetch is one request against a feed that only carries players who have
// played, which on a Friday in week 1 is three hundred rows.

const STATS_BASE = "https://api.sleeper.app/v1/stats/nfl/regular";

export type StatRows = Record<string, Record<string, number>>;

export async function getWeekStats(season: string, week: number): Promise<StatRows> {
  const res = await fetch(`${STATS_BASE}/${season}/${week}`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Sleeper stats failed: ${res.status} ${res.statusText} (${season}/${week})`);
  }
  return (await res.json()) as StatRows;
}

/** One week of stat lines scored under one league's own settings. */
export function scoreRows(rows: StatRows, scoring: ScoringSettings): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [playerId, stats] of Object.entries(rows)) {
    out[playerId] = Number(scoreStatLine(stats, scoring).toFixed(2));
  }
  return out;
}
