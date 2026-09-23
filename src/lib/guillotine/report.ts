import "server-only";
import {
  getLeague,
  getLeagueRosters,
  getLeagueUsers,
  getNflState,
  getUser,
} from "@/lib/sleeper/client";
import { profileFromSleeper } from "@/lib/league/detect";
import { planBudget } from "./budget";
import { seasonOutlook } from "./outlook";
import { callPosture, simulateChop, toSimTeam, type SimTeam } from "./chop-line";
import { readLeagueState, seasonBids, seasonResults, writeSnapshot } from "./league-state";
import { lastWeekFor } from "./results";
import { assessFragility, submittedLineupNote, type Fragility } from "./fragility";
import { buildMarket, type ObservedBid, type Tier } from "./market";
import { getByeWeeks, getSeasonRates, getWeekProjections } from "./projections";
import { buildBidCard, finalFourBars } from "./recommend";
import { bestLineup, slotAccepts } from "./lineup";
import { snapshotFrom } from "./roster-diff";
import { scoringSkewNotes } from "./scoring";
import type { LeagueProfile } from "@/lib/league/types";
import type { PoolPlayer, Wallet, WeeklyFaabReport } from "./types";

// The one assembly. The page, the API and the email all call this, so a number
// shown in the app and a number sent in the email cannot disagree. That lesson
// came from the draft board, which existed twice before it existed once.

/**
 * How many available players PER POSITION to carry into the recommender.
 *
 * Not a flat top-N of the whole pool, which was the first version and quietly
 * broke in a one-quarterback league: quarterbacks outscore everyone, so the top
 * of the free agent list is nothing but backup QBs who can never enter the
 * lineup, and the running backs who could actually help fall off the end.
 */
const POOL_PER_POSITION = 30;

/**
 * Sleeper statuses that mean the player will not take a snap this week.
 * Doubtful is in the list on purpose: the strategy doc's conservative
 * projection is "zero for likely inactives", and doubtful players sit out far
 * more often than they play.
 */
const UNAVAILABLE = new Set(["Out", "IR", "NA", "PUP", "Sus", "Suspended", "DNR", "Doubtful"]);

const EMPTY_FRAGILITY: Fragility = {
  bestTotal: 0,
  submittedTotal: null,
  submittedGap: 0,
  submittedHoles: [],
  shakyStarters: [],
  worstOneOut: null,
  thinSlots: [],
  fragile: false,
  reasons: [],
};

function fallbackReport(
  state: WeeklyFaabReport["state"],
  message: string,
  partial: Partial<WeeklyFaabReport> = {},
): WeeklyFaabReport {
  return {
    state,
    message,
    league: {
      id: "",
      name: "",
      season: "",
      teams: 0,
      teamsAlive: 0,
      budget: 0,
      scoringNotes: [],
      tradesDisabled: false,
    },
    week: 0,
    generatedAt: new Date().toISOString(),
    posture: { posture: "yellow", headline: "No advice", detail: message },
    phase: "field",
    risk: {
      teams: [],
      expectedChopLine: 0,
      myMargin: null,
      myChopProbability: null,
      baselineRisk: 0,
      simulations: 0,
      chopLineRange: [0, 0],
    },
    field: [],
    me: {
      rosterId: 0,
      name: "",
      faabRemaining: 0,
      projected: 0,
      starters: [],
      weakSlots: [],
      byeAlerts: [],
      lastWeek: null,
      fragility: EMPTY_FRAGILITY,
    },
    season: {
      spent: 0,
      remaining: 0,
      holdFloor: 0,
      onPace: true,
      aheadBy: 0,
      next: [],
      inversionWeek: null,
      pacingOffWeek: null,
    },
    wallets: [],
    budget: {
      phase: "field",
      phaseNote: "",
      eliminationsRemaining: 0,
      neutralAllowance: 0,
      holdFloor: 0,
      weeklyCap: 0,
      maxSingleBid: 0,
      originalBudget: 0,
      purchasingPowerShare: 0,
      maxRivalBid: 0,
      notes: [],
    },
    market: { estimates: {} as never, history: [], note: "" },
    card: {
      chains: [],
      maxPossibleSpend: 0,
      weeklyCap: 0,
      sitOut: true,
      summary: message,
      sharedDisplacement: [],
    },
    caveats: [],
    ...partial,
  };
}

