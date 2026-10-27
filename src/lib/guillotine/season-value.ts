// What a player is worth per week for the rest of the season.
//
// This used to be Sleeper's PRESEASON season projection divided by 17, all
// season long. By week 8 that number knows nothing about what happened: it had
// Isaiah Likely at 9.3 a week while he was scoring 16.1 (TE3 in the league),
// and Harold Fannin Jr. above him while Fannin scored 9.5 (TE18). The card then
// built a chain around "replacing Fannin" and offered Likely as a drop.
//
// The fix is the standard shrinkage blend: the season-to-date rate pulls the
// preseason rate toward it in proportion to games played, with the preseason
// projection counting as PRIOR_GAMES games of evidence. Three games in, the
// preseason view still carries more than half the weight; seven games in, the
// season so far carries about two thirds.

/** How many games of evidence the preseason projection is worth. */
export const PRIOR_GAMES = 4;

/** Below this, a player with no preseason projection is still noise. */
export const MIN_GAMES_WITHOUT_PRIOR = 3;

export interface SeasonToDate {
  points: number;
  games: number;
}

export function blendedRate(prior: number | null, toDate: SeasonToDate | undefined): number | null {
  const games = toDate?.games ?? 0;
  if (games === 0) return prior;
  const actual = toDate!.points / games;
  if (prior == null) return games >= MIN_GAMES_WITHOUT_PRIOR ? actual : null;
  const w = games / (games + PRIOR_GAMES);
  return w * actual + (1 - w) * prior;
}

/**
 * Apply the blend to a whole rate table, keeping every other field. Players
 * with no preseason line but a real season (a rookie who took a job) join
 * the table through `fallback`, which supplies their name and position.
 */
export function blendRates<T extends { points: number }>(
  rates: Record<string, T>,
  toDate: Record<string, SeasonToDate>,
  fallback: Record<string, T> = {},
): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [id, rate] of Object.entries(rates)) {
    out[id] = { ...rate, points: blendedRate(rate.points, toDate[id]) ?? rate.points };
  }
  for (const [id, season] of Object.entries(toDate)) {
    if (out[id] || !fallback[id]) continue;
    const points = blendedRate(null, season);
    if (points != null) out[id] = { ...fallback[id], points };
  }
  return out;
}
