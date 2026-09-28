import type { Candidate } from "./types";

// Two pools on the same team is one bet, not two.
//
// Each pool is priced on its own, so when one team tops both boards the engine
// recommends it in both, and one upset ends both entries at once. That is how
// week 3 of 2026 went: SEA in the 500 and SEA in the 30, SEA lost 31-33, both
// pools gone on one game.
//
// Splitting is not free. The top pick is usually top for a reason, and forcing
// the second pool onto a clearly worse team trades real win probability for
// variance. So the rule is soft: split only when the next team is close enough
// that the cost is small, and otherwise stack and say so plainly.

/**
 * How far behind on score an alternative may be and still take the pool, in
 * the log-equity units the engine ranks by. 0.03 is about 3% of equity, three
 * times the widest tie band: close, not merely indistinguishable.
 */
export const SPLIT_SCORE_BAND = 0.03;

/** How much win probability the alternative may give up. Three points. */
export const SPLIT_WINPROB_BAND = 0.03;

/**
 * What this pool is doing about sharing a team with another pool this week.
 *
 * split    the top team was already the play in another pool, and this pool
 *          moved to a close alternative instead.
 * stacked  both pools are on the same team, either because nothing close was
 *          left to move to or because the picks were already taken that way.
 */
export interface CrossPool {
  kind: "split" | "stacked";
  /** The team the pools share, or would have shared. */
  team: string;
  /** Display name of the other pool on that team. */
  otherPool: string;
  /** The team this pool moved to, when it split. */
  movedTo: string | null;
}

/**
 * The best candidate that no other pool is on and that sits inside both bands
 * against the leader, or null when nothing is close enough to be worth it.
 */
export function splitAlternative(
  candidates: Candidate[],
  claimed: Record<string, string>,
): Candidate | null {
  const top = candidates[0];
  if (!top) return null;
  return (
    candidates.find(
      (c) =>
        c.team !== top.team &&
        !(c.team in claimed) &&
        top.score - c.score <= SPLIT_SCORE_BAND &&
        top.winProb - c.winProb <= SPLIT_WINPROB_BAND,
    ) ?? null
  );
}

/**
 * What moving to the alternative costs, in score units. Infinity when there is
 * nowhere to move, so the pool with no alternative is always the one that keeps
 * its pick.
 */
export function splitCost(candidates: Candidate[], claimed: Record<string, string> = {}): number {
  const alt = splitAlternative(candidates, claimed);
  return alt ? candidates[0].score - alt.score : Infinity;
}

function pts(x: number): string {
  return `${(x * 100).toFixed(1)}`;
}

/** The sentence that goes first in reasoning, so the email carries it. */
export function crossPoolSentence(
  cp: CrossPool,
  from: Candidate | null,
  to: Candidate | null,
  taken: boolean,
): string {
  if (cp.kind === "split" && from && to) {
    const equity = (Math.exp(from.score - to.score) - 1) * 100;
    const wp = from.winProb - to.winProb;
    const cost =
      wp > 0
        ? `gives up ${pts(wp)} points of win probability and ${equity.toFixed(1)}% of equity`
        : `is no less likely to win and trails by ${equity.toFixed(1)}% of equity`;
    return `Split from the ${cp.otherPool}: ${cp.team} is the play there, and one upset would end both entries. ${to.team} ${cost}, which is cheap insurance, so this pool takes ${to.team}.`;
  }
  return taken
    ? `Same team as the ${cp.otherPool}: you have ${cp.team} in both, so one loss ends both entries.`
    : `Same team as the ${cp.otherPool}: nothing else is close enough to split onto, so both pools ride on ${cp.team} and one loss ends both.`;
}
