// Our NBA game model, v1: spreads and totals. Like the NFL spread model
// (models/nfl/spread.ts) it starts from the market's number and predicts
// where that number misses, from a few things the market might misweigh:
//
// Spread (home margin terms, positive favors home; market margin = -spread):
// 1. gap: a results-only team rating (offense and defense per 100
//    possessions, pace, home court; no lines) against the market's margin.
// 2. avail: who is out. Our props model's projected team points with
//    tonight's players, minus the same with the full recent rotation, home
//    minus away. Negative when the home side is missing scorers.
// 3. move: the market's margin now minus its opening margin.
// 4. rest: home rest days minus away (clipped to +-3), and b2b: home on the
//    second night of a back-to-back minus away.
// 5. cover: each side's last cover margin, home minus away.
// Total: gapT (rating total minus the market total), availT (both sides'
// points change, summed), moveT (total now minus open), b2bT (sides on a
// back-to-back, 0-2).
//
// Ratings are online and leak-free: a game's features use only games before
// its Eastern date. Weights are ridge regression refit walk forward
// (scripts/fit-nba-game.mts). Pure.

export interface GameRow {
  id: string;
  /** Tip, ISO. */
  date: string;
  home: string;
  away: string;
  score: { [team: string]: number };
  poss: { [team: string]: number };
}

export interface GameRatingParams {
  /** League points per 100 possessions and possessions per team-game to start from. */
  ppp0: number;
  pace0: number;
  /** Home edge in points per 100 possessions (split across both sides' expectations). */
  hfa: number;
  /** Learning rates: offense/defense ratings, pace. */
  k: number;
  kPace: number;
  /** Share of a rating carried into a new season. */
  carry: number;
}

export const SPREAD_FEATURES = ["gap", "avail", "move", "rest", "b2b", "cover"] as const;
export const TOTAL_FEATURES = ["gapT", "availT", "moveT", "b2bT"] as const;
export type SpreadFeature = (typeof SPREAD_FEATURES)[number];
export type TotalFeature = (typeof TOTAL_FEATURES)[number];
export type SpreadX = { [f in SpreadFeature]: number };
export type TotalX = { [f in TotalFeature]: number };

export interface GameParams {
  rating: GameRatingParams;
  spread: { w: SpreadX; b: number };
  total: { w: TotalX; b: number };
  /** A spread lean counts as strong at this predicted residual (70th percentile on train). */
  strongSpread: number;
}

const clip = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const DAY = 86_400_000;

/** The Eastern calendar date of a tip (EDT/EST by a fixed offset is close enough for a 7pm tip: use -5h). */
export const etDay = (iso: string) => new Date(Date.parse(iso) - 5 * 3_600_000).toISOString().slice(0, 10);

/** Team ratings, rest and last covers, grown a game at a time. */
export class GameRatings {
  off = new Map<string, number>();
  def = new Map<string, number>();
  pace = new Map<string, number>();
  last = new Map<string, string>();
  lastCover = new Map<string, number>();
  lg: number;
  lgPace: number;
  season = "";

  constructor(readonly p: GameRatingParams) {
    this.lg = p.ppp0;
    this.lgPace = p.pace0;
  }

  /** Call with the game's season label before features or add; carries ratings over at a change. */
  newSeason(season: string) {
    if (season === this.season) return;
    for (const m of [this.off, this.def, this.pace]) for (const [t, v] of m) m.set(t, v * this.p.carry);
    this.lastCover.clear();
    this.last.clear();
    this.season = season;
  }

  /** Expected possessions per team and points per 100 for each side. */
  expect(home: string, away: string) {
    const poss = this.lgPace + (this.pace.get(home) ?? 0) + (this.pace.get(away) ?? 0);
    const ph = this.lg + (this.off.get(home) ?? 0) - (this.def.get(away) ?? 0) + this.p.hfa / 2;
    const pa = this.lg + (this.off.get(away) ?? 0) - (this.def.get(home) ?? 0) - this.p.hfa / 2;
    return { poss, ph, pa, margin: (poss * (ph - pa)) / 100, total: (poss * (ph + pa)) / 100 };
  }

