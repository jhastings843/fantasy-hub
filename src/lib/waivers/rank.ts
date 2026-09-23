import { bestLineup, marginalValue, type LineupPlayer } from "@/lib/lineup/solve";
import { cannotPlay, scoreOf, type AdvicePlayer } from "@/lib/lineup/weekly-advice";
import type { ClaimPrice } from "./price";
import type { LastWeekUsage } from "./freshness";

// Who to claim, and who to drop for them.
//
// Two different questions, and conflating them is the mistake this file exists
// to avoid. "Who helps me win on Sunday" is answered by his weekly list and by
// whether the player would actually crack the lineup. "Who is worth a claim" is
// answered by his season-long list, because most waiver claims are about the
// rest of the year and a player who is not startable this week can still be the
// best asset available.
//
// Both are reported, separately, and the page says which is which. On
// 2026-09-09 Sunday Scaries had nothing worth starting on the wire and a clear
// season-long upgrade at the same time, and an app that answered only one of
// those questions would have said the wrong thing either way.
//
// Everything here is pure. The fetching lives in build.ts.

export interface WaiverPlayer extends AdvicePlayer {
  /** Rank in his season-long list, when he ranked the player at all. */
  seasonRank: number | null;
  /** "WR54", for identifying a player at a glance. */
  seasonPositionRank: string | null;
  tier: string | null;
  /** What he actually did last week. Null before any week has been played. */
  lastWeek?: LastWeekUsage | null;
  /** The web consensus on him this week, when the research named him. */
  research?: { tier: string; faabPercent: number | null; note: string } | null;
  /**
   * His waiver post on him this week.
   *
   * Kept apart from `research` on purpose. The web consensus is a dozen
   * columns averaged into one number, and this is one analyst with a name, a
   * rank and a dollar figure he committed to. Folding his bid into the
   * consensus would launder the second into the first, and his is the one Jack
   * actually wants to see.
   */
  jingles?: {
    rank: number | null;
    /** The dollars he wrote, against the budget his post prices for. */
    faab: number;
    /** That bid as a percent of the budget, which is what travels between leagues. */
    faabPercent: number;
    budget: number;
    note: string | null;
  } | null;
}

export interface StartableTarget {
  player: WaiverPlayer;
  /** The slot he would take. */
  slot: string;
  /** The player he would push out of the lineup. */
  displaces: WaiverPlayer | null;
  /** What to bid, once the league's budget and market are known. */
  price?: ClaimPrice;
}

export interface SeasonTarget {
  player: WaiverPlayer;
  /**
   * The worst rostered player he beats, and the one to drop for him.
   *
   * Null only when there is a free roster spot, in which case the claim costs
   * nothing. It is never null because nobody could be found: a claim whose
   * price is unknown is not a recommendation, it is a suggestion with the
   * expensive half left out.
   */
  dropFor: WaiverPlayer | null;
  /** How many places better on the season list. */
  placesBetter: number | null;
  /** What to bid, once the league's budget and market are known. */
  price?: ClaimPrice;
  /** Why this one, when the pick came off his weekly list: "WR38 this week, Wicks is WR45". */
  why?: string | null;
  /** His own waiver-post pick for the same drop, when it is somebody else. */
  alternative?: WaiverPlayer | null;
}

export interface WaiverReport {
  /** Free agents who would start for you this week. Usually empty. */
  startable: StartableTarget[];
  /** Free agents worth a claim for the rest of the season. */
  seasonUpgrades: SeasonTarget[];
  /** Your roster, worst first, with anyone starting this week removed. */
  dropCandidates: WaiverPlayer[];
  /** Players on your roster this week's lineup depends on. Never drop these. */
  untouchable: string[];
}

const toLineupPlayer = (p: AdvicePlayer): LineupPlayer => ({
  playerId: p.playerId,
  position: p.position,
  points: scoreOf(p),
});

/**
 * Sort key for "how good is this player, all season".
 *
 * Unranked sorts last rather than first, which is the whole point: an absent
 * rank is the absence of an opinion, not a good one.
 */
const bySeasonRank = (a: WaiverPlayer, b: WaiverPlayer) =>
  (a.seasonRank ?? Number.MAX_SAFE_INTEGER) - (b.seasonRank ?? Number.MAX_SAFE_INTEGER);

/**
 * Whether his weekly list has `a` ahead of `b`.
 *
 * Only where the list actually compares them: the FLEX list ranks running
 * backs, receivers and tight ends against each other, and a position list
 * only ranks within its position. Anything else is "cannot say", not "no".
 */
export function beatsThisWeek(a: WaiverPlayer, b: WaiverPlayer): boolean {
  const fa = a.adjustedFlexRank ?? a.flexRank;
  const fb = b.adjustedFlexRank ?? b.flexRank;
  if (fa !== null && fb !== null) return fa < fb;
  if (a.position === b.position && a.positionalRank !== null && b.positionalRank !== null) {
    return a.positionalRank < b.positionalRank;
  }
  return false;
}

