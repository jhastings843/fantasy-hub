// Our college basketball model (Jack, 2026-11-02: totals, spreads, straight
// up, and later brackets). Two sources, blended:
//
// 1. Ours: an online offense/defense points rating built from ESPN's
//    Division I finals (no lines in it). Each team has an offense (points
//    over the league's average) and a defense (points held under it). A
//    game's miss moves both sides' numbers by a learning rate that starts
//    high and settles as a team plays games (college teams change a lot
//    between seasons, and early games say more than late ones), with the
//    miss capped so a 50-point rout doesn't count as 50. Leak-free: a game
//    reads only games before its date. A share of each rating is carried
//    into the next season.
// 2. T-Rank: Bart Torvik's adjusted efficiencies (points per 100 trips,
//    opponent-adjusted) and tempo, turned into a score the KenPom way:
//    trips = tempoA * tempoB / league tempo, points = offA * defB / league
//    efficiency * trips / 100, with our fitted home edge.
//
// Projected home margin = wOurs * ours + wTrank * T-Rank (weights fit by
// scripts/fit-cbb.mts on 2025-26, which the ratings never saw), the same for
// the total. Win chance: normal on the margin with sigma fit on real misses.
// Pure.

export interface CbbFinal {
  /** ESPN event id. */
  id: string;
  /** Season start year: 2025 is 2025-26. */
  season: number;
  /** Tip, ISO. */
  tip: string;
  /** ESPN team ids. */
  home: string;
  away: string;
  homeScore: number;
  awayScore: number;
  neutral: boolean;
  conf: boolean;
  /** NCAA tournament, NIT and other postseason games. */
  post: boolean;
  /** DraftKings (or the best pregame book) at open and close, home spread and total. */
  line?: { open: { spread: number | null; total: number | null }; close: { spread: number | null; total: number | null }; provider?: string };
}

export interface RatingParams {
  /** Home edge in points (margin), and in total points (usually near zero). */
  hfa: number;
  hfaTotal: number;
  /** Learning rate at a team's first game, and where it settles; games for it to halve the gap. */
  k0: number;
  kMin: number;
  halfGames: number;
  /** Points miss cap per side. */
  cap: number;
  /** Share of offense and defense carried into a new season. */
  carry: number;
  /** League points per team per game to start from. */
  avg0: number;
}

export interface BlendParams {
  /** Weights on ours and T-Rank, margin and total; and a total bias. */
  margin: { ours: number; trank: number };
  total: { ours: number; trank: number; b: number };
}

export interface CbbParams {
  rating: RatingParams;
  blend: BlendParams;
  /** T-Rank side: home edge in points and league tempo / efficiency fallbacks. */
  trank: { hfa: number };
  /** Standard deviation of real margins around ours, and of totals. */
  sigma: number;
  sigmaTotal: number;
  /** A spread lean counts as strong at this many points off the market (top 30% on test). */
  strong: number;
  strongTotal: number;
}

export interface Projection {
  /** Expected home margin (positive: home wins by that much). */
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

/** Projected score from a margin and a total, plus the win chance at this sigma. */
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

/** Our points ratings, grown a game at a time. */
export class CbbRatings {
  off = new Map<string, number>();
  def = new Map<string, number>();
  games = new Map<string, number>();
  avg: number;
  season = 0;

  constructor(readonly p: RatingParams) {
    this.avg = p.avg0;
  }

  newSeason(season: number) {
    if (season === this.season) return;
    if (this.season) {
      for (const m of [this.off, this.def]) for (const [t, v] of m) m.set(t, v * this.p.carry);
      this.games.clear();
    }
    this.season = season;
  }

  /** The learning rate for a team that has played n games this season. */
  k(n: number) {
    return this.p.kMin + (this.p.k0 - this.p.kMin) * Math.pow(0.5, n / Math.max(1, this.p.halfGames));
  }

  expect(home: string, away: string, neutral: boolean): { home: number; away: number } {
    const h = neutral ? 0 : this.p.hfa / 2;
    const t = neutral ? 0 : this.p.hfaTotal / 2;
    return {
      home: this.avg + (this.off.get(home) ?? 0) - (this.def.get(away) ?? 0) + h + t,
      away: this.avg + (this.off.get(away) ?? 0) - (this.def.get(home) ?? 0) - h + t,
    };
  }

