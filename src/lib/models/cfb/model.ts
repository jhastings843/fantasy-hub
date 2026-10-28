// Our college football model (Jack, 2026-10-28: build it, and have it learn
// to find an edge). Two online ratings, both leak-free (a game reads only
// games before it), fit on 2016-2023 and tested on 2024-2025 by
// scripts/fit-cfb-ratings.mts:
//
// 1. Margin: the NFL model's results rating (lib/models/nfl/spread.ts
//    Ratings, perf side), margin capped, home edge, a share carried into the
//    next season (preseason regression toward zero). Projected home margin =
//    home rating minus away rating plus the home edge (none at a neutral site).
// 2. Points: each team's offense (points scored over the league average)
//    and defense (points allowed under it), same update and carry. Gives the
//    projected total.
//
// Projected score: home = (total + margin) / 2, away = (total - margin) / 2.
// Win chance: normal on the margin with the spread of real margins around it.
// The fit kept the whole margin rating into a new season (carry 1: no
// regression helped) and a 0.6 share of the points ratings. On 2024-2025 it
// found no edge against the line from these alone (49.5% on our side at the
// opener), only a small line move our way; the edge hunt is the learner's job
// (track.ts slices on the shared engine). Pure.

import { Ratings, type RatingParams, type SpreadGame } from "@/lib/models/nfl/spread";

export interface PointsParams {
  /** Home edge in points scored, split half to each side. */
  hfa: number;
  /** Learning rate on each side's points miss. */
  k: number;
  /** Points miss cap. */
  cap: number;
  /** Share of each offense and defense rating carried into a new season. */
  carry: number;
}

export interface CfbParams {
  rating: RatingParams;
  points: PointsParams;
  /** Standard deviation of real margins around ours, for the win chance. */
  sigma: number;
}

export interface CfbResult {
  id: string;
  season: number;
  /** ISO date (YYYY-MM-DD) of kickoff. */
  date: string;
  home: string;
  away: string;
  homeScore: number;
  awayScore: number;
  neutral: boolean;
}

export interface Projection {
  /** Expected home margin (positive = home wins by that much). */
  margin: number;
  /** Our spread in the line's convention: home side, negative = home favored. */
  spread: number;
  total: number;
  homePts: number;
  awayPts: number;
  /** Chance the home team wins, 0-1. */
  homeWin: number;
}

const clip = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const r1 = (x: number) => Math.round(x * 10) / 10;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** Standard normal CDF (Abramowitz-Stegun 7.1.26, error under 1.5e-7). */
export function phi(z: number): number {
  const t = 1 / (1 + (0.3275911 * Math.abs(z)) / Math.SQRT2);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

/** Projected score from a margin and a total (any model's), plus the win chance at this sigma. */
export function projectedScore(margin: number, total: number, sigma: number): Projection {
  return {
    margin: r1(margin),
    spread: r1(-margin) || 0,
    total: r1(total),
    homePts: r1((total + margin) / 2),
    awayPts: r1((total - margin) / 2),
    homeWin: r3(phi(margin / sigma)),
  };
}

/** Offense and defense points ratings, grown a game at a time. */
export class PointsRatings {
  off = new Map<string, number>();
  def = new Map<string, number>();
  /** Running league average points per team per game (28 for college; the NFL starts it near 22). */
  avg: number;
  season = 0;

  constructor(
    readonly p: PointsParams,
    start = 28,
  ) {
    this.avg = start;
  }

  private newSeason(season: number) {
    if (season === this.season) return;
    for (const [t, v] of this.off) this.off.set(t, v * this.p.carry);
    for (const [t, v] of this.def) this.def.set(t, v * this.p.carry);
    this.season = season;
  }

  /** Expected points for each side. */
  expect(season: number, home: string, away: string, neutral: boolean): { home: number; away: number } {
    this.newSeason(season);
    const h = neutral ? 0 : this.p.hfa / 2;
    return {
      home: this.avg + (this.off.get(home) ?? 0) - (this.def.get(away) ?? 0) + h,
      away: this.avg + (this.off.get(away) ?? 0) - (this.def.get(home) ?? 0) - h,
    };
  }

  add(g: CfbResult) {
    const e = this.expect(g.season, g.home, g.away, g.neutral);
    const eh = clip(g.homeScore - e.home, -this.p.cap, this.p.cap);
    const ea = clip(g.awayScore - e.away, -this.p.cap, this.p.cap);
    const k = this.p.k / 2;
    this.off.set(g.home, (this.off.get(g.home) ?? 0) + k * eh);
    this.def.set(g.away, (this.def.get(g.away) ?? 0) - k * eh);
    this.off.set(g.away, (this.off.get(g.away) ?? 0) + k * ea);
    this.def.set(g.home, (this.def.get(g.home) ?? 0) - k * ea);
    // The league average drifts slowly toward what is being scored.
    this.avg += 0.002 * ((g.homeScore + g.awayScore) / 2 - this.avg);
  }
}

const asSpreadGame = (g: Pick<CfbResult, "id" | "season" | "date" | "home" | "away" | "neutral"> & { homeScore: number | null; awayScore: number | null }): SpreadGame => ({
  id: g.id,
  season: g.season,
  week: 0,
  type: "REG",
  gameday: g.date,
  home: g.home,
  away: g.away,
  homeScore: g.homeScore,
  awayScore: g.awayScore,
  line: null,
  homeRest: 7,
  awayRest: 7,
  homeQb: "",
  awayQb: "",
  neutral: g.neutral,
});

/** Both ratings together: feed finished games in date order, ask for any upcoming game. */
export class CfbModel {
  readonly margin: Ratings;
  readonly points: PointsRatings;

  constructor(readonly p: CfbParams) {
    this.margin = new Ratings(p.rating);
    this.points = new PointsRatings(p.points);
  }

  project(g: { season: number; home: string; away: string; neutral: boolean }): Projection {
    // features(line 0).gap is the results rating's expected home margin; it also rolls the season.
    const m = this.margin.features(asSpreadGame({ id: "", date: "", ...g, homeScore: null, awayScore: null }), 0).gap;
    const pts = this.points.expect(g.season, g.home, g.away, g.neutral);
    return projectedScore(m, pts.home + pts.away, this.p.sigma);
  }

  add(g: CfbResult) {
    this.margin.add(asSpreadGame(g));
    this.points.add(g);
  }

  /** Every result folded in, a whole day before the next (so an early kickoff never informs a later one the same day). */
  static from(p: CfbParams, results: CfbResult[]): CfbModel {
    const m = new CfbModel(p);
    for (const g of [...results].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))) m.add(g);
    return m;
  }
}
