import "server-only";
import { labForScoring, scoringForLeague, type LabIndex } from "@/lib/jingles/active";
import { latestWeekly, latestWeeklyFor, positionRankOf, readWaivers, type StoredWeekly } from "@/lib/jingles/ingest";
import { normalizeTeam } from "@/lib/jingles/resolve";
import { resolveLeague } from "@/lib/league/discover";
import type { LeagueProfile } from "@/lib/league/types";
import { isOnBye } from "@/lib/lineup/weekly-advice";
import { startablePositions } from "@/lib/redraft/draft-board";
import { inferTrajectory } from "@/lib/dynasty/season-plan";
import { bestLineup } from "@/lib/lineup/solve";
import { cannotPlay, scoreOf } from "@/lib/lineup/weekly-advice";
import { getRosterGrades } from "@/lib/rosteraudit/client";
import type { RAGradesByRosterId } from "@/lib/rosteraudit/types";
import {
  getAllPlayers,
  getLeague,
  getLeagueRosters,
  getNflState,
  getTrendingAdds,
  getUser,
} from "@/lib/sleeper/client";
import { seasonWinningBids } from "@/lib/sleeper/transactions";
import { getWeekStats, scoreRows, type StatRows } from "@/lib/sleeper/stats";
import { getWeekProjections, type ProjectionsByPlayer } from "@/lib/guillotine/projections";
import type { ScoringSettings } from "@/lib/guillotine/scoring";
import { getSeasonGames } from "@/lib/survivor/odds";
import { fixtureMap } from "@/lib/nfl/week";
import { claimGain, type ClaimGain } from "./gain";
import { isFreshForRun, mergeWire, rankWire, staleNote, usageFrom, type WireCandidate } from "./freshness";
import { resolveNames, toCandidates } from "@/lib/jingles/resolve";
import { readWaiverResearch } from "./research";
import type { ClaimTier } from "./price";
import {
  classifyClaim,
  pacingFor,
  priceClaim,
  type ClaimCandidate,
  type ObservedClaim,
  type Pacing,
  type PricingContext,
} from "./price";
import { isStartableIn } from "./pool";
import { waiverTargets, type WaiverPlayer, type WaiverReport } from "./rank";

// Everything the waiver advice needs, fetched and joined.
//
// The two lists it reads are deliberately different. His WEEKLY list answers
// "would this player start for me on Sunday", and his SEASON list answers "is
// this player worth a roster spot at all". A waiver page that used only one of
// them would be wrong half the time: on 2026-09-09 Sunday Scaries had nothing
// startable on the wire and a clear season-long upgrade in the same breath.

export interface WaiverContext {
  leagueId: string;
  leagueName: string;
  week: number | null;
  /** FAAB left, when the league uses a budget. */
  budgetLeft: number | null;
  budgetTotal: number | null;
  /** Unowned players on the season list eligible for this league's starting slots. */
  freeAgentCount: number;
  listTitle: string | null;
  listUpdatedLabel: string | null;
  seasonListTitle: string;
  /** False when the season list is for different scoring than this league. */
  seasonListMatchesScoring: boolean;
  report: WaiverReport;
  /** Budget pacing for the season. Null when the league has no FAAB. */
  pacing: Pacing | null;
  /** Where the season-long ranking came from, and whether it is this week's. */
  source: { label: string; fresh: boolean; note: string | null };
  blocked: string | null;
}

const EMPTY: WaiverReport = {
  startable: [],
  seasonUpgrades: [],
  dropCandidates: [],
  untouchable: [],
};

