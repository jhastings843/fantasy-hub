// Our NFL spread model, v1. It does not try to call games better than the
// market from scratch; it starts from the line and asks where the line has
// historically been wrong. The fair line is the market's line plus a
// predicted residual (actual margin minus the line), built from five
// features, each a number the market might misweigh:
//
// 1. gap: a results-only power rating (points, from margins, no lines) against
//    the line. Where the scoreboard and the market disagree.
// 2. move: the market's own rating (learned from past lines only) against
//    this line. How far the market changed its mind since last week, which is
//    where overreaction to one result or one headline would show.
// 3. cover: each team's last cover margin (margin minus its line), home minus
//    away. The "they just blew out the number" story.
// 4. rest: home rest days minus away, clipped to +-7.
// 5. qb: a new starting quarterback since the team's last game (home minus away).
//
// Ratings are online and leak-free: a game's features use only games before
// it. The residual weights are ridge regression refit walk forward on past
// seasons only (scripts/fit-nfl-spread.mts). Positive margins favor home;
// nflverse's spread_line is the expected home margin. Pure.

export interface SpreadGame {
  id: string;
  season: number;
  week: number;
  /** REG or POST: playoff games update the ratings too. */
  type: string;
  gameday: string;
  home: string;
  away: string;
  homeScore: number | null;
  awayScore: number | null;
  /** Expected home margin from the line (nflverse spread_line), null when missing. */
  line: number | null;
  homeRest: number;
  awayRest: number;
  homeQb: string;
  awayQb: string;
  neutral: boolean;
}

export interface RatingParams {
  /** Results rating: home edge in points, learning rate, margin cap, share carried into a new season. */
  hfa: number;
  kPerf: number;
  cap: number;
  carryPerf: number;
  /** Market rating: home edge, learning rate, share carried into a new season. */
  hfaMkt: number;
  kMkt: number;
  carryMkt: number;
}

export const FEATURES = ["gap", "move", "cover", "rest", "qb"] as const;
export type Feature = (typeof FEATURES)[number];
export type Features = { [f in Feature]: number };

export interface SpreadParams {
  rating: RatingParams;
  /** Ridge weights on the residual (margin minus line), per feature. */
  w: Features;
  /** Intercept: the line's average miss toward home. */
  b: number;
}

export interface Rated {
  game: SpreadGame;
  x: Features;
}

const clip = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** A small CSV reader result row (nflverse games.csv) into a SpreadGame. */
export function toSpreadGame(r: Record<string, string>): SpreadGame | null {
  if (r.game_type !== "REG" && !["WC", "DIV", "CON", "SB"].includes(r.game_type)) return null;
  const num = (s: string) => (s === "" || s === undefined ? null : Number(s));
  return {
    id: r.game_id,
    season: Number(r.season),
    week: Number(r.week),
    type: r.game_type === "REG" ? "REG" : "POST",
    gameday: r.gameday,
    home: r.home_team,
    away: r.away_team,
    homeScore: num(r.home_score),
    awayScore: num(r.away_score),
    line: num(r.spread_line),
    homeRest: Number(r.home_rest) || 7,
    awayRest: Number(r.away_rest) || 7,
    homeQb: r.home_qb_id ?? "",
    awayQb: r.away_qb_id ?? "",
    neutral: r.location === "Neutral",
  };
}

/** Team history the features read. Grown a game at a time by `rate`. */
export class Ratings {
  perf = new Map<string, number>();
  mkt = new Map<string, number>();
  lastCover = new Map<string, number>();
  lastQb = new Map<string, string>();
  season = 0;

  constructor(readonly p: RatingParams) {}

  private newSeason(season: number) {
    if (season === this.season) return;
    for (const [t, v] of this.perf) this.perf.set(t, v * this.p.carryPerf);
    for (const [t, v] of this.mkt) this.mkt.set(t, v * this.p.carryMkt);
    this.lastCover.clear();
    this.season = season;
  }

  /** Features for a game about to be played, given the line it will be judged against. */
  features(g: SpreadGame, line: number, qb?: { home: string; away: string }): Features {
    this.newSeason(g.season);
    const h = g.neutral ? 0 : 1;
    const perf = (this.perf.get(g.home) ?? 0) - (this.perf.get(g.away) ?? 0) + h * this.p.hfa;
    const mkt = (this.mkt.get(g.home) ?? 0) - (this.mkt.get(g.away) ?? 0) + h * this.p.hfaMkt;
    const newQb = (team: string, id: string | undefined) => (id && this.lastQb.has(team) && this.lastQb.get(team) !== id ? 1 : 0);
    return {
      gap: perf - line,
      move: line - mkt,
      cover: (this.lastCover.get(g.home) ?? 0) - (this.lastCover.get(g.away) ?? 0),
      rest: clip(g.homeRest - g.awayRest, -7, 7),
      qb: newQb(g.home, qb?.home ?? g.homeQb) - newQb(g.away, qb?.away ?? g.awayQb),
    };
  }