const weekLabel = (p: WaiverPlayer) =>
  p.positionalRank !== null ? `${p.position}${p.positionalRank}` : p.flexRank !== null ? `FLEX ${p.flexRank}` : "unranked";

const rankedThisWeek = (p: WaiverPlayer) => !p.unranked && !p.onBye;

export function waiverTargets(input: {
  rosterPositions: string[];
  roster: WaiverPlayer[];
  freeAgents: WaiverPlayer[];
  /** How many of each list to return. */
  limit?: number;
  /**
   * "rank" orders season claims by his list and only offers a claim that
   * beats the drop by rank. "given" trusts the order the caller passed, for
   * the weeks his list is stale and the wire is doing the ranking; there is
   * no rank to compare, so the only rule is not to drop a real asset.
   */
  seasonOrder?: "rank" | "given";
  /** In "given" mode, never propose dropping a player ranked this high. */
  protectRankedWithin?: number;
  /**
   * Free agents found only on his weekly list. Checked against this week's
   * lineup like any other free agent, but never offered as a season claim:
   * a week-3 matchup rank says nothing about who to hold for the season.
   */
  weeklyOnly?: WaiverPlayer[];
}): WaiverReport {
  const { rosterPositions, roster, freeAgents } = input;
  const limit = input.limit ?? 8;
  const givenOrder = input.seasonOrder === "given";
  const protectWithin = input.protectRankedWithin ?? 150;

  const byId = new Map(roster.map((p) => [p.playerId, p]));
  const available = roster.filter((p) => !cannotPlay(p));
  const lineup = bestLineup(available.map(toLineupPlayer), rosterPositions);

  // Anybody this week's lineup depends on is not a drop, whatever his season
  // rank says. A bye-week fill-in who is starting on Sunday is worth more than
  // a better player you cannot start, right up until Sunday is over.
  const untouchable = new Set(
    lineup.slots.map((s) => s.player?.playerId).filter(Boolean) as string[],
  );

  const startable: StartableTarget[] = [];
  for (const fa of [...freeAgents, ...(input.weeklyOnly ?? [])]) {
    if (cannotPlay(fa)) continue;
    const { gain, displaces, slot } = marginalValue(
      available.map(toLineupPlayer),
      toLineupPlayer(fa),
      rosterPositions,
    );
    if (gain <= 0 || !slot) continue;
    startable.push({
      player: fa,
      slot,
      displaces: displaces ? (byId.get(displaces.playerId) ?? null) : null,
    });
  }
  // By his weekly ordering, which is what "best" means for this week.
  startable.sort((a, b) => scoreOf(b.player) - scoreOf(a.player));

  // The worst thing on the roster that is not holding up this week's lineup.
  const droppable = roster
    .filter((p) => !untouchable.has(p.playerId))
    .sort((a, b) => bySeasonRank(b, a));

  // A claim on an empty roster spot costs nothing, so it needs no drop. Beyond
  // those, every claim is a swap and has to name its price.
  const openSpots = Math.max(0, rosterPositions.length - roster.length);

  const seasonUpgrades: SeasonTarget[] = givenOrder
    ? seasonByWeek({
        // A player already offered as a start is already a claim; naming him
        // twice in one email is noise, not emphasis.
        pool: [...freeAgents, ...(input.weeklyOnly ?? [])].filter(
          (p) => !startable.slice(0, limit).some((t) => t.player.playerId === p.playerId),
        ),
        droppable,
        openSpots,
        limit,
        protectWithin,
      })
    : seasonByRank(freeAgents, droppable, openSpots, limit);

  return {
    startable: startable.slice(0, limit),
    seasonUpgrades,
    dropCandidates: droppable.slice(0, limit),
    untouchable: [...untouchable],
  };
}

/**
 * Season claims when his season list is stale, decided by his weekly list.
 *
 * Built around the drops rather than the adds. For each bench player, worst
 * this week first, offer the best free agent his latest weekly list has ahead
 * of him, from anywhere: his waiver post, the research, Sleeper's most-added,
 * or simply his weekly list. That last source is the point. He leaves widely
 * rostered players out of his waiver post (Xavier Worthy, 67.6% rostered,
 * week 3), and a player who is free in THIS league and ranks WR38 against a
 * bench WR45 is a claim whatever the rest of Sleeper has done.
 *
 * His waiver-post pick for the same drop rides along as the alternative when
 * it is somebody else, with his bid, because his post is a season-long read
 * and a one-week rank is not. When nobody on his weekly list beats a drop, the
 * board's order fills it, but only for a drop that is not a real asset.
 */