  /** Home margin and total, ours. */
  project(home: string, away: string, neutral: boolean) {
    const e = this.expect(home, away, neutral);
    return { margin: e.home - e.away, total: e.home + e.away };
  }

  add(g: Pick<CbbFinal, "season" | "home" | "away" | "homeScore" | "awayScore" | "neutral">) {
    this.newSeason(g.season);
    const e = this.expect(g.home, g.away, g.neutral);
    const eh = clip(g.homeScore - e.home, -this.p.cap, this.p.cap);
    const ea = clip(g.awayScore - e.away, -this.p.cap, this.p.cap);
    const kh = this.k(this.games.get(g.home) ?? 0) / 2;
    const ka = this.k(this.games.get(g.away) ?? 0) / 2;
    // Each side's number moves at its own rate: a team's own games-played sets how sure we are of it.
    this.off.set(g.home, (this.off.get(g.home) ?? 0) + kh * eh);
    this.def.set(g.away, (this.def.get(g.away) ?? 0) - ka * eh);
    this.off.set(g.away, (this.off.get(g.away) ?? 0) + ka * ea);
    this.def.set(g.home, (this.def.get(g.home) ?? 0) - kh * ea);
    this.games.set(g.home, (this.games.get(g.home) ?? 0) + 1);
    this.games.set(g.away, (this.games.get(g.away) ?? 0) + 1);
    this.avg += 0.002 * ((g.homeScore + g.awayScore) / 2 - this.avg);
  }

  /** Feed finals in date order, a whole day before the next. */
  static from(p: RatingParams, finals: Pick<CbbFinal, "season" | "tip" | "id" | "home" | "away" | "homeScore" | "awayScore" | "neutral">[]): CbbRatings {
    const r = new CbbRatings(p);
    for (const g of [...finals].sort((a, b) => a.tip.localeCompare(b.tip) || a.id.localeCompare(b.id))) r.add(g);
    return r;
  }
}

/** One team's T-Rank numbers: adjusted offense and defense per 100 trips, adjusted tempo. */
export interface TrankTeam {
  name: string;
  conf: string;
  adjOE: number;
  adjDE: number;
  adjT: number;
  /** T-Rank's chance to beat an average team on a neutral floor. */
  barthag: number;
  rank: number;
  record: string;
}

/** League average efficiency and tempo, from the teams themselves. */
export function trankLeague(teams: TrankTeam[]) {
  const n = teams.length || 1;
  return {
    eff: teams.reduce((a, t) => a + (t.adjOE + t.adjDE) / 2, 0) / n,
    tempo: teams.reduce((a, t) => a + t.adjT, 0) / n,
  };
}

/** T-Rank's home margin and total for a game, the KenPom way, with a home edge in points. */
export function trankProject(h: TrankTeam, a: TrankTeam, lg: { eff: number; tempo: number }, neutral: boolean, hfa: number) {
  const trips = (h.adjT * a.adjT) / lg.tempo;
  const ph = ((h.adjOE * a.adjDE) / lg.eff) * (trips / 100);
  const pa = ((a.adjOE * h.adjDE) / lg.eff) * (trips / 100);
  const edge = neutral ? 0 : hfa;
  return { margin: ph - pa + edge, total: ph + pa, trips };
}

/** The blend: ours and T-Rank's margins and totals into one projection. T-Rank missing falls back to ours alone. */
export function blend(ours: { margin: number; total: number }, trank: { margin: number; total: number } | null, p: CbbParams): Projection {
  if (!trank) return projectedScore(ours.margin, ours.total + p.blend.total.b, p.sigma);
  const wm = p.blend.margin;
  const wt = p.blend.total;
  const m = (wm.ours * ours.margin + wm.trank * trank.margin) / (wm.ours + wm.trank || 1);
  const t = (wt.ours * ours.total + wt.trank * trank.total) / (wt.ours + wt.trank || 1) + wt.b;
  return projectedScore(m, t, p.sigma);
}

/** Chance the over hits at a total, from our total and its sigma. */
export const overChance = (ours: number, line: number, sigmaTotal: number) => r3(1 - phi((line - ours) / sigmaTotal));
/** Chance home covers a home spread, from our margin. */
export const coverChance = (margin: number, spread: number, sigma: number) => r3(phi((margin + spread) / sigma));