export async function buildWaivers(leagueId: string): Promise<WaiverContext> {
  const profile = await resolveLeague(leagueId);
  if (!profile) {
    return blank(leagueId, "That league could not be read.");
  }

  const username = process.env.SLEEPER_USERNAME;
  if (!username) {
    return blank(leagueId, "SLEEPER_USERNAME is not set, so the app cannot tell which roster is yours.", profile);
  }

  const [latest, lab, players, rosters, league, me, nflState] = await Promise.all([
    // This league's own scoring, falling back to the half-PPR list he used to
    // be the only publisher of. A slightly skewed list still ranks a waiver
    // claim usefully; no list at all empties the whole this-week half of the
    // page, so the fallback is deliberate and is the weaker of two evils.
    weeklyForLeague(scoringForLeague(profile)),
    labForScoring(scoringForLeague(profile)),
    getAllPlayers(),
    getLeagueRosters(profile.id),
    getLeague(profile.id),
    getUser(username),
    getNflState().catch(() => null),
  ]);

  const mine = rosters.find((r) => r.owner_id === me.user_id);
  if (!mine) {
    return blank(leagueId, "No roster on this league belongs to you.", profile);
  }

  // The NFL's week, not his. His weekly list is only this week's list when
  // its week number says so; a week-1 list read in week 2 ranks last week's
  // matchups, and "would start for you" off that is a guess dressed as advice.
  const nflWeek = nflState?.week ?? latest?.week ?? 1;
  const season = nflState?.season ?? profile.season;
  const weekly = latest && latest.week === nflWeek ? latest : null;

  // What everyone did last week, scored under this league's own settings.
  const lastWeekNum = nflWeek - 1;
  const leagueScoring = (league.scoring_settings ?? {}) as ScoringSettings;
  // This week's projections under league scoring, the same feed and cache
  // entry the lineup page reads. Two things come from it that nothing else
  // in the app can supply: a player's injury status (the player catalog is
  // slimmed and has none) and a projected point figure to size a claim by.
  // The schedule is the second signal on who has a game, for the weeks his
  // list is stale and there is no list to read matchups from.
  const [stats, projections, games] = await Promise.all([
    lastWeekNum >= 1 ? getWeekStats(season, lastWeekNum).catch((): StatRows => ({})) : Promise.resolve<StatRows>({}),
    getWeekProjections(profile.id, season, nflWeek, leagueScoring).catch((): ProjectionsByPlayer => ({})),
    getSeasonGames(Number(season))
      .then((s) => s.games.filter((g) => g.week === nflWeek))
      .catch(() => []),
  ]);
  const scored = scoreRows(stats, leagueScoring);

  const owned = new Set<string>();
  const startable = startablePositions(profile.rosterPositions);
  for (const r of rosters) for (const id of r.players ?? []) owned.add(id);

  // Teams with a game this week, so a free agent on bye is not offered as a
  // start. Read from his own list, and through normalizeTeam on both sides:
  // he writes JAC where Sleeper says JAX, and comparing them raw is what put
  // two Jacksonville players on a phantom bye on 2026-09-09.
  const playing = new Set<string>(fixtureMap(games).keys());
  if (weekly) {
    for (const e of [...Object.values(weekly.positional).flat(), ...weekly.flex]) {
      const t = normalizeTeam(e.team);
      const o = normalizeTeam(e.opponent);
      if (t) playing.add(t);
      if (o) playing.add(o);
    }
  }

  const index = weeklyIndex(weekly);
  const toPlayer = (id: string): WaiverPlayer => {
    const raw = players[id] as
      | {
          full_name?: string;
          first_name?: string;
          last_name?: string;
          position?: string | null;
          team?: string | null;
          injury_status?: string | null;
        }
      | undefined;
    const name =
      raw?.full_name ?? [raw?.first_name, raw?.last_name].filter(Boolean).join(" ").trim() ?? id;
    const onList = lab.byId[id];
    const pr = index.positional.get(id) ?? null;
    const fr = index.flex.get(id) ?? null;
    const m = index.meta.get(id) ?? null;
    return {
      playerId: id,
      name: name || id,
      position: (raw?.position ?? "").toUpperCase(),
      team: raw?.team ?? null,
      positionalRank: pr,
      flexRank: fr,
      adjustedFlexRank: null,
      opponent: m?.opponent ?? null,
      home: m?.home ?? null,
      injuryStatus: raw?.injury_status ?? projections[id]?.injuryStatus ?? null,
      onBye: isOnBye({
        ranked: pr !== null || fr !== null,
        team: normalizeTeam(raw?.team ?? null),
        teamsPlaying: playing,
      }),
      unranked: pr === null && fr === null,
      lastWeek: usageFrom(stats[id], scored[id], lastWeekNum),
      seasonRank: onList?.rank ?? null,
      seasonPositionRank: onList ? `${onList.position}${onList.positionRank}` : null,
      tier: onList ? lab.tierFor(id) : null,
    };
  };

  // Only players his season list names. Scanning every unowned player in the
  // NFL turns a waiver page into a phone book, and anybody he has not ranked in
  // three hundred is not a claim worth surfacing unaided.
  // His season list counts only if he has touched it since this week began.
  // Otherwise the wire itself is the ranking: who all of Sleeper is adding,
  // minus anyone who did not actually play last week.
  const labFresh = isFreshForRun(lab.postedAt);
  let freeAgents: WaiverPlayer[];
  let source: WaiverContext["source"];
  if (labFresh) {
    freeAgents = lab.list
      .filter((e) => !owned.has(e.sleeperId))
      .map((e) => toPlayer(e.sleeperId))
      // Sleeper uses DEF, which matches roster slots; the Lab list uses DST.
      .filter((p) => isStartableIn(p.position, startable));
    source = { label: lab.title, fresh: true, note: null };
  } else {
    const format = profile.type === "dynasty" ? "dynasty" : "redraft";
    const [trending, ownResearch, redraftResearch] = await Promise.all([
      getTrendingAdds(100).catch(() => []),
      readWaiverResearch(season, nflWeek, format),
      format === "dynasty" ? readWaiverResearch(season, nflWeek, "redraft") : Promise.resolve(null),
    ]);
    // The redraft consensus is a fair second-best for dynasty when the
    // dynasty pass has not run: the role changes are the same players.
    const research = ownResearch ?? redraftResearch;
    const borrowed = !ownResearch && !!redraftResearch;

    // The week's web consensus, matched to Sleeper ids by name, position and
    // team. Anyone owned in this league or at a position it cannot start is
    // dropped; an unmatched name is logged and skipped rather than guessed.
    const resolvedResearch = research
      ? resolveNames(
          research.targets.map((t) => ({ name: t.name, position: t.position, team: t.team, target: t })),
          toCandidates(players),
        ).resolved
      : [];
    const researchPlayers: WaiverPlayer[] = resolvedResearch
      .filter((r) => !owned.has(r.playerId))
      .map((r) => ({
        ...toPlayer(r.playerId),
        research: {
          tier: r.input.target.tier,
          faabPercent: r.input.target.faabPercent,
          note: r.input.target.note,
        },
      }))
      .filter((p) => isStartableIn(p.position, startable));

    const candidates: WireCandidate[] = trending
      .filter((t) => !owned.has(t.player_id))
      .map((t) => ({ player: toPlayer(t.player_id), adds: t.count }))
      .filter(({ player }) => isStartableIn(player.position, startable))
      .map(({ player, adds }) => ({
        playerId: player.playerId,
        adds,
        lastWeek: player.lastWeek ?? null,
        onBye: player.onBye,
      }));
    const trendingPlayers = rankWire(candidates).map((c) => ({
      ...toPlayer(c.playerId),
      tier: `${c.adds.toLocaleString()} adds`,
    }));
    freeAgents = mergeWire(researchPlayers, trendingPlayers);

    const researched = research
      ? ` This week's ${borrowed ? "redraft " : ""}waiver columns were researched ${new Date(research.generatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" })} and lead the list; Sleeper's most-added players fill in behind them.`
      : " No web research has run for this week yet, so the list is Sleeper's most-added players, filtered by who actually played.";
    source = {
      label: research ? "Web consensus and Sleeper trending adds" : "Sleeper trending adds",
      fresh: false,
      note: staleNote(lab.title, lab.postedAt) + researched,
    };
  }

  // His waiver post, folded onto whichever board was built above.
  //
  // Done here rather than inside either branch because it applies to both: his
  // bids are as useful against a fresh season list as they are against a wire
  // of trending adds. It is also the only source in this function that prints a
  // dollar figure, which is the thing the page had been missing.
  const jingles = await readWaivers(season, nflWeek);
  if (jingles) {
    const priced = (row: (typeof jingles.rows)[number]) => ({
      rank: row.rank,
      faab: row.faab,
      faabPercent: row.faabPercent,
      budget: jingles.budget,
      note: row.note,
    });
    const rowById = new Map(
      jingles.rows.filter((r) => r.sleeperId).map((r) => [r.sleeperId!, r]),
    );
    freeAgents = freeAgents.map((p) => {
      const row = rowById.get(p.playerId);
      return row ? { ...p, jingles: priced(row) } : p;
    });

    // Anyone he named who is not on the board yet. He publishes thirty players
    // he would actually claim, and a board that shows his bid on the four it
    // already had is a worse version of his post.
    const have = new Set(freeAgents.map((p) => p.playerId));
    const his = jingles.rows
      .filter((r) => r.sleeperId && !have.has(r.sleeperId) && !owned.has(r.sleeperId))
      .map((r) => ({ ...toPlayer(r.sleeperId!), jingles: priced(r) }))
      .filter((p) => isStartableIn(p.position, startable));
    freeAgents = mergeWire(freeAgents, his);

    const budgetNote = ` His week ${jingles.week} waiver post prices ${jingles.rows.length} players against a $${jingles.budget} budget, shown here as a percent of yours.`;
    source = { ...source, note: (source.note ?? "") + budgetNote };
  }

  const roster = (mine.players ?? []).map(toPlayer);

  const budgetTotal = profile.faab;
  const used = mine.settings?.waiver_budget_used ?? null;
  const budgetLeft =
    budgetTotal !== null && typeof used === "number" ? budgetTotal - used : budgetTotal;

  // Everyone free on his weekly list who is not already on the board. The
  // board above is built from research, Sleeper's most-added and his waiver
  // post, and a player in none of them never got compared to the lineup, even
  // when his own list for this week ranked him ahead of the starter: week 3,
  // half PPR, Dalton Schultz was TE10 and free, the board recommended
  // Freiermuth (TE11) over Loveland (TE13), and Schultz was never considered.
  const onBoard = new Set(freeAgents.map((p) => p.playerId));
  const weeklyOnly = [...new Set([...index.positional.keys(), ...index.flex.keys()])]
    .filter((id) => !owned.has(id) && !onBoard.has(id))
    .map(toPlayer)
    .filter((p) => isStartableIn(p.position, startable));

  const report = waiverTargets({
    rosterPositions: profile.rosterPositions,
    roster,
    freeAgents,
    weeklyOnly,
    seasonOrder: labFresh ? "rank" : "given",
  });

  // --- Pricing ---
  //
  // Only when the league runs a budget. The inputs are the league's own
  // winning bids, Sleeper's trending adds (how contested a claim is), my
  // record, and in dynasty the roster's trajectory from RosterAudit, so a
  // rebuilder and a contender are told different numbers for the same man.
  let pacing: Pacing | null = null;
  if (budgetTotal !== null && budgetLeft !== null && profile.type !== "guillotine") {
    const week = nflWeek;
    const isDynasty = profile.type === "dynasty";

    const [bids, trendingRows, grades] = await Promise.all([
      seasonWinningBids(profile.id, week).catch(() => []),
      getTrendingAdds().catch(() => []),
      isDynasty
        ? getRosterGrades(profile.id, me.user_id).catch((): RAGradesByRosterId => ({}))
        : Promise.resolve<RAGradesByRosterId>({}),
    ]);

    const trajectory = isDynasty ? inferTrajectory(grades[mine.roster_id] ?? null) : null;
    const trending = new Map(trendingRows.map((t, i) => [t.player_id, i + 1]));

    const available = roster.filter((p) => !cannotPlay(p));
    const lineup = bestLineup(
      available.map((p) => ({ playerId: p.playerId, position: p.position, points: scoreOf(p) })),
      profile.rosterPositions,
    );
    const emptySlots = lineup.slots.filter((slot) => slot.player === null).length;

    const base: Omit<PricingContext, "observed"> = {
      type: isDynasty ? "dynasty" : "redraft",
      budget: budgetTotal,
      remaining: budgetLeft,
      week,
      teams: profile.teams,
      rosterPositions: profile.rosterPositions,
      record: {
        wins: mine.settings?.wins ?? 0,
        losses: mine.settings?.losses ?? 0,
      },
      trajectory,
      trending,
      emptySlots,
    };

    const jinglesById = new Map(
      freeAgents.filter((p) => p.jingles).map((p) => [p.playerId, p.jingles!]),
    );
    const researchById = new Map(
      freeAgents.filter((p) => p.research).map((p) => [p.playerId, p.research!]),
    );
    const candidateFor = (id: string, position: string, gain: ClaimGain): ClaimCandidate => ({
      playerId: id,
      position,
      age: players[id]?.age ?? null,
      seasonPositionRank: lab.byId[id]?.positionRank ?? null,
      ...gain,
      lastWeekSnaps: usageFrom(stats[id], scored[id], lastWeekNum)?.snaps ?? null,
      researchTier: (researchById.get(id)?.tier as ClaimTier | undefined) ?? null,
      researchPercent: researchById.get(id)?.faabPercent ?? null,
      jinglesPercent: jinglesById.get(id)?.faabPercent ?? null,
    });

    // Historical bids are tiered by the player's season rank alone; what he
    // was worth to the buyer's lineup that week is not recoverable.
    const observed: ObservedClaim[] = bids.map((bid) => {
      const position = players[bid.playerId]?.position ?? "WR";
      const tier = classifyClaim(candidateFor(bid.playerId, position, claimGain(null, {})), { ...base, observed: [] });
      return { tier, amount: bid.amount };
    });
    const ctx: PricingContext = { ...base, observed };

    // The gain is projected points from the feed, or unknown; never a rank
    // gap. The solver's ranking still decides WHETHER he starts.
    for (const t of report.startable) {
      t.price = priceClaim(candidateFor(t.player.playerId, t.player.position, claimGain(t, projections)), ctx);
    }
    for (const t of report.seasonUpgrades) {
      const starts = report.startable.find((s) => s.player.playerId === t.player.playerId) ?? null;
      t.price = priceClaim(candidateFor(t.player.playerId, t.player.position, claimGain(starts, projections)), ctx);
    }
    pacing = pacingFor(ctx);
  }

  return {
    leagueId: profile.id,
    leagueName: profile.name,
    week: nflWeek,
    budgetLeft,
    budgetTotal,
    freeAgentCount: freeAgents.length,
    listTitle: weekly?.title ?? null,
    listUpdatedLabel: weekly?.updatedLabel ?? null,
    seasonListTitle: labFresh ? lab.title : "Sleeper trending adds",
    seasonListMatchesScoring: lab.matchesLeagueScoring,
    report,
    pacing,
    source,
    blocked: weekly
      ? null
      : latest
        ? `His latest weekly list is for week ${latest.week} and this is week ${nflWeek}, so the this-week half of this page waits for his new post. The claims below still stand.`
        : "No weekly rankings ingested yet, so the this-week half of this page is empty. The season-long claims below still stand.",
  };
}

