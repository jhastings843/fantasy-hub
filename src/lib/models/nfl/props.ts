// Our NFL player prop model, v1: passing, rushing and receiving yards, and receptions.
//
// 1. Team volume: pass attempts and carries per game, shrunk toward last
//    season's (kTeam pseudo-games), moved by the expected margin from the
//    market's spread (a leading team runs, a trailing one throws). Targets
//    follow attempts at the league's targets-per-attempt.
// 2. Player shares of targets, carries and attempts, empirical Bayes:
//    (his count + k x prior share) / (team count in his games + k), the prior
//    being last season's share, else his position's average share. Shares of
//    rotation players who are out tonight can be handed to the rest ("share").
// 3. Efficiency (yards per target, catch rate, yards per carry, yards per
//    attempt), shrunk hard toward last season, itself shrunk toward the position.
// 4. Distribution: receptions negative binomial; yardage gamma with variance
//    phi x mean^pow (skewed, never negative; pow 1 to 2 is fit per stat). Yardage is priced from the CDF, so
//    the median matters, not the mean. (The plan's Monte Carlo gives the
//    same kind of skewed CDF; the closed form is deterministic and fast.)
//
// Every constant in NflParams is fit by scripts/fit-nfl-props.mts, walk forward.
// Pure: no fetches, no Redis.

import { calibrate, lgamma, nbPmf } from "../nba/props";

export const NFL_STATS = ["pass_yds", "rush_yds", "rec_yds", "rec"] as const;
export type NflStat = (typeof NFL_STATS)[number];
export type NflPos = "QB" | "RB" | "WR" | "TE";

export interface PlayerGame {
  week: number;
  team: string;
  att: number;
  passYds: number;
  car: number;
  rushYds: number;
  tgt: number;
  rec: number;
  recYds: number;
  /** The team's attempts, carries and targets in that game. */
  teamAtt: number;
  teamCar: number;
  teamTgt: number;
}

/** A player's prior season, as totals (team columns: the team's totals in his games). */
export type PriorPlayer = Omit<PlayerGame, "week" | "team"> & { games: number; pos: NflPos };

export interface NflBase {
  /** League per-team-game volume and targets per attempt. */
  att: number;
  car: number;
  tgtPerAtt: number;
  /** Per position: average share (in games he appeared) and efficiency. */
  pos: { [p in NflPos]: { tgtShare: number; carShare: number; attShare: number; ypt: number; cr: number; ypc: number; ypa: number } };
}

export interface NflParams {
  kTeam: number;
  /** Change in attempts and carries per point of expected margin. */
  margin: { att: number; car: number };
  kTgt: number;
  kCar: number;
  kAtt: number;
  kYpt: number;
  kCr: number;
  kYpc: number;
  kYpa: number;
  /** Hand an absent rotation player's share to the rest. */
  share: boolean;
  /** Receptions: NB size. Yardage: gamma variance = phi x mean^pow. */
  disp: { rec: number; rec_yds: number; rush_yds: number; pass_yds: number };
  pow: { rec_yds: number; rush_yds: number; pass_yds: number };
  calib: number;
}

export interface NflPlayerInput {
  id: string;
  team: string;
  pos: NflPos;
  games: PlayerGame[];
  prior?: PriorPlayer;
}

export interface NflTeamInput {
  team: string;
  /** This season's games: attempts and carries. */
  games: { att: number; car: number }[];
  prior?: { att: number; car: number };
}

export interface NflProjection {
  id: string;
  team: string;
  tgt: number;
  car: number;
  att: number;
  mean: { [s in NflStat]: number };
}

const sum = (xs: PlayerGame[], f: (g: PlayerGame) => number) => xs.reduce((a, g) => a + f(g), 0);

export function teamVolume(t: NflTeamInput, margin: number, base: NflBase, p: NflParams): { att: number; car: number; tgt: number } {
  const n = t.games.length;
  const pa = t.prior?.att ?? base.att;
  const pc = t.prior?.car ?? base.car;
  const att = (t.games.reduce((a, g) => a + g.att, 0) + p.kTeam * pa) / (n + p.kTeam) + p.margin.att * margin;
  const car = (t.games.reduce((a, g) => a + g.car, 0) + p.kTeam * pc) / (n + p.kTeam) + p.margin.car * margin;
  return { att: Math.max(att, 10), car: Math.max(car, 8), tgt: Math.max(att, 10) * base.tgtPerAtt };
}

/** Shrunk shares and efficiencies for one player. */
export function playerRates(pl: NflPlayerInput, base: NflBase, p: NflParams) {
  const b = base.pos[pl.prior?.pos ?? pl.pos];
  const pr = pl.prior;
  const share = (k: number, mine: number, team: number, priorMine: number | undefined, priorTeam: number | undefined, posShare: number) => {
    const prior = pr && priorTeam ? (priorMine! + k * posShare) / (priorTeam + k) : posShare;
    return (mine + k * prior) / (team + k);
  };
  const eff = (k: number, num: number, den: number, pNum: number | undefined, pDen: number | undefined, pos: number) => {
    const prior = pr && pDen !== undefined ? (pNum! + k * pos) / (pDen + k) : pos;
    return (num + k * prior) / (den + k);
  };
  const g = pl.games;
  return {
    tgtShare: share(p.kTgt, sum(g, (x) => x.tgt), sum(g, (x) => x.teamTgt), pr?.tgt, pr?.teamTgt, b.tgtShare),
    carShare: share(p.kCar, sum(g, (x) => x.car), sum(g, (x) => x.teamCar), pr?.car, pr?.teamCar, b.carShare),
    attShare: share(p.kAtt, sum(g, (x) => x.att), sum(g, (x) => x.teamAtt), pr?.att, pr?.teamAtt, b.attShare),
    ypt: eff(p.kYpt, sum(g, (x) => x.recYds), sum(g, (x) => x.tgt), pr?.recYds, pr?.tgt, b.ypt),
    cr: eff(p.kCr, sum(g, (x) => x.rec), sum(g, (x) => x.tgt), pr?.rec, pr?.tgt, b.cr),
    ypc: eff(p.kYpc, sum(g, (x) => x.rushYds), sum(g, (x) => x.car), pr?.rushYds, pr?.car, b.ypc),
    ypa: eff(p.kYpa, sum(g, (x) => x.passYds), sum(g, (x) => x.att), pr?.passYds, pr?.att, b.ypa),
  };
}