function seasonByWeek(input: {
  pool: WaiverPlayer[];
  droppable: WaiverPlayer[];
  openSpots: number;
  limit: number;
  protectWithin: number;
}): SeasonTarget[] {
  const seen = new Set<string>();
  const pool = input.pool.filter((p) => {
    if (seen.has(p.playerId) || cannotPlay(p)) return false;
    seen.add(p.playerId);
    return true;
  });
  const byWeek = pool.filter(rankedThisWeek).sort((a, b) => scoreOf(b) - scoreOf(a));
  const his = pool
    .filter((p) => p.jingles)
    .sort((a, b) => (a.jingles!.rank ?? Infinity) - (b.jingles!.rank ?? Infinity));
  const protectedAsset = (d: WaiverPlayer) => d.seasonRank !== null && d.seasonRank <= input.protectWithin;

  const used = new Set<string>();
  const alternativesShown = new Set<string>();
  const alternativeFor = (pick: WaiverPlayer, d: WaiverPlayer | null) => {
    const alt = his.find(
      (p) =>
        p.playerId !== pick.playerId &&
        !used.has(p.playerId) &&
        !alternativesShown.has(p.playerId) &&
        (d === null || !protectedAsset(d) || beatsThisWeek(p, d)),
    );
    if (alt) alternativesShown.add(alt.playerId);
    return alt ?? null;
  };
  const out: SeasonTarget[] = [];

  for (let k = 0; k < input.openSpots && out.length < input.limit; k++) {
    const pick = byWeek.find((p) => !used.has(p.playerId)) ?? his.find((p) => !used.has(p.playerId));
    if (!pick) break;
    used.add(pick.playerId);
    out.push({
      player: pick,
      dropFor: null,
      placesBetter: null,
      why: rankedThisWeek(pick) ? `${weekLabel(pick)} this week` : null,
      alternative: alternativeFor(pick, null),
    });
  }

  // Worst this week first. A bench player on bye or off his list this week
  // has no rank to beat, so he is only droppable if he is not a real asset.
  const drops = [...input.droppable].sort((a, b) => scoreOf(a) - scoreOf(b));
  for (const d of drops) {
    if (out.length >= input.limit) break;
    // A drop with no rank this week (a stash, a bye, a player he left off)
    // gives the weekly list nothing to compare, and sorting everyone by it
    // anyway puts every receiver ahead of every quarterback, which is how a
    // superflex league's injury-replacement QBs vanished. So only a ranked
    // drop is decided by the weekly list; an unranked one falls to the board.
    const comparable = rankedThisWeek(d);
    let pick = comparable ? (byWeek.find((p) => !used.has(p.playerId) && beatsThisWeek(p, d)) ?? null) : null;
    let why: string | null = pick ? `${weekLabel(pick)} this week, ${d.name} is ${weekLabel(d)}` : null;
    // Nobody his weekly list has ahead of this drop. The board's own order
    // (his post, then the research, then Sleeper's most-added) still fills it,
    // but only when the drop is not a player his season list rates.
    // Never a player his weekly list has BEHIND the drop: that is a list
    // saying no, not a list with nothing to say.
    if (!pick && !protectedAsset(d)) {
      pick =
        pool.find(
          (p) => !used.has(p.playerId) && !(comparable && rankedThisWeek(p) && !beatsThisWeek(p, d)),
        ) ?? null;
      why = null;
    }
    if (!pick) continue;
    used.add(pick.playerId);
    out.push({ player: pick, dropFor: d, placesBetter: null, why, alternative: alternativeFor(pick, d) });
  }
  return out;
}

/** Season claims off a fresh season list: by his rank, each beating its drop. */
function seasonByRank(
  freeAgents: WaiverPlayer[],
  droppable: WaiverPlayer[],
  openSpots: number,
  limit: number,
): SeasonTarget[] {
  const seasonPool = freeAgents.filter((p) => p.seasonRank !== null).sort(bySeasonRank);

  return seasonPool
    .slice(0, limit)
    .map((player, i) => {
      if (i < openSpots) return { player, dropFor: null, placesBetter: null };
      // Pair the best available with the worst droppable, second with second,
      // so a list of five claims does not tell him to drop the same man five
      // times over.
      const dropFor = droppable[i - openSpots] ?? null;
      const placesBetter =
        dropFor && dropFor.seasonRank !== null && player.seasonRank !== null
          ? dropFor.seasonRank - player.seasonRank
          : null;
      return { player, dropFor, placesBetter };
    })
    .filter((t, i) => {
      // Free spot: anybody he ranked is worth taking.
      if (i < openSpots) return true;
      // No free spot and nobody droppable: the roster is all starters, and a
      // claim with no stated cost is not advice.
      if (t.dropFor === null) return false;
      // An unranked player is beaten by anybody he ranked.
      if (t.dropFor.seasonRank === null) return true;
      return t.player.seasonRank !== null && t.player.seasonRank < t.dropFor.seasonRank;
    });
}
