// Our NBA player prop model, v1: points, rebounds, assists, threes.
//
// 1. Minutes first: a recency-weighted average of this season's minutes,
//    shrunk toward last season's average (or the league's starter/bench
//    average for a player with no history). Starters lose minutes as the
//    spread grows (blowout risk). An absent player's minutes go to whoever
//    is left: to everyone in proportion, or to his own position group first
//    ("share", "sharePos"); or each team's available players are scaled to
//    240 ("scale"); or nothing ("none"). The fit picks one.
// 2. Per-minute rates, empirical Bayes: (this season's total + k x prior rate)
//    / (this season's minutes + k), the prior being last season's rate shrunk
//    toward the position's league rate.
// 3. Pace: the game's expected possessions (both teams' shrunk pace) over
//    the player's own team's pace. Applied once, to every stat.
// 4. Distribution: points normal with variance phi x mean; rebounds, assists
//    and threes negative binomial (variance mean + mean^2 / r). A half-point
//    line L is over when X >= floor(L) + 1.
//
// Every constant in NbaParams is fit by scripts/fit-nba-props.mts, walk
// forward, on information before each game only; the fitted values and their
// test results are in docs/superpowers/specs/2026-10-21-own-prop-models.md.
// Pure: no fetches, no Redis.

export const NBA_STATS = ["pts", "reb", "ast", "threes"] as const;
export type NbaStat = (typeof NBA_STATS)[number];
export type Pos = "G" | "F" | "C";

export const posOf = (p: string): Pos => (/C/.test(p) ? "C" : /F/.test(p) ? "F" : "G");

/** One game a player played: minutes, the four stats, and whether he started. */
export interface Played {
  date: string;
  team: string;
  min: number;
  starter: boolean;
  pts: number;
  reb: number;
  ast: number;
  threes: number;
}

/** A player's whole prior season, as totals. */
export interface PriorSeason {
  games: number;
  min: number;
  pts: number;
  reb: number;
  ast: number;
  threes: number;
  pos: Pos;
}

/** League-wide baselines from the prior season (data, not tuning): average minutes by role, per-minute rate by position, pace. */
export interface LeagueBase {
  minStarter: number;
  minBench: number;
  rate: { [p in Pos]: { [s in NbaStat]: number } };
  pace: number;
  /** Players who appear for a team in an average game. */
  rotationSize: number;
}

export interface NbaParams {
  /** Half-life of the minutes average, in games. */
  halfLife: number;
  /** Pseudo-games pulling this season's minutes toward the prior. */
  kMin: number;
  /** Pseudo-minutes pulling each stat's per-minute rate toward the prior. */
  k: { [s in NbaStat]: number };
  /** Pseudo-minutes pulling last season's rate toward the position rate. */
  kPrior: number;
  /** Pseudo-games pulling a team's pace toward last season's. */
  kPace: number;
  /** Every projected minute times this (fit to take out the average's lean: a player's average counts only the nights he played). */
  minScale: number;
  /** Share of a starter's minutes lost per point of spread. */
  blowout: number;
  /** How an absent player's minutes are handed out (see the header). */
  normalize: "none" | "scale" | "share" | "sharePos";
  /** Apply the pace factor. */
  pace: boolean;
  /** Points: variance = phiPts x mean. */
  phiPts: number;
  /** Negative binomial size per count stat. */
  nb: { reb: number; ast: number; threes: number };
  /**
   * Calibration slope on the log-odds of over vs under (1 = none, below 1
   * pulls toward 50/50). The distributions alone run overconfident at the
   * ends because they don't carry the projection's own error.
   */
  calib: number;
}

export interface PlayerInput {
  id: string;
  team: string;
  pos: Pos;
  /** This season's games before this one, oldest first. */
  games: Played[];
  prior?: PriorSeason;
  /** Starting tonight, when known; else his latest game's role. */
  starter?: boolean;
}

export interface TeamInput {
  team: string;
  /** This season's possessions per game before this one. */
  poss: number[];
  /** Last season's possessions per game, when the team has one. */
  priorPace?: number;
}

export interface Projection {
  id: string;
  team: string;
  min: number;
  mean: { [s in NbaStat]: number };
}