/**
 * Every available player's projection for one game. `homeMargin` is the
 * expected home margin (positive: home favored). `absent` are rotation
 * players out tonight; with `share` on, their shares go to the rest of
 * their team in proportion.
 */
export function projectNflGame(
  players: NflPlayerInput[],
  teams: { [team: string]: NflTeamInput },
  home: string,
  homeMargin: number | null,
  base: NflBase,
  p: NflParams,
  absent: NflPlayerInput[] = [],
): NflProjection[] {
  const out: NflProjection[] = [];
  for (const team of Object.keys(teams)) {
    const margin = (homeMargin ?? 0) * (team === home ? 1 : -1);
    const v = teamVolume(teams[team], margin, base, p);
    const mine = players.filter((x) => x.team === team);
    const rates = mine.map((x) => playerRates(x, base, p));
    if (p.share) {
      const gone = absent.filter((x) => x.team === team).map((x) => playerRates(x, base, p));
      for (const k of ["tgtShare", "carShare", "attShare"] as const) {
        const lost = gone.reduce((a, r) => a + r[k], 0);
        const have = rates.reduce((a, r) => a + r[k], 0);
        if (lost > 0 && have > 0) rates.forEach((r) => (r[k] *= 1 + lost / have));
      }
    }
    mine.forEach((pl, i) => {
      const r = rates[i];
      const tgt = r.tgtShare * v.tgt;
      const car = r.carShare * v.car;
      const att = pl.pos === "QB" ? r.attShare * v.att : 0;
      out.push({ id: pl.id, team, tgt, car, att, mean: { rec: tgt * r.cr, rec_yds: tgt * r.ypt, rush_yds: car * r.ypc, pass_yds: att * r.ypa } });
    });
  }
  return out;
}

// Distributions.

/** Regularized lower incomplete gamma P(a, x) (Numerical Recipes: series below a + 1, continued fraction above). */
export function gammaP(a: number, x: number): number {
  if (x <= 0) return 0;
  if (x < a + 1) {
    let ap = a;
    let del = 1 / a;
    let s = del;
    for (let i = 0; i < 500; i++) {
      ap++;
      del *= x / ap;
      s += del;
      if (Math.abs(del) < Math.abs(s) * 1e-12) break;
    }
    return s * Math.exp(-x + a * Math.log(x) - lgamma(a));
  }
  let b = x + 1 - a;
  let c = 1e300;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c;
    if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-12) break;
  }
  return 1 - Math.exp(-x + a * Math.log(x) - lgamma(a)) * h;
}

/** P(X <= x). Receptions count; yardage continuous (gamma, shape mean/phi). */
export function nflCdf(stat: NflStat, x: number, mu: number, p: NflParams): number {
  if (stat === "rec") {
    if (x < 0) return 0;
    let s = 0;
    for (let i = 0; i <= Math.floor(x); i++) s += nbPmf(i, mu, p.disp.rec);
    return Math.min(1, s);
  }
  if (mu <= 0) return 1;
  // Gamma with mean mu and variance phi x mu^pow: shape mu^(2-pow)/phi, scale phi x mu^(pow-1).
  const phi = p.disp[stat];
  const pow = p.pow[stat];
  const scale = phi * Math.pow(mu, pow - 1);
  return gammaP(mu / scale, Math.max(x, 0) / scale);
}

/** Density (yardage) or mass (receptions), for the fits' likelihood. Yardage is read on 1-yard bins. */
export function nflLik(stat: NflStat, y: number, mu: number, p: NflParams): number {
  if (stat === "rec") return nbPmf(y, mu, p.disp.rec);
  return nflCdf(stat, y + 0.5, mu, p) - nflCdf(stat, y - 0.5, mu, p);
}

/** The median, for display (yardage lines are priced from the CDF). */
export function nflMedian(stat: NflStat, mu: number, p: NflParams): number {
  let lo = 0;
  let hi = Math.max(mu * 4, 10);
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (nflCdf(stat, mid, mu, p) < 0.5) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function nflOverUnder(stat: NflStat, mu: number, line: number, p: NflParams): { over: number; under: number; push: number } {
  const whole = Number.isInteger(line);
  let below: number;
  let push = 0;
  if (stat === "rec") {
    below = nflCdf(stat, whole ? line - 1 : Math.floor(line), mu, p);
    push = whole ? nflCdf(stat, line, mu, p) - below : 0;
  } else {
    // Yards are whole numbers: a whole line pushes on exactly that many.
    below = nflCdf(stat, whole ? line - 0.5 : line, mu, p);
    push = whole ? nflCdf(stat, line + 0.5, mu, p) - below : 0;
  }
  const over = Math.max(0, 1 - below - push);
  const q = over + below > 0 ? calibrate(over / (over + below), p.calib) : 0.5;
  return { over: q * (1 - push), under: (1 - q) * (1 - push), push };
}
