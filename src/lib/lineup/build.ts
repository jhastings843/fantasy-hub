import "server-only";
import { latestWeekly, readWeekly, type StoredWeekly } from "@/lib/jingles/ingest";
import { getMyLeagues } from "@/lib/league/discover";
import type { LeagueProfile } from "@/lib/league/types";
import { getAllPlayers, getLeague, getLeagueRosters, getUser } from "@/lib/sleeper/client";
import { getWeekProjections } from "@/lib/guillotine/projections";
import { normalizeTeam } from "@/lib/jingles/resolve";
import { scoringSkewNotes, type ScoringSettings } from "@/lib/guillotine/scoring";
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
      blocked: "SLEEPER_USERNAME is not set, so the app cannot tell which roster is yours.",
    };
  }

  const me = await getUser(username);

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
      out.push(await lineupForLeague(profile, weekly, players, me.user_id, playing));
    } catch (e) {
      out.push({
        leagueId: profile.id,
        leagueName: profile.name,
        leagueType: profile.type,
        rosterPositions: profile.rosterPositions,
        skewNotes: [],
        scoringLabel: scoringLabel(profile),
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
    return {
      playerId: id,
      name: name || id,
      position,
      team,
      positionalRank: pr,
      flexRank: fr,
      adjustedFlexRank: adjusted.get(id) ?? null,
      opponent: m?.opponent ?? null,
      home: m?.home ?? null,
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
    advice,
    error: null,
  };
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
