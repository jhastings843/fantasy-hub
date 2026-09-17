// What a free agent adds to this week's lineup, measured honestly.
//
// The lineup solver ranks players with a synthetic score (one million minus
// the FLEX rank) so that a better rank sorts first. That number orders a
// lineup; it is not points. The first version of waiver pricing subtracted
// two of them and called the difference "points added", which turned a
// ten-place rank gap into "Adds 10.0 to this week's lineup" and an unranked
// player against FLEX 150 into a gain of 998,850. Pricing then tiered every
// marginal pickup as a full-need starter.
//
// The gain is in projected points from the same weekly feed the lineup page
// reads, or it is unknown. Whether he starts at all is still the solver's
// opinion, kept separately, so a claim with no projection can still be
// described by the slot he takes and the rank he brings.

import type { WeekSlot } from "./price";

export interface ClaimGain {
  /** Projected points added, or null when the feed cannot say. */
  weekGain: number | null;
  /** He cracks this week's best lineup by rank. */
  startsThisWeek: boolean;
  weekSlot: WeekSlot | null;
}

interface RankedPlayer {
  playerId: string;
  name: string;
  adjustedFlexRank: number | null;
  flexRank: number | null;
  positionalRank: number | null;
}

interface Start {
  player: RankedPlayer;
  displaces: RankedPlayer | null;
  slot: string;
}

function rankOf(p: RankedPlayer): number | null {
  return p.adjustedFlexRank ?? p.flexRank ?? p.positionalRank ?? null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function claimGain(
  start: Start | null,
  points: Record<string, { points: number }>,
): ClaimGain {
  if (!start) return { weekGain: null, startsThisWeek: false, weekSlot: null };

  const mine = points[start.player.playerId]?.points ?? null;
  const theirs = start.displaces ? (points[start.displaces.playerId]?.points ?? null) : 0;
  const weekGain = mine === null || theirs === null ? null : Math.max(0, round1(mine - theirs));

  return {
    weekGain,
    startsThisWeek: true,
    weekSlot: {
      slot: start.slot,
      over: start.displaces?.name ?? null,
      from: start.displaces ? rankOf(start.displaces) : null,
      to: rankOf(start.player),
    },
  };
}
