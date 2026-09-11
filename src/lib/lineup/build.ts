import "server-only";
import { latestWeekly, readWeekly, type StoredWeekly } from "@/lib/jingles/ingest";
import { getMyLeagues } from "@/lib/league/discover";
import type { LeagueProfile } from "@/lib/league/types";
import { getAllPlayers, getLeague, getLeagueRosters, getUser } from "@/lib/sleeper/client";
import { getWeekProjections } from "@/lib/guillotine/projections";
import { normalizeTeam } from "@/lib/jingles/resolve";
import { scoringSkewNotes, type ScoringSettings } from "@/lib/guillotine/scoring";
import { getWeekStats, scoreRows, type StatRows } from "@/lib/sleeper/stats";
import { getSeasonGames } from "@/lib/survivor/odds";
import { fixtureMap, lockedTeams, teamsWithStats, type Fixture } from "@/lib/nfl/week";
import { adjustedFlexRanks, adviseLineup, isOnBye, type AdvicePlayer, type LineupAdvice } from "./weekly-advice";

// Everything the lineup advice needs, fetched and joined.
//
// Split from weekly-advice.ts on purpose: the decisions there are pure and
// tested, and everything that can fail because a third party is slow or absent
// lives here.

export interface LeagueLineup {
  leagueId: string;
  leagueName: string;
  leagueType: string;
  rosterPositions: string[];
  /** How this league's scoring differs from the list, in his own terms. */
  skewNotes: string[];
  scoringLabel: string;
  /** The whole roster, so a caller can re-solve without fetching again. */
  roster: AdvicePlayer[];
  /** Sleeper's own starters array at the moment this was built. */
  currentStarters: string[];
  /** Teams whose game has already kicked off, so their slots cannot move. */
  lockedTeams: string[];
  advice: LineupAdvice;
  /** Said out loud when a league could not be advised, rather than shown empty. */
  error: string | null;
}

export interface WeeklyLineups {
  week: number | null;
  season: string | null;
  listTitle: string | null;
  listUrl: string | null;
  listScoring: string | null;
  listUpdatedLabel: string | null;
  leagues: LeagueLineup[];
  /** True once any game in the week has been played. */
  anyLocked: boolean;
  /** Set when there is no weekly list at all, which is a whole different email. */
  blocked: string | null;
}

/** "full PPR, 6pt pass TD, TE premium" for the header line. */
function scoringLabel(profile: LeagueProfile): string {
  const parts = [
    profile.ppr >= 1 ? "full PPR" : profile.ppr === 0 ? "standard" : "half PPR",
    `${profile.passTd}pt pass TD`,
  ];
  if (profile.tePremium > 0) parts.push(`TE premium ${profile.tePremium}`);
  return parts.join(", ");
}

/**
 * The scoring the list itself is built on, expressed in this league's own
 * settings.
 *
 * Everything except receptions and the tight end premium is held at the
 * league's own value, which is what isolates the difference that actually
 * matters. A four-point passing touchdown does not reorder a FLEX list of
 * running backs and receivers, so holding it constant keeps the delta honest
 * rather than adding noise.
 */
function listScoringFor(league: ScoringSettings, listPpr: number): ScoringSettings {
  return { ...league, rec: listPpr, bonus_rec_te: 0 };
}

const PPR_FOR: Record<string, number> = { half_ppr: 0.5, full_ppr: 1, standard: 0 };

