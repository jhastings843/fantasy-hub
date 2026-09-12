import type { Game, Ownership } from "./types";

/**
 * How a pool is likely to END, and what that implies about which of two
 * indistinguishable picks to prefer.
 *
 * WHY THIS EXISTS. Pool size turned out not to change the weekly equity number
 * at all: (1-(1-r)^N)/r is indistinguishable from 1/r once (1-r)^N vanishes, and
 * at r = 0.80 that has happened long before N reaches 30, so a 30-entry board
 * and a 500-entry board came back identical to five decimals on the real Week 1
 * slate. The published strategy work says pool size matters enormously, and both
 * halves are true because they are about different things. Bergman and Imbrogno
 * (Operations Research 65(5), 2017) find a longer planning horizon is better in
 * larger pools because you must assume you will need to last longer, and
 * PoolGenius makes the same point from the other side: a pool that resolves by
 * Thanksgiving does not need future value, and one that runs to Week 18 treats
 * top teams as scarce assets.
 *
 * So the quantity that actually separates two pools is how many entries are
 * still alive when the season runs out. Below one, surviving IS winning. Well
 * above one, the prize gets split and the only way to improve your share is to
 * be alive in a week that thins the field.
 *
 * That is already priced into equity, which is why this does NOT tilt the
 * ranking. It decides the order INSIDE the tie band, where the engine has
 * already said the teams cannot be separated on equity, so the pool's shape is
 * free information rather than the same effect counted twice.
 */
export interface Posture {
  /** Expected entries still alive after the last week, this one included. */
  expectedSurvivors: number;
  /**
   * "outright" when the field is expected to thin past a single entry before
   * the season ends, so surviving is the whole game. "shared" when a crowd is
   * expected to be left, so the realistic outcome is a split.
   */
  mode: "outright" | "shared";
  /** Which way to break a tie the engine cannot separate on equity. */
  tiebreak: "safety" | "leverage";
  summary: string;
}

/**
 * The fraction of the field expected to survive this week, unconditionally.
 *
 * Note this is an expectation, so the heavy correlation between entries (a third
 * of the field on one team) does not bias it. Correlation makes the outcome
 * lumpy, all-or-nothing rather than smooth, but expectation is linear and the
 * average is the average either way. Only the variance changes.
 */
export function fieldWeeklySurvival(weekGames: Game[], ownership: Ownership): number {
  let survives = 0;
  for (const g of weekGames) {
    survives += (ownership[g.home] ?? 0) * g.homeWinProb;
    survives += (ownership[g.away] ?? 0) * (1 - g.homeWinProb);
  }
  return Math.min(1, Math.max(0, survives));
}

/**
 * Below this many expected survivors the pool is treated as resolving to one
 * entry. Not 1.0: the estimate holds a weekly rate constant across months, so
 * insisting on a number below one would flip the posture on noise. 1.5 is one
 * half-entry of slack, which is about as precise as a constant rate deserves.
 */
const OUTRIGHT_THRESHOLD = 1.5;

export function poolPosture(input: {
  entriesAlive: number;
  week: number;
  lastWeek: number;
  /** This week's field survival rate, carried forward as a constant. */
  weeklySurvival: number;
}): Posture {
  const { entriesAlive, week, lastWeek } = input;
  const r = Math.min(1, Math.max(0, input.weeklySurvival));
  const weeksRemaining = Math.max(0, lastWeek - week + 1);
  const expectedSurvivors = Math.max(0, entriesAlive) * Math.pow(r, weeksRemaining);

  const outright = expectedSurvivors < OUTRIGHT_THRESHOLD;
  const rounded = expectedSurvivors < 10
    ? expectedSurvivors.toFixed(1)
    : String(Math.round(expectedSurvivors));

  return {
    expectedSurvivors,
    mode: outright ? "outright" : "shared",
    tiebreak: outright ? "safety" : "leverage",
    summary: outright
      ? `At this week's field survival rate, about ${rounded} entries are expected to be alive after week ${lastWeek}, so surviving is very likely winning outright. Ties on the board go to the safer team.`
      : `At this week's field survival rate, about ${rounded} entries are expected to be alive after week ${lastWeek}, so the realistic outcome is a split rather than an outright win. Ties on the board go to the team fewer rivals can follow you onto.`,
  };
}