  /** Days since the team's last game (Eastern dates), 3 when unknown; and whether tonight is the second of a back-to-back. */
  rest(team: string, day: string): { days: number; b2b: number } {
    const l = this.last.get(team);
    if (!l) return { days: 3, b2b: 0 };
    const d = Math.round((Date.parse(day) - Date.parse(l)) / DAY);
    return { days: d, b2b: d === 1 ? 1 : 0 };
  }

  /**
   * Features for a game about to tip. `spread`/`total` are the market's now,
   * `open` its first numbers (null when unknown: move is then 0). `avail` is
   * each side's projected points change from absences (props model).
   */
  features(
    g: Pick<GameRow, "date" | "home" | "away">,
    spread: number,
    total: number,
    open: { spread: number | null; total: number | null },
    avail: { home: number; away: number },
  ): { spread: SpreadX; total: TotalX; rating: { margin: number; total: number } } {
    const e = this.expect(g.home, g.away);
    const day = etDay(g.date);
    const rh = this.rest(g.home, day);
    const ra = this.rest(g.away, day);
    const m = -spread;
    return {
      spread: {
        gap: e.margin - m,
        avail: avail.home - avail.away,
        move: open.spread === null ? 0 : m - -open.spread,
        rest: clip(rh.days, 0, 3) - clip(ra.days, 0, 3),
        b2b: rh.b2b - ra.b2b,
        cover: (this.lastCover.get(g.home) ?? 0) - (this.lastCover.get(g.away) ?? 0),
      },
      total: {
        gapT: e.total - total,
        availT: avail.home + avail.away,
        moveT: open.total === null ? 0 : total - open.total,
        b2bT: rh.b2b + ra.b2b,
      },
      rating: { margin: e.margin, total: e.total },
    };
  }

  /** Fold a final in. `spread` is the closing home spread when known (for last covers). */
  add(g: GameRow, spread: number | null = null) {
    const day = etDay(g.date);
    const sh = g.score[g.home];
    const sa = g.score[g.away];
    const nh = g.poss[g.home];
    const na = g.poss[g.away];
    if ([sh, sa, nh, na].every((v) => Number.isFinite(v) && v > 0)) {
      const e = this.expect(g.home, g.away);
      const poss = (nh + na) / 2;
      const eh = (100 * sh) / poss - e.ph;
      const ea = (100 * sa) / poss - e.pa;
      const k = this.p.k;
      this.off.set(g.home, (this.off.get(g.home) ?? 0) + k * eh);
      this.def.set(g.away, (this.def.get(g.away) ?? 0) - k * eh);
      this.off.set(g.away, (this.off.get(g.away) ?? 0) + k * ea);
      this.def.set(g.home, (this.def.get(g.home) ?? 0) - k * ea);
      const ep = poss - e.poss;
      this.pace.set(g.home, (this.pace.get(g.home) ?? 0) + (this.p.kPace * ep) / 2);
      this.pace.set(g.away, (this.pace.get(g.away) ?? 0) + (this.p.kPace * ep) / 2);
      // League levels drift slowly toward what's being played.
      this.lg += 0.01 * ((100 * (sh + sa)) / (2 * poss) - this.lg);
      this.lgPace += 0.01 * (poss - this.lgPace);
    }
    if (spread !== null && Number.isFinite(sh) && Number.isFinite(sa)) {
      const cover = sh - sa + spread; // home covers when > 0
      this.lastCover.set(g.home, cover);
      this.lastCover.set(g.away, -cover);
    }
    this.last.set(g.home, day);
    this.last.set(g.away, day);
  }
}

export const spreadResidual = (x: SpreadX, p: GameParams["spread"]) => p.b + SPREAD_FEATURES.reduce((a, f) => a + p.w[f] * x[f], 0);
export const totalResidual = (x: TotalX, p: GameParams["total"]) => p.b + TOTAL_FEATURES.reduce((a, f) => a + p.w[f] * x[f], 0);

/** Our home spread and total: the market's moved by the predicted residuals. */
export function ourNumbers(spread: number, total: number, x: { spread: SpreadX; total: TotalX }, p: GameParams) {
  return { spread: spread - spreadResidual(x.spread, p.spread), total: total + totalResidual(x.total, p.total) };
}
