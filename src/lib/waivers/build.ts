import "server-only";
import { labForScoring, scoringForLeague, type LabIndex } from "@/lib/jingles/active";
import { latestWeekly, type StoredWeekly } from "@/lib/jingles/ingest";
import { normalizeTeam } from "@/lib/jingles/resolve";
import { resolveLeague } from "@/lib/league/discover";
import type { LeagueProfile } from "@/lib/league/types";
import { isOnBye } from "@/lib/lineup/weekly-advice";
import { getAllPlayers, getLeague, getLeagueRosters, getUser } from "@/lib/sleeper/client";
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
  /** How many players are unowned across the whole league. */
  freeAgentCount: number;
  listTitle: string | null;
  listUpdatedLabel: string | null;
  seasonListTitle: string;
  /** False when the season list is for different scoring than this league. */
  seasonListMatchesScoring: boolean;
  report: WaiverReport;
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
    .map((e) => toPlayer(e.sleeperId));

  const roster = (mine.players ?? []).map(toPlayer);

  const budgetTotal = profile.faab;
  const used = mine.settings?.waiver_budget_used ?? null;
  const budgetLeft =
    budgetTotal !== null && typeof used === "number" ? budgetTotal - used : budgetTotal;

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
    report: waiverTargets({
      rosterPositions: profile.rosterPositions,
      roster,
      freeAgents,
    }),
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
    blocked: why,
  };
}

export type { LabIndex };