export function projectMinutes(pl: PlayerInput, base: LeagueBase, p: NbaParams): number {
  const g = pl.games;
  const starter = pl.starter ?? g.at(-1)?.starter ?? false;
  const priorMin = pl.prior && pl.prior.games > 0 ? pl.prior.min / pl.prior.games : starter ? base.minStarter : base.minBench;
  if (!g.length) return priorMin * p.minScale;
  let sw = 0;
  let sm = 0;
  for (let i = 0; i < g.length; i++) {
    const w = Math.pow(0.5, (g.length - 1 - i) / p.halfLife);
    sw += w;
    sm += w * g[i].min;
  }
  const n = g.length;
  return ((n * (sm / sw) + p.kMin * priorMin) / (n + p.kMin)) * p.minScale;
}

export function projectRates(pl: PlayerInput, base: LeagueBase, p: NbaParams): { [s in NbaStat]: number } {
  const n = pl.games.reduce((a, x) => a + x.min, 0);
  const out = {} as { [s in NbaStat]: number };
  for (const s of NBA_STATS) {
    const posRate = base.rate[pl.prior?.pos ?? pl.pos][s];
    const prior = pl.prior && pl.prior.min > 0 ? (pl.prior[s] + p.kPrior * posRate) / (pl.prior.min + p.kPrior) : posRate;
    const cur = pl.games.reduce((a, x) => a + x[s], 0);
    out[s] = (cur + p.k[s] * prior) / (n + p.k[s]);
  }
  return out;
}

export function teamPace(t: TeamInput, base: LeagueBase, p: NbaParams): number {
  const prior = t.priorPace ?? base.pace;
  return (t.poss.reduce((a, x) => a + x, 0) + p.kPace * prior) / (t.poss.length + p.kPace);
}

const MAX_MIN = 44;

/** Scale a team's minutes to 240, no one above MAX_MIN (a few passes, as capped minutes are handed back). */
export function toTeamMinutes(mins: number[]): number[] {
  let out = [...mins];
  for (let pass = 0; pass < 5; pass++) {
    const free = out.map((m) => m < MAX_MIN);
    const fixed = out.reduce((a, m, i) => a + (free[i] ? 0 : m), 0);
    const flex = out.reduce((a, m, i) => a + (free[i] ? m : 0), 0);
    if (flex <= 0) break;
    const f = (240 - fixed) / flex;
    out = out.map((m, i) => (free[i] ? Math.min(MAX_MIN, m * f) : m));
    if (Math.abs(out.reduce((a, m) => a + m, 0) - 240) < 0.01) break;
  }
  return out;
}

/**
 * Hand absent players' minutes to the available ones, in proportion to their
 * own minutes: within the absent player's position group first when `byPos`,
 * else across the team. No one goes above MAX_MIN; the team stays at or under 240.
 */
export function shareMinutes(mins: number[], pos: Pos[], absent: { min: number; pos: Pos }[], byPos: boolean): number[] {
  const out = [...mins];
  let room = Math.max(0, 240 - out.reduce((a, m) => a + m, 0));
  for (const a of absent) {
    let give = Math.min(a.min, room);
    const groups = byPos ? [out.map((_, i) => pos[i] === a.pos), out.map(() => true)] : [out.map(() => true)];
    for (const inGroup of groups) {
      if (give <= 0.01) break;
      const w = out.map((m, i) => (inGroup[i] && m < MAX_MIN ? m : 0));
      const sw = w.reduce((x, y) => x + y, 0);
      if (sw <= 0) continue;
      let given = 0;
      out.forEach((m, i) => {
        const add = Math.min(MAX_MIN - m, (give * w[i]) / sw);
        out[i] = m + add;
        given += add;
      });
      give -= given;
      room -= given;
    }
  }
  return out;
}

/**
 * Every available player's projection for one game. `homeSpread` is the home
 * side's number (negative when home is favored); its size drives the blowout
 * cut. `absent` are rotation players out tonight, whose minutes are handed out.
 */
