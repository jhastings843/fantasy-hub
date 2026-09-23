import "server-only";
import { redis } from "@/lib/redis/client";
import { cached } from "@/lib/redis/cached";
import { getLeagueMatchups } from "@/lib/sleeper/client";
import type { SleeperRoster } from "@/lib/sleeper/types";
import type { WeekResult } from "./results";
import {
  aliveFromRosters,
  choppedSince,
  winningBidsFrom,
  type RosterSnapshot,
  type WinningBid,
} from "./roster-diff";

// The IO half of chop detection. The reasoning lives in roster-diff.ts; this
// file only reads Sleeper, reads and writes the weekly snapshot, and hands the
// pure functions what they need.

const SNAPSHOT_TTL = 60 * 60 * 24 * 30;
const TRANSACTIONS_TTL = 30 * 60;

const snapshotKey = (leagueId: string, week: number) =>
  `guillotine:v1:snapshot:${leagueId}:w${week}`;

export interface LeagueState {
  /** Rosters that still hold players. An empty roster has been liquidated. */
  aliveRosterIds: number[];
  eliminatedRosterIds: number[];
  /** Players who left a roster that is now empty, this week. */
  choppedPlayerIds: string[];
  /** Every player rostered anywhere right now. */
  rosteredPlayerIds: Set<string>;
  /** roster_id to FAAB still available. */
  faabRemaining: Record<number, number>;
  caveats: string[];
}

export async function readSnapshot(
  leagueId: string,
  week: number,
): Promise<RosterSnapshot | null> {
  try {
    return (await redis.get<RosterSnapshot>(snapshotKey(leagueId, week))) ?? null;
  } catch {
    return null;
  }
}

export async function writeSnapshot(
  leagueId: string,
  snapshot: RosterSnapshot,
): Promise<void> {
  try {
    await redis.set(snapshotKey(leagueId, snapshot.week), snapshot, { ex: SNAPSHOT_TTL });
  } catch (e) {
    console.warn(`[guillotine] snapshot write failed: ${e instanceof Error ? e.message : e}`);
  }
}

export async function readLeagueState(
  leagueId: string,
  week: number,
  rosters: SleeperRoster[],
  budget: number,
): Promise<LeagueState> {
  const { alive, eliminated } = aliveFromRosters(rosters);

  const previous = await readSnapshot(leagueId, week - 1);
  const choppedPlayerIds = choppedSince(previous, rosters);

  const rosteredPlayerIds = new Set<string>();
  for (const roster of rosters) {
    for (const id of roster.players ?? []) rosteredPlayerIds.add(id);
  }

  const faabRemaining: Record<number, number> = {};
  for (const roster of rosters) {
    faabRemaining[roster.roster_id] = Math.max(
      0,
      budget - (roster.settings?.waiver_budget_used ?? 0),
    );
  }

  const caveats: string[] = [];
  if (!previous && week > 1) {
    caveats.push(
      `No roster snapshot from week ${week - 1}, so this report cannot tell which players came off the chopped roster. It will be able to from next week on.`,
    );
  }
  if (eliminated.length > 0 && choppedPlayerIds.length === 0 && previous) {
    caveats.push(
      "A roster is empty but nothing new reached the pool, which usually means the commissioner has not force-dropped the chopped team yet.",
    );
  }

  return {
    aliveRosterIds: alive,
    eliminatedRosterIds: eliminated,
    choppedPlayerIds,
    rosteredPlayerIds,
    faabRemaining,
    caveats,
  };
}

export interface RawTransaction {
  type?: string;
  status?: string;
  leg?: number;
  adds?: Record<string, number> | null;
  settings?: { waiver_bid?: number } | null;
}

/** Winning FAAB bids in one week, from Sleeper's transaction feed. */
export function getWeekTransactions(
  leagueId: string,
  week: number,
): Promise<RawTransaction[]> {
  return cached(
    `guillotine:v1:tx:${leagueId}:w${week}`,
    TRANSACTIONS_TTL,
    async () => {
      const res = await fetch(
        `https://api.sleeper.app/v1/league/${leagueId}/transactions/${week}`,
        { cache: "no-store" },
      );
      if (!res.ok) return [] as RawTransaction[];
      return (await res.json()) as RawTransaction[];
    },
  );
}

/** Every winning bid so far this season, one call per week. */
export async function seasonBids(leagueId: string, throughWeek: number): Promise<WinningBid[]> {
  const weeks = Array.from({ length: Math.max(0, throughWeek) }, (_, i) => i + 1);
  const perWeek = await Promise.all(
    weeks.map(async (week) => winningBidsFrom(await getWeekTransactions(leagueId, week), week)),
  );
  return perWeek.flat();
}

/**
 * Every completed week's scores, one call per week. A week Sleeper has no
 * scores for (not yet played, or a fetch failure) is left out rather than
 * recorded as zeros, so a bad fetch cannot read as a league-wide collapse.
 */
export async function seasonResults(
  leagueId: string,
  throughWeek: number,
): Promise<WeekResult[]> {
  const weeks = Array.from({ length: Math.max(0, throughWeek) }, (_, i) => i + 1);
  const perWeek = await Promise.all(
    weeks.map(async (week): Promise<WeekResult | null> => {
      try {
        const matchups = await getLeagueMatchups(leagueId, week);
        const scores = matchups
          .filter((m) => typeof m.points === "number")
          .map((m) => ({ rosterId: m.roster_id, points: m.points }));
        // A week where every roster is at zero has not been played. That is
        // what Sleeper returns for a future week that already has a schedule.
        if (scores.length === 0 || scores.every((s) => s.points === 0)) return null;
        return { week, scores };
      } catch {
        return null;
      }
    }),
  );
  return perWeek.filter((r): r is WeekResult => r !== null);
}

export { snapshotFrom, aliveFromRosters } from "./roster-diff";
export type { RosterSnapshot, WinningBid } from "./roster-diff";
