// Our NFL totals model and projected score (Jack, 2026-10-28: "shouldn't our
// models be spitting out a projected score that can help determine that we
// have a model for totals as well?"). The college model's points ratings
// (lib/models/cfb/model.ts PointsRatings: each team's offense over the league
// average and defense under it, updated a game at a time, a share carried
// into a new season), fit on nflverse games by scripts/fit-nfl-totals.mts.
//
// Projected score = our spread model's margin (spread-live: the line moved by
// its predicted residual) with this total; win chance = normal on that margin
// with sigma, the spread of real margins around the spread model's. Tracked
// and judged as a source (picks learning "ours" totals cut and straight-up
// method); nothing stakes until the strategy review promotes it. Pure.

import { PointsRatings, projectedScore, type PointsParams, type Projection } from "@/lib/models/cfb/model";
import type { SpreadGame } from "./spread";

export interface NflTotalsParams {
  points: PointsParams;
  /** Starting league average points per team per game. */
  start: number;
  /** Standard deviation of real margins around our spread model's, for the win chance. */
  sigma: number;
}

/** A finished nflverse game in the points ratings' shape. */
const asResult = (g: SpreadGame) => ({
  id: g.id,
  season: g.season,
  date: g.gameday,
  home: g.home,
  away: g.away,
  homeScore: g.homeScore ?? 0,
  awayScore: g.awayScore ?? 0,
  neutral: g.neutral,
});

/** Points ratings with every final folded in, in date order. */
export function nflPoints(games: SpreadGame[], p: NflTotalsParams): PointsRatings {
  const r = new PointsRatings(p.points, p.start);
  for (const g of [...games].sort((a, b) => a.gameday.localeCompare(b.gameday) || a.id.localeCompare(b.id))) if (g.homeScore !== null && g.awayScore !== null) r.add(asResult(g));
  return r;
}

/** Projected total for an upcoming game. */
export function nflTotal(r: PointsRatings, g: Pick<SpreadGame, "season" | "home" | "away" | "neutral">): number {
  const e = r.expect(g.season, g.home, g.away, g.neutral);
  return e.home + e.away;
}

/** Projected score from our home spread (negative = home favored) and our total. */
export function nflProjection(ourSpread: number, total: number, p: Pick<NflTotalsParams, "sigma">): Projection {
  return projectedScore(-ourSpread, total, p.sigma);
}

export { asResult as nflResult };