/** Enough of the league for a no-advice report to still name itself. */
function identity(profile: LeagueProfile): Partial<WeeklyFaabReport> {
  return {
    league: {
      id: profile.id,
      name: profile.name,
      season: profile.season,
      teams: profile.teams,
      teamsAlive: profile.teams,
      budget: profile.faab ?? 0,
      scoringNotes: [],
      tradesDisabled: false,
    },
  };
}

export async function buildWeeklyReport(leagueId: string): Promise<WeeklyFaabReport> {
  const league = await getLeague(leagueId);
  const profile = profileFromSleeper(league);

  if (profile.type !== "guillotine") {
    return fallbackReport(
      "not_guillotine",
      `${profile.name} is a ${profile.type} league. FAAB advice in this shape only applies to a guillotine league, where a chopped roster hits waivers every week and the money never comes back.`,
      identity(profile),
    );
  }

  if (profile.status === "pre_draft" || profile.status === "drafting") {
    return fallbackReport(
      "pre_draft",
      `${profile.name} has not drafted yet, so there is no roster to protect and no pool to bid into. This turns on the week after the draft.`,
      identity(profile),
    );
  }

  const budgetTotal = profile.faab ?? 0;
  const scoring = league.scoring_settings ?? {};

  const [nflState, rosters, users, username] = await Promise.all([
    getNflState(),
    getLeagueRosters(leagueId),
    getLeagueUsers(leagueId),
    Promise.resolve(process.env.SLEEPER_USERNAME),
  ]);

  const week = nflState.week ?? 1;

  if (!username) {
    return fallbackReport(
      "not_guillotine",
      "SLEEPER_USERNAME is not set, so the app cannot tell which of the sixteen rosters is yours.",
    );
  }

  const me = await getUser(username);
  const myRoster = rosters.find((r) => r.owner_id === me.user_id);
  if (!myRoster) {
    return fallbackReport(
      "not_guillotine",
      `No roster in ${profile.name} belongs to ${username}.`,
    );
  }

  const [weekProjections, seasonRates, byes, state, results] = await Promise.all([
    getWeekProjections(leagueId, profile.season, week, scoring),
    getSeasonRates(leagueId, profile.season, scoring),
    getByeWeeks(leagueId, profile.season, week, scoring),
    readLeagueState(leagueId, week, rosters, budgetTotal),
    seasonResults(leagueId, week - 1),
  ]);

  if (Object.keys(weekProjections).length === 0) {
    return fallbackReport(
      "no_projections",
      `Sleeper has no projections for week ${week} yet. Without them there is no chop line and no way to price a bid, so this report waits rather than guessing.`,
    );
  }

  const choppedIds = new Set(state.choppedPlayerIds);

  const toPool = (playerId: string): PoolPlayer | null => {
    const weekly = weekProjections[playerId];
    const rate = seasonRates[playerId];
    if (!weekly && !rate) return null;
    const base = weekly ?? rate;
    const team = base.team;
    return {
      playerId,
      name: base.name,
      position: base.position,
      team,
      weekPoints: weekly?.points ?? 0,
      rosPoints: rate?.points ?? weekly?.points ?? 0,
      injuryStatus: base.injuryStatus,
      byeWeek: team ? (byes[team] ?? null) : null,
      fromChoppedRoster: choppedIds.has(playerId),
    };
  };

  const poolFor = (ids: string[]): PoolPlayer[] =>
    ids.map(toPool).filter((p): p is PoolPlayer => p !== null);

  // --- The field ---

  const teamName = (rosterId: number): string => {
    const roster = rosters.find((r) => r.roster_id === rosterId);
    const user = users.find((u) => u.user_id === roster?.owner_id);
    return user?.metadata?.team_name || user?.display_name || user?.username || `Roster ${rosterId}`;
  };

  const simTeams: SimTeam[] = state.aliveRosterIds.map((rosterId) => {
    const roster = rosters.find((r) => r.roster_id === rosterId);
    const players = poolFor(roster?.players ?? []).map((p) => ({
      playerId: p.playerId,
      position: p.position,
      // A player ruled out is a zero, not a projection. Treating him as healthy
      // is the single most expensive mistake this report could make. Sleeper
      // uses several strings for "will not play", and NA is the one that caught
      // this out: Josh Jacobs carried it with no week-1 stat line at all.
      points: UNAVAILABLE.has(p.injuryStatus ?? "") ? 0 : p.weekPoints,
    }));
    return toSimTeam(
      rosterId,
      teamName(rosterId),
      rosterId === myRoster.roster_id,
      players,
      profile.rosterPositions,
    );
  });

  const lastWeek = lastWeekFor(results, myRoster.roster_id);
  const risk = simulateChop(simTeams);

  // Forward-looking: what one absence does to my roster, and whether the
  // lineup as set on Sleeper has a hole in it. Uses the same zeroing rule as
  // the simulation, so a ruled-out starter counts for nothing in both.
  const myPlayersForFragility = poolFor(myRoster.players ?? []).map((p) => ({
    playerId: p.playerId,
    position: p.position,
    points: UNAVAILABLE.has(p.injuryStatus ?? "") ? 0 : p.weekPoints,
    name: p.name,
    injuryStatus: p.injuryStatus,
  }));
  const fragility = assessFragility({
    players: myPlayersForFragility,
    submittedStarters: myRoster.starters ?? [],
    rosterPositions: profile.rosterPositions,
    chopLineRange: risk.chopLineRange,
  });

  const posture = callPosture(risk, lastWeek, fragility);

  // --- Budget ---

  const myFaab = state.faabRemaining[myRoster.roster_id] ?? 0;
  const rivalRemaining = state.aliveRosterIds
    .filter((id) => id !== myRoster.roster_id)
    .map((id) => state.faabRemaining[id] ?? 0);

  const budget = planBudget({
    budget: budgetTotal,
    remaining: myFaab,
    teamsAlive: state.aliveRosterIds.length,
    totalTeams: profile.teams,
    posture: posture.posture,
    rivalRemaining,
  });

  // --- Market ---

  const myPlayers = poolFor(myRoster.players ?? []);
  const leaguePlayers = [...state.rosteredPlayerIds]
    .map((id) => seasonRates[id])
    .filter((p): p is NonNullable<typeof p> => p != null)
    .map((p) => ({ position: p.position, rosPoints: p.points }));
  const bars = finalFourBars(leaguePlayers, profile.rosterPositions);

  const bids = await seasonBids(leagueId, Math.max(0, week - 1));
  const observed: ObservedBid[] = bids.map((bid) => {
    const player = seasonRates[bid.playerId];
    const rate = player?.points ?? 0;
    const bar = player ? (bars[player.position] ?? Infinity) : Infinity;
    // Tiering a historical bid by the player's level is the only reading
    // available after the fact: what he was worth to the buyer's lineup that
    // week is not recoverable.
    const tier: Tier = rate >= bar ? "championship" : rate >= bar * 0.6 ? "multiweek" : "bandaid";
    return { week: bid.week, tier, amount: bid.amount };
  });

  const season = seasonOutlook({
    budget: budgetTotal,
    remaining: myFaab,
    teamsAlive: state.aliveRosterIds.length,
    totalTeams: profile.teams,
    week,
  });

  // Named wallets rather than the single maxRivalBid number the plan carries.
  // "A rival can outbid you" is a fact you cannot act on; "the two teams above
  // you in the table are the ones who can" tells you which claims to skip.
  const wallets: Wallet[] = state.aliveRosterIds
    .map((id) => ({
      rosterId: id,
      name: teamName(id),
      isMine: id === myRoster.roster_id,
      remaining: state.faabRemaining[id] ?? 0,
    }))
    .sort((a, b) => b.remaining - a.remaining);

  const market = buildMarket(budgetTotal, budget.phase, observed);

  // --- The pool ---

  const byPosition = new Map<string, PoolPlayer[]>();
  for (const id of Object.keys(weekProjections)) {
    if (state.rosteredPlayerIds.has(id)) continue;
    const player = toPool(id);
    if (!player) continue;
    const list = byPosition.get(player.position) ?? [];
    list.push(player);
    byPosition.set(player.position, list);
  }

  const available = [...byPosition.values()].flatMap((list) =>
    list
      .sort((a, b) => b.weekPoints - a.weekPoints || b.rosPoints - a.rosPoints)
      .slice(0, POOL_PER_POSITION),
  );

  // What every surviving rival is starting, at its weakest point per position.
  //
  // This is the demand side of the market, and until now the model had none of
  // it: it knew what rivals could afford and nothing about whether they wanted
  // anybody. A quarterback who would walk into four other lineups is a
  // different purchase from one nobody else can use, at the same price.
  const rivalStarterBars: Record<string, number>[] = state.aliveRosterIds
    .filter((id) => id !== myRoster.roster_id)
    .map((id) => {
      const roster = rosters.find((r) => r.roster_id === id);
      const theirs = poolFor(roster?.players ?? []);
      const lineup = bestLineup(
        theirs.map((p) => ({ playerId: p.playerId, position: p.position, points: p.weekPoints })),
        profile.rosterPositions,
      );
      const byPosition: Record<string, number> = {};
      for (const slot of lineup.slots) {
        if (!slot.player) {
          // An unfilled slot is the strongest demand there is, and a bar of
          // zero says so without needing a special case downstream.
          for (const position of ["QB", "RB", "WR", "TE"]) {
            if (slotAccepts(slot.slot, position)) byPosition[position] = 0;
          }
          continue;
        }
        const player = theirs.find((t) => t.playerId === slot.player!.playerId);
        const position = player?.position ?? slot.player.position;
        const points = slot.player.points;
        byPosition[position] = Math.min(byPosition[position] ?? Infinity, points);
      }
      return byPosition;
    });

  const card = buildBidCard({
    myPlayers,
    candidates: available,
    rosterPositions: profile.rosterPositions,
    budget,
    market,
    posture: posture.posture,
    week,
    leaguePlayers,
    rivalStarterBars,
  });

  // --- My lineup, for the report's own section ---

  const mySim = simTeams.find((t) => t.isMine);
  const myLineup = (mySim?.starters ?? []).map((s) => {
    const player = myPlayers.find((p) => p.playerId === s.playerId);
    return {
      slot: player?.position ?? s.position,
      name: player?.name ?? s.playerId,
      points: s.points,
      injuryStatus: player?.injuryStatus ?? null,
    };
  });

  const byeAlerts = myPlayers
    .filter((p) => p.byeWeek != null && p.byeWeek > week)
    .map((p) => `${p.name} is on bye in week ${p.byeWeek}`);

  const caveats = [...state.caveats];
  const lineupNote = submittedLineupNote(fragility);
  if (lineupNote) caveats.unshift(lineupNote);
  for (const name of card.sharedDisplacement) {
    caveats.push(
      `Two of these groups would both replace ${name}. Winning both is legal, but the second upgrade is worth less than its stated gain, because the first already took that slot.`,
    );
  }
  if (results.length === 0 && week > 1) {
    caveats.push(
      `Sleeper returned no scores for the completed weeks, so last week's finish cannot be shown.`,
    );
  }
  if (market.history.length === 0 && week > 2) {
    caveats.push(
      "No winning FAAB bids have been recorded in this league yet, so prices are published benchmarks rather than what this room actually pays.",
    );
  }

  // Store this week's rosters so next week can tell what was chopped.
  await writeSnapshot(leagueId, snapshotFrom(rosters, week));

  return {
    state: "ok",
    league: {
      id: profile.id,
      name: profile.name,
      season: profile.season,
      teams: profile.teams,
      teamsAlive: state.aliveRosterIds.length,
      budget: budgetTotal,
      scoringNotes: scoringSkewNotes(scoring),
      tradesDisabled: league.settings?.disable_trades === 1,
    },
    week,
    generatedAt: new Date().toISOString(),
    posture,
    phase: budget.phase,
    risk,
    field: risk.teams,
    me: {
      rosterId: myRoster.roster_id,
      name: teamName(myRoster.roster_id),
      faabRemaining: myFaab,
      projected: risk.teams.find((t) => t.isMine)?.projected ?? 0,
      starters: myLineup,
      weakSlots: myLineup
        .slice()
        .sort((a, b) => a.points - b.points)
        .slice(0, 2)
        .map((s) => `${s.slot} ${s.name} (${s.points.toFixed(1)})`),
      byeAlerts,
      lastWeek,
      fragility,
    },
    budget,
    season,
    wallets,
    market,
    card,
    caveats,
  };
}
