import "server-only";
import { buildWeeklyLineups } from "@/lib/lineup/build";
import { adviseLineup } from "@/lib/lineup/weekly-advice";
import { scoreStatLine, type ScoringSettings } from "@/lib/guillotine/scoring";
import { getLeague, getNflState } from "@/lib/sleeper/client";
import { perfectLineup, scoreLineup, verdict, type ActualPoints } from "./pure";
import { isSettled, readWeek, writeWeek, type Settled, type Snapshot } from "./store";

// The two moments.
//
// SNAPSHOT runs before the slate locks and freezes what the app recommended, so
// the record cannot be written with hindsight in it.
//
// SETTLE runs after a week finishes, fetches what everybody actually scored, and
// grades the four lineups against each other.
//
// Both ride the daily snapshot cron and decide for themselves whether today is
// the day, the same pattern the emails use, because Vercel Hobby allows two
// cron jobs and both are long spoken for.

const STATS = "https://api.sleeper.app/v1/stats/nfl/regular";

function dayInNewYork(now: Date): number {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
  }).format(now);
  return [
    "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
  ].indexOf(weekday);
}

/**
 * Freeze what the app recommended this week.
 *
 * Sunday morning, which is the last cron before the 1pm lock and therefore the
 * fairest test: it grades the advice as it stood at the moment Jack actually had
 * to decide, with his latest in-week edits included.
 *
 * The known impurity, written down rather than hidden: anybody who played on
 * Thursday night is already locked by Sunday morning, so for those players this
 * grades advice Jack could no longer have acted on.
 *
 * Never overwrites an existing record. A second run in the same week would move
 * the goalposts after some games had been played.
 */
export async function snapshotWeek(options: { force?: boolean } = {}): Promise<{
  ok: boolean;
  reason?: string;
  written: { leagueId: string; week: number }[];
}> {
  const today = dayInNewYork(new Date());
  if (!options.force && today !== 0) {
    return { ok: true, reason: `Snapshots run on Sunday and today is day ${today}.`, written: [] };
  }

  const built = await buildWeeklyLineups();
  if (built.blocked || built.week === null || !built.season) {
    return { ok: false, reason: built.blocked ?? "No week to snapshot.", written: [] };
  }

  const written: { leagueId: string; week: number }[] = [];
  for (const league of built.leagues) {
    if (league.error || league.roster.length === 0) continue;

    const existing = await readWeek(built.season, built.week, league.leagueId);
    if (existing && !options.force) continue;

    const advised = league.advice.slots.map((s) => s.recommended?.playerId ?? "");
    // His ranking with the adjustment taken away, solved by the SAME function,
    // so the two lineups cannot differ because of anything but the adjustment.
    const raw = adviseLineup({
      rosterPositions: league.rosterPositions,
      roster: league.roster.map((p) => ({ ...p, adjustedFlexRank: null })),
      currentStarters: [],
    }).slots.map((s) => s.recommended?.playerId ?? "");

    const snapshot: Snapshot = {
      season: built.season,
      week: built.week,
      leagueId: league.leagueId,
      leagueName: league.leagueName,
      takenAt: new Date().toISOString(),
      rosterPositions: league.rosterPositions,
      roster: league.roster.map((p) => p.playerId),
      started: league.currentStarters,
      advised,
      raw,
      listUpdatedLabel: built.listUpdatedLabel,
      names: Object.fromEntries(league.roster.map((p) => [p.playerId, p.name])),
      positions: Object.fromEntries(league.roster.map((p) => [p.playerId, p.position])),
    };
    await writeWeek(snapshot);
    written.push({ leagueId: league.leagueId, week: built.week });
  }

  return { ok: true, written };
}