  /** Fold a finished game in. */
  add(g: SpreadGame) {
    this.newSeason(g.season);
    if (g.homeScore === null || g.awayScore === null) return;
    const h = g.neutral ? 0 : 1;
    const margin = g.homeScore - g.awayScore;
    const ph = this.perf.get(g.home) ?? 0;
    const pa = this.perf.get(g.away) ?? 0;
    const e = clip(margin, -this.p.cap, this.p.cap) - (ph - pa + h * this.p.hfa);
    this.perf.set(g.home, ph + (this.p.kPerf * e) / 2);
    this.perf.set(g.away, pa - (this.p.kPerf * e) / 2);
    if (g.line !== null) {
      const mh = this.mkt.get(g.home) ?? 0;
      const ma = this.mkt.get(g.away) ?? 0;
      const em = g.line - (mh - ma + h * this.p.hfaMkt);
      this.mkt.set(g.home, mh + (this.p.kMkt * em) / 2);
      this.mkt.set(g.away, ma - (this.p.kMkt * em) / 2);
      this.lastCover.set(g.home, margin - g.line);
      this.lastCover.set(g.away, g.line - margin);
    }
    if (g.homeQb) this.lastQb.set(g.home, g.homeQb);
    if (g.awayQb) this.lastQb.set(g.away, g.awayQb);
  }
}

/** Every game with a line, its features as of kickoff, in date order. */
export function rateAll(games: SpreadGame[], p: RatingParams): Rated[] {
  const r = new Ratings(p);
  const out: Rated[] = [];
  const sorted = [...games].sort((a, b) => a.gameday.localeCompare(b.gameday) || a.id.localeCompare(b.id));
  // A whole day's features before any of that day's results, so an early kickoff never informs a later one.
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j < sorted.length && sorted[j].gameday === sorted[i].gameday) j++;
    const day = sorted.slice(i, j);
    for (const g of day) if (g.line !== null && g.homeScore !== null) out.push({ game: g, x: r.features(g, g.line) });
    for (const g of day) r.add(g);
    i = j;
  }
  return out;
}

/** Predicted residual (home margin minus the line). */
export const residual = (x: Features, p: Pick<SpreadParams, "w" | "b">) => p.b + FEATURES.reduce((a, f) => a + p.w[f] * x[f], 0);

/**
 * Ridge regression of the residual on the features (standardized inside,
 * returned on the raw scale). `lambda` is in units of games.
 */
export function fitRidge(rows: { x: Features; y: number }[], lambda: number): { w: Features; b: number } {
  const k = FEATURES.length;
  const n = rows.length;
  const mu = FEATURES.map((f) => rows.reduce((a, r) => a + r.x[f], 0) / n);
  const sd = FEATURES.map((f, j) => Math.sqrt(rows.reduce((a, r) => a + (r.x[f] - mu[j]) ** 2, 0) / n) || 1);
  const ym = rows.reduce((a, r) => a + r.y, 0) / n;
  const A = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => (i === j ? lambda : 0)));
  const c = new Array(k).fill(0);
  for (const r of rows) {
    const z = FEATURES.map((f, j) => (r.x[f] - mu[j]) / sd[j]);
    for (let i = 0; i < k; i++) {
      c[i] += z[i] * (r.y - ym);
      for (let j = 0; j < k; j++) A[i][j] += z[i] * z[j];
    }
  }
  const beta = solve(A, c);
  const w = Object.fromEntries(FEATURES.map((f, j) => [f, beta[j] / sd[j]])) as Features;
  const b = ym - FEATURES.reduce((a, f, j) => a + w[f] * mu[j], 0);
  return { w, b };
}

/** Gaussian elimination with partial pivoting (small systems). */
export function solve(A: number[][], c: number[]): number[] {
  const n = c.length;
  const M = A.map((row, i) => [...row, c[i]]);
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r;
    [M[i], M[p]] = [M[p], M[i]];
    for (let r = i + 1; r < n; r++) {
      const f = M[r][i] / M[i][i];
      for (let j = i; j <= n; j++) M[r][j] -= f * M[i][j];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n];
    for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
    x[i] = s / M[i][i];
  }
  return x;
}
