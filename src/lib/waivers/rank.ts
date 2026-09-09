import { bestLineup, marginalValue, type LineupPlayer } from "@/lib/lineup/solve";
import { cannotPlay, scoreOf, type AdvicePlayer } from "@/lib/lineup/weekly-advice";

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
}

export interface StartableTarget {
  player: WaiverPlayer;
  /** The slot he would take. */
  slot: string;
  /** The player he would push out of the lineup. */
  displaces: WaiverPlayer | null;
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

export function waiverTargets(input: {
  rosterPositions: string[];
  roster: WaiverPlayer[];
  freeAgents: WaiverPlayer[];
  /** How many of each list to return. */
  limit?: number;
}): WaiverReport {
  const { rosterPositions, roster, freeAgents } = input;
  const limit = input.limit ?? 8;

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
  for (const fa of freeAgents) {
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

  const seasonUpgrades: SeasonTarget[] = freeAgents
    .filter((p) => p.seasonRank !== null)
    .sort(bySeasonRank)
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

  return {
    startable: startable.slice(0, limit),
    seasonUpgrades,
    dropCandidates: droppable.slice(0, limit),
    untouchable: [...untouchable],
  };
}