/** Actual points for a week, scored under one league's own settings. */
async function actualPoints(
  season: string,
  week: number,
  scoring: ScoringSettings,
): Promise<ActualPoints | null> {
  try {
    const res = await fetch(`${STATS}/${season}/${week}`, { cache: "no-store" });
    if (!res.ok) return null;
    const rows = (await res.json()) as Record<string, Record<string, number>>;
    const out: ActualPoints = {};
    for (const [playerId, stats] of Object.entries(rows)) {
      out[playerId] = Number(scoreStatLine(stats, scoring).toFixed(2));
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * Grade any snapshot that has not been graded yet.
 *
 * Runs daily and finds its own work, so a missed day is not a missed week. A
 * week is only graded once, because a second grading after a stat correction
 * would quietly rewrite history that a season total is built on.
 */
export async function settleWeek(options: {
  season: string;
  week: number;
  leagueIds: string[];
  force?: boolean;
}): Promise<{ settled: string[]; skipped: { leagueId: string; why: string }[] }> {
  const settled: string[] = [];
  const skipped: { leagueId: string; why: string }[] = [];

  // A week is finished when the league has moved past it, and nothing else will
  // do. The first version asked whether any rostered player had scored, which
  // was true on the Wednesday night of week 1 after a single game: it graded
  // three leagues on a slate where almost everybody was still on zero, and a
  // week is only graded once, so that would have been permanent. Tested against
  // the live board, which is how it was found.
  const state = await getNflState().catch(() => null);
  const finished =
    options.force ||
    (state !== null &&
      state.season === options.season &&
      typeof state.week === "number" &&
      state.week > options.week);

  if (!finished) {
    for (const leagueId of options.leagueIds) {
      skipped.push({
        leagueId,
        why: `week ${options.week} is not finished yet (the league is on week ${state?.week ?? "unknown"})`,
      });
    }
    return { settled, skipped };
  }

  for (const leagueId of options.leagueIds) {
    const record = await readWeek(options.season, options.week, leagueId);
    if (!record) {
      skipped.push({ leagueId, why: "no snapshot was taken for that week" });
      continue;
    }
    if (isSettled(record) && !options.force) {
      skipped.push({ leagueId, why: "already settled" });
      continue;
    }

    const league = await getLeague(leagueId);
    const scoring = (league.scoring_settings ?? {}) as ScoringSettings;
    const actual = await actualPoints(options.season, options.week, scoring);
    if (!actual) {
      skipped.push({ leagueId, why: "no stats available for that week yet" });
      continue;
    }


    const perfect = perfectLineup(
      record.roster,
      record.rosterPositions,
      (id) => record.positions[id] ?? "",
      actual,
    );

    const out: Settled = {
      ...record,
      settledAt: new Date().toISOString(),
      perfect,
      points: Object.fromEntries(record.roster.map((id) => [id, actual[id] ?? 0])),
      verdict: verdict({
        advised: scoreLineup(record.advised, actual).points,
        started: scoreLineup(record.started, actual).points,
        raw: scoreLineup(record.raw, actual).points,
        perfect: scoreLineup(perfect, actual).points,
      }),
    };
    await writeWeek(out);
    settled.push(leagueId);
  }

  return { settled, skipped };
}

/**
 * Grade every finished week that has not been graded, across every league.
 *
 * Walks backwards from the current week rather than only trying the last one,
 * because a week whose stats arrived late would otherwise never be picked up
 * and would sit unsettled for the rest of the season.
 */
export async function settleFinishedWeeks(): Promise<{
  settled: string[];
  skipped: { leagueId: string; why: string }[];
}> {
  const { getMyLeagues } = await import("@/lib/league/discover");
  const { latestWeekly } = await import("@/lib/jingles/ingest");

  const [leagues, weekly] = await Promise.all([getMyLeagues(), latestWeekly()]);
  if (!weekly) return { settled: [], skipped: [] };

  const leagueIds = leagues.map((l) => l.id);
  const settled: string[] = [];
  const skipped: { leagueId: string; why: string }[] = [];

  // Every week before the current one. A finished week is one with stats; the
  // settle call decides that for itself and skips the rest.
  for (let week = Math.max(1, weekly.week - 6); week < weekly.week; week++) {
    const r = await settleWeek({ season: weekly.season, week, leagueIds });
    settled.push(...r.settled.map((id) => `w${week}:${id}`));
    skipped.push(...r.skipped);
  }

  return { settled, skipped };
}