export async function buildWeeklyLineups(
  options: { week?: number; leagueId?: string } = {},
): Promise<WeeklyLineups> {
  const weekly =
    options.week !== undefined
      ? await readWeeklyForCurrentSeason(options.week)
      : await latestWeekly();

  if (!weekly) {
    return {
      week: options.week ?? null,
      season: null,
      listTitle: null,
      listUrl: null,
      listScoring: null,
      listUpdatedLabel: null,
      leagues: [],
      anyLocked: false,
      blocked:
        "No weekly rankings have been ingested yet. Nothing here is a lineup until his list is in.",
    };
  }

  const [leagues, players, username] = await Promise.all([
    getMyLeagues(),
    getAllPlayers(),
    Promise.resolve(process.env.SLEEPER_USERNAME),
  ]);

  if (!username) {
    return {
      week: weekly.week,
      season: weekly.season,
      listTitle: weekly.title,
      listUrl: weekly.url,
      listScoring: weekly.scoring,
      listUpdatedLabel: weekly.updatedLabel,
      leagues: [],
      anyLocked: false,
      blocked: "SLEEPER_USERNAME is not set, so the app cannot tell which roster is yours.",
    };
  }

  const me = await getUser(username);

  // What is already out of his hands.
  //
  // Two independent signals, unioned, because either one alone has a failure
  // mode that puts the old bug straight back. ESPN's schedule is the precise
  // one, and it locks on the clock rather than on a stat appearing, so a slot
  // goes cold at kickoff the way Sleeper's does. Sleeper's own stat feed is the
  // backstop, for the case where the schedule cannot be read at all.
  //
  // The backstop needs corroboration, and finding out why cost a day in
  // production: one stray Las Vegas row in the week 1 feed locked every Raider
  // two days before their game. teamsWithStats carries the threshold and the
  // measurement behind it. Neither signal is allowed to take the page down.
  const [schedule, stats] = await Promise.all([
    getSeasonGames(Number(weekly.season))
      .then((s) => s.games.filter((g) => g.week === weekly.week))
      .catch(() => []),
    getWeekStats(weekly.season, weekly.week).catch(() => ({}) as StatRows),
  ]);

  const locked = lockedTeams(schedule, new Date());
  const fixtures = fixtureMap(schedule);
  for (const team of teamsWithStats(
    Object.keys(stats).map(
      (id) => (players[id] as { team?: string | null } | undefined)?.team ?? null,
    ),
  )) {
    locked.add(team);
  }

  // Teams with a game this week, taken from his own list: every row he wrote
  // carries a matchup, so a team that appears nowhere in 407 rows has no game.
  //
  // Through normalizeTeam on both sides, which is the fix for the bug this
  // shipped with. He writes JAC and Sleeper says JAX, so a raw string compare
  // reported every Jacksonville player as on bye, and in week 1 there are no
  // byes at all. It cost two lineup changes in the first email that went out.
  const playing = new Set<string>();
  for (const e of [...Object.values(weekly.positional).flat(), ...weekly.flex]) {
    const t = normalizeTeam(e.team);
    const o = normalizeTeam(e.opponent);
    if (t) playing.add(t);
    if (o) playing.add(o);
  }

  // The tab asks for one league; the Thursday email asks for all of them.
  // Filtered here rather than by the caller so a page never pays for three
  // leagues of Sleeper calls it is not going to render.
  const wanted = options.leagueId
    ? leagues.filter((l) => l.id === options.leagueId)
    : leagues;

  const out: LeagueLineup[] = [];
  for (const profile of wanted) {
    try {
      out.push(
        await lineupForLeague(
          profile,
          weekly,
          players,
          me.user_id,
          playing,
          locked,
          fixtures,
          stats,
        ),
      );
    } catch (e) {
      out.push({
        leagueId: profile.id,
        leagueName: profile.name,
        leagueType: profile.type,
        rosterPositions: profile.rosterPositions,
        skewNotes: [],
        scoringLabel: scoringLabel(profile),
        roster: [],
        currentStarters: [],
        lockedTeams: [],
        advice: { slots: [], changes: [], problems: [], superflexFellThrough: false, adjustmentDecided: [] },
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return {
    week: weekly.week,
    season: weekly.season,
    listTitle: weekly.title,
    listUrl: weekly.url,
    listScoring: weekly.scoring,
    listUpdatedLabel: weekly.updatedLabel,
    leagues: out,
    anyLocked: locked.size > 0,
    blocked: null,
  };
}

async function readWeeklyForCurrentSeason(week: number): Promise<StoredWeekly | null> {
  const latest = await latestWeekly();
  if (!latest) return null;
  return readWeekly(latest.season, week);
}

async function lineupForLeague(
  profile: LeagueProfile,
  weekly: StoredWeekly,
  players: Awaited<ReturnType<typeof getAllPlayers>>,
  myUserId: string,
  playing: Set<string>,
  locked: Set<string>,
  fixtures: Map<string, Fixture>,
  stats: StatRows,
): Promise<LeagueLineup> {
  const [league, rosters] = await Promise.all([
    getLeague(profile.id),
    getLeagueRosters(profile.id),
  ]);

  const mine = rosters.find((r) => r.owner_id === myUserId);
  if (!mine) throw new Error("No roster on this league belongs to you.");

  const leagueScoring = (league.scoring_settings ?? {}) as ScoringSettings;
  const listScoring = listScoringFor(leagueScoring, PPR_FOR[weekly.scoring] ?? 0.5);

  // Two calls, two cache entries. getWeekProjections uses its first argument
  // only as a cache namespace, so a suffix is what keeps the league-scored and
  // list-scored copies from overwriting one another. Without it the second call
  // silently returns the first one's numbers and every delta is zero.
  const [leaguePoints, listPoints] = await Promise.all([
    getWeekProjections(profile.id, weekly.season, weekly.week, leagueScoring),
    getWeekProjections(`${profile.id}:listscoring`, weekly.season, weekly.week, listScoring),
  ]);

  const positionalRank = new Map<string, number>();
  const meta = new Map<string, { opponent: string; home: boolean }>();
  for (const list of Object.values(weekly.positional)) {
    for (const e of list) {
      if (!e.sleeperId) continue;
      positionalRank.set(e.sleeperId, e.rank);
      meta.set(e.sleeperId, { opponent: e.opponent, home: e.home });
    }
  }
  const flexRank = new Map<string, number>();
  for (const e of weekly.flex) {
    if (!e.sleeperId) continue;
    flexRank.set(e.sleeperId, e.rank);
    if (!meta.has(e.sleeperId)) meta.set(e.sleeperId, { opponent: e.opponent, home: e.home });
  }

  const adjusted =
    weekly.scoring === scoringNameFor(profile)
      ? new Map<string, number>()
      : adjustedFlexRanks(
          weekly.flex.map((e) => ({ playerId: e.sleeperId, rank: e.rank })),
          toPointsMap(listPoints),
          toPointsMap(leaguePoints),
        );

  const actual = scoreRows(stats, leagueScoring);

  const roster: AdvicePlayer[] = (mine.players ?? []).map((id) => {
    const p = players[id] as
      | { full_name?: string; first_name?: string; last_name?: string; position?: string | null; team?: string | null; injury_status?: string | null }
      | undefined;
    const name =
      p?.full_name ?? [p?.first_name, p?.last_name].filter(Boolean).join(" ").trim() ?? id;
    const team = p?.team ?? null;
    const position = (p?.position ?? "").toUpperCase();
    const pr = positionalRank.get(id) ?? null;
    const fr = flexRank.get(id) ?? null;
    const m = meta.get(id) ?? null;
    // The fixture beats his post on who and where. He had the 49ers at home
    // against the Rams in four of his five week 1 sections and away in the
    // fifth, and the schedule has no opinion to be wrong about. His own row is
    // still the fallback, so a player the schedule does not carry keeps the
    // matchup he wrote.
    const fixture = fixtures.get(normalizeTeam(team) ?? "") ?? null;
    return {
      playerId: id,
      name: name || id,
      position,
      team,
      positionalRank: pr,
      flexRank: fr,
      adjustedFlexRank: adjusted.get(id) ?? null,
      opponent: fixture?.opponent ?? m?.opponent ?? null,
      home: fixture?.home ?? m?.home ?? null,
      injuryStatus: p?.injury_status ?? leaguePoints[id]?.injuryStatus ?? null,
      // Jack's rule, and it is a better one than deriving this from team codes:
      // if he ranked the player, the player has a game. Every row in his list
      // carries a matchup, so he cannot rank someone who is not playing. That
      // makes the whole class of abbreviation mismatch unable to produce a
      // false bye, which is exactly how the first version got week 1 wrong.
      //
      // The team check is kept for players he did NOT rank, where it is the
      // only signal available, and it is the weaker half on purpose: an
      // unranked player is already flagged as unranked, so a wrong bye on top
      // of that changes nothing about what Jack does.
      onBye: isOnBye({
        ranked: pr !== null || fr !== null,
        team: normalizeTeam(team),
        teamsPlaying: playing,
      }),
      unranked: pr === null && fr === null,
      // Locked on the team, not on the player having a stat line. A receiver
      // who was inactive on Thursday has no row in the stat feed and is just as
      // stuck in his slot as the one who caught eight passes.
      locked: isLocked(normalizeTeam(team), locked),
      actualPoints: actual[id] ?? null,
    };
  });

  const advice = adviseLineup({
    rosterPositions: profile.rosterPositions,
    roster,
    currentStarters: mine.starters ?? [],
  });

  return {
    leagueId: profile.id,
    leagueName: profile.name,
    leagueType: profile.type,
    rosterPositions: profile.rosterPositions,
    skewNotes: scoringSkewNotes(leagueScoring, weekly.scoring),
    scoringLabel: scoringLabel(profile),
    roster,
    currentStarters: mine.starters ?? [],
    lockedTeams: [...locked].sort(),
    advice,
    error: null,
  };
}

/** A player with no team cannot be locked, because nothing tells us he played. */
function isLocked(team: string | null, locked: Set<string>): boolean {
  return team !== null && locked.has(team);
}

function scoringNameFor(profile: LeagueProfile): string {
  if (profile.ppr >= 1) return "full_ppr";
  if (profile.ppr === 0) return "standard";
  return "half_ppr";
}

function toPointsMap(
  projections: Record<string, { points: number }>,
): Map<string, number> {
  return new Map(Object.entries(projections).map(([id, p]) => [id, p.points]));
}