/** His list in a league's own scoring, or the half-PPR one if that is all there is. */
async function weeklyForLeague(scoring: ReturnType<typeof scoringForLeague>) {
  return (await latestWeeklyFor(scoring)) ?? (await latestWeekly());
}

function weeklyIndex(weekly: StoredWeekly | null) {
  const positional = new Map<string, number>();
  const flex = new Map<string, number>();
  const meta = new Map<string, { opponent: string; home: boolean }>();
  if (!weekly) return { positional, flex, meta };

  for (const list of Object.values(weekly.positional)) {
    for (const e of list) {
      if (!e.sleeperId) continue;
      // A week read off the FantasyPros board builds each position list out of
      // his SUPERFLEX list, so `rank` there is the superflex spot (Bateman
      // WR43 stored as 118). positionRank is the position rank whenever the
      // board supplied one; `rank` is only right for weeks read off Substack.
      positional.set(e.sleeperId, positionRankOf(e));
      meta.set(e.sleeperId, { opponent: e.opponent, home: e.home });
    }
  }
  for (const e of weekly.flex) {
    if (!e.sleeperId) continue;
    flex.set(e.sleeperId, e.rank);
    if (!meta.has(e.sleeperId)) meta.set(e.sleeperId, { opponent: e.opponent, home: e.home });
  }
  return { positional, flex, meta };
}

function blank(leagueId: string, why: string, profile?: LeagueProfile): WaiverContext {
  return {
    leagueId,
    leagueName: profile?.name ?? leagueId,
    week: null,
    budgetLeft: profile?.faab ?? null,
    budgetTotal: profile?.faab ?? null,
    freeAgentCount: 0,
    listTitle: null,
    listUpdatedLabel: null,
    seasonListTitle: "",
    seasonListMatchesScoring: true,
    report: EMPTY,
    pacing: null,
    source: { label: "", fresh: false, note: null },
    blocked: why,
  };
}

export type { LabIndex };