export function projectGame(
  players: PlayerInput[],
  teams: { [team: string]: TeamInput },
  homeSpread: number | null,
  base: LeagueBase,
  p: NbaParams,
  absent: PlayerInput[] = [],
): Projection[] {
  const spread = Math.abs(homeSpread ?? 0);
  const names = Object.keys(teams);
  const pace = Object.fromEntries(names.map((t) => [t, teamPace(teams[t], base, p)]));
  const game = names.length === 2 ? (pace[names[0]] + pace[names[1]]) / 2 : base.pace;
  const out: Projection[] = [];
  for (const team of names) {
    const mine = players.filter((x) => x.team === team);
    let mins = mine.map((pl) => {
      const m = projectMinutes(pl, base, p);
      const starter = pl.starter ?? pl.games.at(-1)?.starter ?? false;
      return starter ? m * Math.max(0, 1 - p.blowout * spread) : m;
    });
    if (p.normalize === "scale" && mine.length >= 5) mins = toTeamMinutes(mins);
    if (p.normalize === "share" || p.normalize === "sharePos") {
      const gone = absent.filter((x) => x.team === team).map((x) => ({ min: projectMinutes(x, base, p), pos: x.pos }));
      if (gone.length) mins = shareMinutes(mins, mine.map((x) => x.pos), gone, p.normalize === "sharePos");
    }
    const pf = p.pace && pace[team] > 0 ? game / pace[team] : 1;
    mine.forEach((pl, i) => {
      const r = projectRates(pl, base, p);
      const mean = {} as { [s in NbaStat]: number };
      for (const s of NBA_STATS) mean[s] = mins[i] * r[s] * pf;
      out.push({ id: pl.id, team, min: mins[i], mean });
    });
  }
  return out;
}

// Distributions.

/** Lanczos log-gamma (g = 7), plenty for these sizes. */
export function lgamma(x: number): number {
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
  x -= 1;
  let a = c[0];
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Negative binomial P(X = k) with mean mu and size r. */
export function nbPmf(k: number, mu: number, r: number): number {
  if (mu <= 0) return k === 0 ? 1 : 0;
  const q = r / (r + mu);
  return Math.exp(lgamma(k + r) - lgamma(r) - lgamma(k + 1) + r * Math.log(q) + k * Math.log(1 - q));
}

/** Standard normal CDF (Abramowitz-Stegun 7.1.26 on erf, error under 1.5e-7). */
export function phi(z: number): number {
  const t = 1 / (1 + 0.3275911 * (Math.abs(z) / Math.SQRT2));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

/** P(X <= k) for the stat's distribution. */
export function cdf(stat: NbaStat, k: number, mu: number, p: NbaParams): number {
  if (k < 0) return 0;
  if (stat === "pts") {
    const sd = Math.sqrt(Math.max(p.phiPts * mu, 1e-6));
    return phi((k + 0.5 - mu) / sd);
  }
  const r = p.nb[stat];
  let s = 0;
  for (let i = 0; i <= k; i++) s += nbPmf(i, mu, r);
  return Math.min(1, s);
}

/** P(X = k), for the fits' likelihood. */
export function pmf(stat: NbaStat, k: number, mu: number, p: NbaParams): number {
  return stat === "pts" ? cdf(stat, k, mu, p) - cdf(stat, k - 1, mu, p) : nbPmf(k, mu, p.nb[stat]);
}

/** Log-odds scaled by a, back to a probability. */
export function calibrate(q: number, a: number): number {
  if (a === 1 || q <= 0 || q >= 1) return q;
  return 1 / (1 + Math.exp(-a * Math.log(q / (1 - q))));
}

/** Over, under and push chances at a line, calibrated. A half-point line never pushes. */
export function overUnder(stat: NbaStat, mu: number, line: number, p: NbaParams): { over: number; under: number; push: number } {
  const whole = Number.isInteger(line);
  const below = cdf(stat, whole ? line - 1 : Math.floor(line), mu, p);
  const push = whole ? cdf(stat, line, mu, p) - below : 0;
  const over = Math.max(0, 1 - below - push);
  const q = over + below > 0 ? calibrate(over / (over + below), p.calib) : 0.5;
  return { over: q * (1 - push), under: (1 - q) * (1 - push), push };
}
