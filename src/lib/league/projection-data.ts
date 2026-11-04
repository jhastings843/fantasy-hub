import "server-only";
import { cached } from "@/lib/redis/cached";
import { redis } from "@/lib/redis/client";
import { getLeague, getLeagueMatchups, getLeagueRosters } from "@/lib/sleeper/client";
import type { SleeperLeague, SleeperRoster } from "@/lib/sleeper/types";
import { getWeekProjections } from "@/lib/guillotine/projections";
import { bestLineup, type LineupPlayer } from "@/lib/lineup/solve";
import { lineupSigma } from "@/lib/guillotine/chop-line";
import { profileFromSleeper } from "./detect";
import { simulateSeason, type FutureWeek, type SimResult, type TeamNow, type TeamWeek } from "./projection";

// Loads one league's rest of season and runs the projection. Cached per
// completed week for six hours, so it moves when a week is scored and again
// when rosters change (trades, waivers, injuries in the projections).

/** Spread of the K and DST slots, which Sleeper's skill-position feed leaves out. Estimate. */
const KDST_SD = 7;
/** Guillotine leagues play out to the last fantasy week. */
const GUILLOTINE_LAST_WEEK = 17;
const SIMS = 5000;

export interface LeagueProjection extends SimResult {
  format: "h2h" | "guillotine";
  completed: number;
  lastRegularWeek: number;
  playoffTeams: number;
  /** Points added to each projected lineup so totals match the league's real scoring (K, DST, and projection bias). */
  offset: number;
  /** Last week's playoff (or survival) odds by roster id, when a snapshot exists. */
  prior: Record<number, number> | null;
  computedAt: string;
}

const snapKey = (leagueId: string, week: number) => `league:v1:proj-snap:${leagueId}:w${week}`;

function pfOf(r: SleeperRoster): number {
  return (r.settings?.fpts ?? 0) + (r.settings?.fpts_decimal ?? 0) / 100;
}

async function build(league: SleeperLeague, completed: number, chopped: Map<number, number>): Promise<LeagueProjection> {
  const leagueId = league.league_id;
  const profile = profileFromSleeper(league);
  const format = profile.type === "guillotine" ? "guillotine" : "h2h";
  const settings = (league.settings ?? {}) as Record<string, number | undefined>;
  const playoffStart = Number(settings.playoff_week_start) || 15;
  const lastRegularWeek = format === "guillotine" ? GUILLOTINE_LAST_WEEK : playoffStart - 1;
  const playoffTeams = format === "guillotine" ? 1 : Number(settings.playoff_teams) || 6;
  const scoring = league.scoring_settings ?? {};
  const slots = league.roster_positions ?? [];

  const rosters = await getLeagueRosters(leagueId);
  const futureWeeks: number[] = [];
  for (let w = completed + 1; w <= lastRegularWeek; w++) futureWeeks.push(w);
  const recentWeeks = [completed, completed - 1, completed - 2, completed - 3].filter((w) => w >= 1);

  const [projByWeek, schedule, recent] = await Promise.all([
    Promise.all(futureWeeks.map((w) => getWeekProjections(leagueId, league.season, w, scoring).catch(() => ({})))),
    format === "h2h" ? Promise.all(futureWeeks.map((w) => getLeagueMatchups(leagueId, w).catch(() => []))) : Promise.resolve([]),
    Promise.all(recentWeeks.map((w) => getLeagueMatchups(leagueId, w).catch(() => []))),
  ]);

  // Each future week: every live roster's best projected lineup.
  const raw = futureWeeks.map((week, k) => {
    const proj = projByWeek[k] as Record<string, { position: string; points: number }>;
    const dist: Record<number, TeamWeek> = {};
    for (const r of rosters) {
      if (format === "guillotine" && (chopped.has(r.roster_id) || !(r.players ?? []).length)) continue;
      const players: LineupPlayer[] = (r.players ?? [])
        .map((id) => (proj[id] ? { playerId: id, position: proj[id].position, points: proj[id].points } : null))
        .filter((p): p is LineupPlayer => p !== null);
      const starters = bestLineup(players, slots).slots.map((s) => s.player).filter((p): p is LineupPlayer => p !== null);
      const mean = starters.reduce((s, p) => s + p.points, 0);
      dist[r.roster_id] = { mean, sd: Math.hypot(lineupSigma(starters), KDST_SD) };
    }
    return { week, dist };
  });

  // Calibrate to the league's real scale: recent actual scores vs next week's projected lineups.
  const actual = recent.flat().map((m) => m.points ?? 0).filter((p) => p > 0);
  const firstMeans = raw[0] ? Object.values(raw[0].dist).map((d) => d.mean).filter((m) => m > 0) : [];
  const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
  const offset = actual.length && firstMeans.length ? Math.max(0, avg(actual) - avg(firstMeans)) : 0;

  const weeks: FutureWeek[] = raw.map((w, k) => {
    const pairsById = new Map<number, number[]>();
    for (const m of (schedule[k] ?? []) as { matchup_id: number | null; roster_id: number }[]) {
      if (m.matchup_id == null) continue;
      pairsById.set(m.matchup_id, [...(pairsById.get(m.matchup_id) ?? []), m.roster_id]);
    }
    const pairs = [...pairsById.values()].filter((p) => p.length === 2) as [number, number][];
    const dist = Object.fromEntries(Object.entries(w.dist).map(([id, d]) => [id, { mean: d.mean + offset, sd: d.sd }]));
    return { week: w.week, pairs, dist };
  });

  const teams: TeamNow[] = rosters.map((r) => ({
    rosterId: r.roster_id,
    wins: r.settings?.wins ?? 0,
    losses: r.settings?.losses ?? 0,
    ties: r.settings?.ties ?? 0,
    pf: format === "guillotine" ? 0 : pfOf(r),
    alive: format === "h2h" || !chopped.has(r.roster_id),
    choppedWeek: chopped.get(r.roster_id) ?? null,
  }));

  const sim = simulateSeason({ format, teams, weeks, median: settings.league_average_match === 1, playoffTeams, sims: SIMS, seed: completed * 7919 + 1 });

  // The first read of each completed week is that week's snapshot, for "since last week".
  const odds = (t: SimResult["teams"][number]) => (format === "guillotine" ? (t.champPct ?? 0) : t.playoffPct);
  const now = Object.fromEntries(sim.teams.map((t) => [t.rosterId, odds(t)]));
  let prior: Record<number, number> | null = null;
  try {
    await redis.set(snapKey(leagueId, completed), now, { nx: true, ex: 180 * 86_400 });
    prior = completed >= 1 ? await redis.get<Record<number, number>>(snapKey(leagueId, completed - 1)) : null;
  } catch {
    prior = null;
  }

  return { ...sim, format, completed, lastRegularWeek, playoffTeams, offset, prior, computedAt: new Date().toISOString() };
}

/**
 * Projected end-of-season standings for one league. `chopped` maps a guillotine
 * roster id to the week it was chopped (from the page's standings table).
 */
export async function getLeagueProjection(leagueId: string, chopped: Map<number, number> = new Map()): Promise<LeagueProjection | null> {
  const league = await getLeague(leagueId);
  const completed = Number(league.settings?.last_scored_leg ?? 0) || 0;
  if (completed < 1) return null; // nothing played yet; the draft is the projection
  return cached(`league:v1:proj:${leagueId}:w${completed}`, 6 * 3600, () => build(league, completed, chopped));
}
