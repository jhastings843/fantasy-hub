import "server-only";
import { labForScoring, scoringForLeague, type LabIndex } from "@/lib/jingles/active";
import { latestWeekly, type StoredWeekly } from "@/lib/jingles/ingest";
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

  const [weekly, lab, players, rosters, league, me] = await Promise.all([
    latestWeekly(),
    labForScoring(scoringForLeague(profile)),
    getAllPlayers(),
    getLeagueRosters(profile.id),
    getLeague(profile.id),
    getUser(username),
  ]);

  const mine = rosters.find((r) => r.owner_id === me.user_id);
  if (!mine) {
    return blank(leagueId, "No roster on this league belongs to you.", profile);
  }

  const owned = new Set<string>();
  const startable = startablePositions(profile.rosterPositions);
  for (const r of rosters) for (const id of r.players ?? []) owned.add(id);

  // Teams with a game this week, so a free agent on bye is not offered as a
  // start. Read from his own list, and through normalizeTeam on both sides:
  // he writes JAC where Sleeper says JAX, and comparing them raw is what put
  // two Jacksonville players on a phantom bye on 2026-09-09.
  const playing = new Set<string>();
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
    const season = lab.byId[id];
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
      injuryStatus: raw?.injury_status ?? null,
      onBye: isOnBye({
        ranked: pr !== null || fr !== null,
        team: normalizeTeam(raw?.team ?? null),
        teamsPlaying: playing,
      }),
      unranked: pr === null && fr === null,
      seasonRank: season?.rank ?? null,
      seasonPositionRank: season ? `${season.position}${season.positionRank}` : null,
      tier: season ? lab.tierFor(id) : null,
    };
  };

  // Only players his season list names. Scanning every unowned player in the
  // NFL turns a waiver page into a phone book, and anybody he has not ranked in
  // three hundred is not a claim worth surfacing unaided.
  const freeAgents = lab.list
    .filter((e) => !owned.has(e.sleeperId))
    .map((e) => toPlayer(e.sleeperId))
    // Sleeper uses DEF, which matches roster slots; the Lab list uses DST.
    .filter((p) => isStartableIn(p.position, startable));

  const roster = (mine.players ?? []).map(toPlayer);

  const budgetTotal = profile.faab;
  const used = mine.settings?.waiver_budget_used ?? null;
  const budgetLeft =
    budgetTotal !== null && typeof used === "number" ? budgetTotal - used : budgetTotal;

  const report = waiverTargets({
    rosterPositions: profile.rosterPositions,
    roster,
    freeAgents,
  });

  // --- Pricing ---
  //
  // Only when the league runs a budget. The inputs are the league's own
  // winning bids, Sleeper's trending adds (how contested a claim is), my
  // record, and in dynasty the roster's trajectory from RosterAudit, so a
  // rebuilder and a contender are told different numbers for the same man.
  let pacing: Pacing | null = null;
  if (budgetTotal !== null && budgetLeft !== null && profile.type !== "guillotine") {
    const nflState = await getNflState().catch(() => null);
    // The NFL week, not the week of his latest post: pacing and the bid
    // history are about where the season is, and his weekly list can lag a
    // day behind the calendar.
    const week = nflState?.week ?? weekly?.week ?? 1;
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

    const candidateFor = (id: string, position: string, weekGain: number): ClaimCandidate => ({
      playerId: id,
      position,
      age: players[id]?.age ?? null,
      seasonPositionRank: lab.byId[id]?.positionRank ?? null,
      weekGain,
    });

    // Historical bids are tiered by the player's season rank alone; what he
    // was worth to the buyer's lineup that week is not recoverable.
    const observed: ObservedClaim[] = bids.map((bid) => {
      const position = players[bid.playerId]?.position ?? "WR";
      const tier = classifyClaim(candidateFor(bid.playerId, position, 0), { ...base, observed: [] });
      return { tier, amount: bid.amount };
    });
    const ctx: PricingContext = { ...base, observed };

    for (const t of report.startable) {
      const gain = Math.max(0, scoreOf(t.player) - (t.displaces ? scoreOf(t.displaces) : 0));
      t.price = priceClaim(candidateFor(t.player.playerId, t.player.position, gain), ctx);
    }
    for (const t of report.seasonUpgrades) {
      const starts = report.startable.find((s) => s.player.playerId === t.player.playerId);
      const gain = starts
        ? Math.max(0, scoreOf(starts.player) - (starts.displaces ? scoreOf(starts.displaces) : 0))
        : 0;
      t.price = priceClaim(candidateFor(t.player.playerId, t.player.position, gain), ctx);
    }
    pacing = pacingFor(ctx);
  }

  return {
    leagueId: profile.id,
    leagueName: profile.name,
    week: weekly?.week ?? null,
    budgetLeft,
    budgetTotal,
    freeAgentCount: freeAgents.length,
    listTitle: weekly?.title ?? null,
    listUpdatedLabel: weekly?.updatedLabel ?? null,
    seasonListTitle: lab.title,
    seasonListMatchesScoring: lab.matchesLeagueScoring,
    report,
    pacing,
    blocked: weekly
      ? null
      : "No weekly rankings ingested yet, so the this-week half of this page is empty. The season-long claims below still stand.",
  };
}

function weeklyIndex(weekly: StoredWeekly | null) {
  const positional = new Map<string, number>();
  const flex = new Map<string, number>();
  const meta = new Map<string, { opponent: string; home: boolean }>();
  if (!weekly) return { positional, flex, meta };

  for (const list of Object.values(weekly.positional)) {
    for (const e of list) {
      if (!e.sleeperId) continue;
      positional.set(e.sleeperId, e.rank);
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
    blocked: why,
  };
}

export type { LabIndex };
