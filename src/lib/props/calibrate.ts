// What our player-prop chances actually hit (Jack, 2026-11-06: show calibrated
// numbers on the Props board). Fit on saved P(over) for games before
// 2026-10-29, logistic on the logit: both sports came out overconfident with
// slope about 0.35 (a raw 0.63 bin hit 0.49 in NBA). Display only: which
// markets count as edges, the slices and the grading are unchanged.
//
//   calibratedOver("nfl", 0.779) -> about 0.584
//   calibratedSide("nba", 0.30, "under") -> 1 - calibratedOver("nba", 0.30)
//
// Refit by hand when the props model changes; see HANDOFF 2026-11-06 (night).

export const PROPS_CALIBRATION = {
  nfl: { slope: 0.35, intercept: -0.1 },
  nba: { slope: 0.35, intercept: -0.02 },
} as const;

const logit = (p: number) => Math.log(p / (1 - p));
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

export function calibratedOver(league: "nfl" | "nba", pOver: number): number {
  const p = Math.min(0.999, Math.max(0.001, pOver));
  const c = PROPS_CALIBRATION[league];
  return sigmoid(c.intercept + c.slope * logit(p));
}

/** Calibrated chance for the side we lean, from our raw P(over). */
export function calibratedSide(league: "nfl" | "nba", pOver: number, side: "over" | "under"): number {
  const o = calibratedOver(league, pOver);
  return side === "over" ? o : 1 - o;
}
