// The March Madness bracket optimizer (Jack, 2026-11-02). Pure: no server
// imports, runs in the browser (or a worker) and in tests.
//
// 1. Exact odds. Each team's chance to win each round, by dynamic programming
//    over the 64-team bracket: P(A beats B) = phi((rA - rB) / sigma).
// 2. The public. When the field has no real pick shares (Yahoo's "Who Picked
//    Whom", ESPN's), we estimate them: the public over-picks favorites and
//    high seeds, so each game's public share is the model chance sharpened by
//    PUBLIC_GAMMA and blended with a seed prior, then chained through the
//    rounds the same way as the real odds. Always labeled an estimate.
// 3. Pool mode (Rick Gehman's RickRunGood method, done by simulation). Build
//    candidate brackets champion first, simulate the tournament T times and K
//    opponent brackets drawn from the public, and for each candidate and each
//    simulated tournament keep q = the share of opponents who outscore it.
//    P(win a pool of N) = mean over sims of (1 - q)^(N - 1), so a pool-size
//    change is instant: the q arrays are computed once per scoring system.
// 4. Chasing perfection. The single most likely bracket (DP over the tree for
//    the max joint probability) and its chance of being perfect, against pure
//    chalk by seed.

import type { BracketField, BracketTeam, Region } from "./bracket-types";
import { phi } from "./model";

/* ---------------------------------------------------------------- layout */

/** Seed order down one region's 16 lines: 1v16, 8v9, 5v12, 4v13, 6v11, 3v14, 7v10, 2v15. */
export const SEED_ORDER = [1, 16, 8, 9, 5, 12, 4, 13, 6, 11, 3, 14, 7, 10, 2, 15] as const;
export const ROUNDS = ["Round of 32", "Sweet 16", "Elite Eight", "Final Four", "Title game", "Champion"] as const;
/** Short labels for the round a pick wins: "won R64" is reaching the round of 32. */
export const ROUND_SHORT = ["R32", "S16", "E8", "F4", "Final", "Title"] as const;
/** Games per round and where each round starts in the 63-game list. */
export const GAMES = [32, 16, 8, 4, 2, 1] as const;
export const OFFSET = [0, 32, 48, 56, 60, 62] as const;
export const N_GAMES = 63;
/** Round of each game index 0..62. */
export const ROUND_OF: number[] = OFFSET.flatMap((o, r) => Array.from({ length: GAMES[r] }, () => r));

/**
 * A bracket: for each of the 63 games, the slot (0..63) of the team picked to
 * win it. Games run round by round; round r game g is fed by round r-1 games
 * 2g and 2g+1 and covers slots [g * 2^(r+1), (g + 1) * 2^(r+1)).
 */
export type Picks = Uint8Array;

/** The four regions in bracket order: the first semi's two regions, then the second's. */
export function regionOrder(field: BracketField): Region[] {
  return [field.semis[0][0], field.semis[0][1], field.semis[1][0], field.semis[1][1]];
}

/** The 64 teams in slot order (region by region, seeds in SEED_ORDER). Throws on a malformed field. */
export function slotTeams(field: BracketField): BracketTeam[] {
  const out: BracketTeam[] = [];
  for (const region of regionOrder(field)) {
    for (const seed of SEED_ORDER) {
      const t = field.teams.filter((x) => x.region === region && x.seed === seed);
      if (t.length !== 1) throw new Error(`Field needs exactly one ${seed} seed in the ${region}, found ${t.length}`);
      out.push(t[0]);
    }
  }
  return out;
}

/** The two slots (or picked winners) that meet in game k, given the picks so far. */
export function gameTeams(k: number, picks: ArrayLike<number>): [number, number] {
  const r = ROUND_OF[k];
  const g = k - OFFSET[r];
  if (r === 0) return [2 * g, 2 * g + 1];
  const c = OFFSET[r - 1] + 2 * g;
  return [picks[c], picks[c + 1]];
}

/** The 2^r-slot range a game's winner comes from (the half of the block each side fills). */
function halfRange(r: number, slot: number): [number, number] {
  const h = slot >> r;
  const o = h ^ 1;
  return [o << r, (o + 1) << r];
}

/* ---------------------------------------------------------------- odds */

/** 64 x 64 head-to-head win chances on a neutral floor. */
export function winMatrix(teams: BracketTeam[], sigma: number): Float64Array {
  const n = teams.length;
  const w = new Float64Array(n * n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) w[i * n + j] = i === j ? 0.5 : phi((teams[i].rating - teams[j].rating) / sigma);
  return w;
}

/**
 * Exact chance of each slot winning each round (index 0 = wins its first game,
 * 5 = champion), given any game rule as a 64 x 64 matrix. A team reaches a
 * round's game if it won the last one; its opponent is any team from the
 * other half of the block, weighted by that team's chance to be there.
 */
export function advancement(win: Float64Array, n = 64): number[][] {
  const adv: number[][] = [];
  let prev = new Array<number>(n).fill(1);
  for (let r = 0; r < 6; r++) {
    const cur = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) {
      if (!prev[i]) continue;
      const [lo, hi] = halfRange(r, i);
      let s = 0;
      for (let j = lo; j < hi; j++) s += prev[j] * win[i * n + j];
      cur[i] = prev[i] * s;
    }
    adv.push(cur);
    prev = cur;
  }
  return adv;
}

/* ---------------------------------------------------------------- the public */

/**
 * How the public picks, when no real shares are posted. Each game's public
 * share for A is pA^g / (pA^g + pB^g): with g > 1 favorites get more than
 * their true chance (a 70% favorite is picked about 80% of the time at 1.6).
 * Blended with a seed prior, since casual entries lean on the seed line
 * itself (a 5 over a 12 even when the 12 rates close).
 */
export const PUBLIC_GAMMA = 1.6;
/** Weight on the seed prior in each game's public share (the rest is the sharpened model chance). */
export const PUBLIC_SEED_WEIGHT = 0.3;
/** Seed prior: share for A = seedB^e / (seedA^e + seedB^e). At 1.3 a 1 over a 16 is about 97%, a 5 over a 12 about 76%. */
export const PUBLIC_SEED_EXP = 1.3;

/** The public's per-game share matrix (estimate). */
export function publicMatrix(teams: BracketTeam[], win: Float64Array): Float64Array {
  const n = teams.length;
  const s = new Float64Array(n * n);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const p = win[i * n + j];
      const a = Math.pow(p, PUBLIC_GAMMA);
      const b = Math.pow(1 - p, PUBLIC_GAMMA);
      const sharp = a + b > 0 ? a / (a + b) : 0.5;
      const si = Math.pow(teams[i].seed, PUBLIC_SEED_EXP);
      const sj = Math.pow(teams[j].seed, PUBLIC_SEED_EXP);
      const prior = sj / (si + sj);
      s[i * n + j] = (1 - PUBLIC_SEED_WEIGHT) * sharp + PUBLIC_SEED_WEIGHT * prior;
    }
  return s;
}

/* ---------------------------------------------------------------- prepared field */

export interface Prepared {
  field: BracketField;
  /** Teams in slot order. */
  teams: BracketTeam[];
  regions: Region[];
  win: Float64Array;
  /** Model chance per slot per round. */
  adv: number[][];
  /** Public pick share per slot per round. */
  pub: number[][];
  /** True when pub is our estimate rather than posted shares. */
  pubEstimated: boolean;
  /** The public's per-game matrix (estimate only; null when shares are posted). */
  pubWin: Float64Array | null;
}

export function prepare(field: BracketField): Prepared {
  const teams = slotTeams(field);
  const win = winMatrix(teams, field.sigma);
  const adv = advancement(win);
  const posted = field.publicSource !== "estimate" && teams.every((t) => t.publicPick?.length === 6 && t.publicPick.every((x) => Number.isFinite(x)));
  let pub: number[][];
  let pubWin: Float64Array | null = null;
  if (posted) {
    pub = [0, 1, 2, 3, 4, 5].map((r) => teams.map((t) => t.publicPick![r]));
  } else {
    pubWin = publicMatrix(teams, win);
    pub = advancement(pubWin);
  }
  return { field, teams, regions: regionOrder(field), win, adv, pub, pubEstimated: !posted, pubWin };
}

/* ---------------------------------------------------------------- random brackets */

/** Seeded PRNG (mulberry32), so the same seed always gives the same sims. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fill one bracket game by game: pA(a, b, round) is the chance the first team is chosen. */
function sampleInto(out: Uint8Array, at: number, rand: () => number, pA: (a: number, b: number, r: number) => number) {
  for (let k = 0; k < N_GAMES; k++) {
    const r = ROUND_OF[k];
    const g = k - OFFSET[r];
    let a: number, b: number;
    if (r === 0) {
      a = 2 * g;
      b = a + 1;
    } else {
      const c = at + OFFSET[r - 1] + 2 * g;
      a = out[c];
      b = out[c + 1];
    }
    out[at + k] = rand() < pA(a, b, r) ? a : b;
  }
}

/** The public's chance of picking a over b in round r. Posted shares: the ratio of each side's share to reach that round. */
function publicChooser(p: Prepared): (a: number, b: number, r: number) => number {
  if (p.pubWin) {
    const s = p.pubWin;
    return (a, b) => s[a * 64 + b];
  }
  return (a, b, r) => {
    const x = Math.max(1e-6, p.pub[r][a]);
    const y = Math.max(1e-6, p.pub[r][b]);
    return x / (x + y);
  };
}

/**
 * Opponents are drawn in champion groups. In a big pool the entries that can
 * beat you are mostly the ones that picked the real champion, and a plain
 * sample of a few hundred would hold only a handful of them for a 2% public
 * pick. So each champion the public backs gets its own group, weighted by the
 * public's share on it, and every champion below MIN_GROUP_SHARE shares one
 * "rest" group (champion drawn by share) so no public mass is dropped.
 *
 * Inside a group the bracket is drawn from the public model conditional on
 * that champion (sampleGiven): along the champion's path, the team it beats
 * in each game is drawn by the public's chance that team gets there times the
 * public's chance the champion beats it, then each side is filled the same
 * way. Forcing the champion and drawing the rest freely would not be
 * conditional (Astra, 2026-11-02: 30% where the public says 50%).
 */
export const MIN_GROUP_SHARE = 0.002;
export const MIN_GROUP_SIZE = 4;

export interface OppGroup {
  /** The group's champion, or -1 for the rest group. */
  champion: number;
  /** Public share on this champion (weights sum to 1). */
  weight: number;
  /** Opponents [start, end) in Sims.opponents. */
  start: number;
  end: number;
}

export interface Sims {
  T: number;
  /** Opponent brackets drawn, all groups. */
  K: number;
  /** T simulated tournaments, 63 winners each. */
  outcomes: Uint8Array;
  /** K opponent brackets drawn from the public, 63 picks each, stored group by group. */
  opponents: Uint8Array;
  groups: OppGroup[];
}

/** Opponent group sizes: about K in all, by the square root of each group's public share, at least MIN_GROUP_SIZE. */
export function opponentGroups(p: Prepared, K: number): { champion: number; weight: number; size: number }[] {
  const g: { champion: number; share: number }[] = [...Array(64).keys()].filter((i) => p.pub[5][i] >= MIN_GROUP_SHARE).map((i) => ({ champion: i, share: p.pub[5][i] }));
  const tot = [...Array(64).keys()].reduce((a, i) => a + p.pub[5][i], 0) || 1;
  const rest = tot - g.reduce((a, x) => a + x.share, 0);
  if (rest > 1e-9) g.push({ champion: -1, share: rest });
  const root = g.reduce((a, x) => a + Math.sqrt(x.share), 0);
  return g.map((x) => ({ champion: x.champion, weight: x.share / tot, size: Math.max(MIN_GROUP_SIZE, Math.round((K * Math.sqrt(x.share)) / root)) }));
}

/**
 * One public bracket conditional on `champ` winning it all. Game (r, g)
 * covers slots [g * 2^(r+1), (g + 1) * 2^(r+1)); fill(r, g, w) makes w its
 * winner and fills both halves below it.
 */
export function sampleGiven(out: Uint8Array, at: number, rand: () => number, p: Prepared, champ: number, choose: (a: number, b: number, r: number) => number) {
  const fill = (r: number, g: number, w: number) => {
    out[at + OFFSET[r] + g] = w;
    if (r === 0) return;
    const half = 1 << r; // slots per child game
    const left = 2 * g;
    const wLeft = Math.floor(w / half) === left;
    const mine = wLeft ? left : left + 1;
    const other = wLeft ? left + 1 : left;
    // Who comes out of the other half, given w beats them in this game.
    let tot = 0;
    const from = other * half;
    const ws: number[] = [];
    for (let j = from; j < from + half; j++) {
      const x = Math.max(0, p.pub[r - 1][j]) * choose(w, j, r);
      ws.push(x);
      tot += x;
    }
    let u = rand() * tot;
    let pick = from + half - 1;
    for (let i = 0; i < half; i++) {
      u -= ws[i];
      if (u <= 0) {
        pick = from + i;
        break;
      }
    }
    fill(r - 1, mine, w);
    fill(r - 1, other, pick);
  };
  fill(5, 0, champ);
}

export function simulate(p: Prepared, { T = 2000, K = 300, seed = 2027 }: { T?: number; K?: number; seed?: number } = {}): Sims {
  const rand = mulberry32(seed);
  const outcomes = new Uint8Array(T * N_GAMES);
  const w = p.win;
  for (let t = 0; t < T; t++) sampleInto(outcomes, t * N_GAMES, rand, (a, b) => w[a * 64 + b]);
  const plan = opponentGroups(p, K);
  const total = plan.reduce((a, x) => a + x.size, 0);
  const opponents = new Uint8Array(total * N_GAMES);
  const choose = publicChooser(p);
  const rare = [...Array(64).keys()].filter((i) => p.pub[5][i] < MIN_GROUP_SHARE);
  const rareTot = rare.reduce((a, i) => a + p.pub[5][i], 0);
  const drawRare = () => {
    let u = rand() * rareTot;
    for (const i of rare) if ((u -= p.pub[5][i]) <= 0) return i;
    return rare[rare.length - 1];
  };
  const groups: OppGroup[] = [];
  let at = 0;
  for (const g of plan) {
    const start = at;
    for (let k = 0; k < g.size; k++, at++) sampleGiven(opponents, at * N_GAMES, rand, p, g.champion >= 0 ? g.champion : drawRare(), choose);
    groups.push({ champion: g.champion, weight: g.weight, start, end: at });
  }
  return { T, K: total, outcomes, opponents, groups };
}

/* ---------------------------------------------------------------- scoring */

export type ScoringId = "espn" | "yahoo" | "upset" | "flat";
export const SCORING: { [k in ScoringId]: { label: string; short: string; base: number[]; seedBonus: boolean; note: string } } = {
  espn: { label: "ESPN standard", short: "ESPN", base: [10, 20, 40, 80, 160, 320], seedBonus: false, note: "10, 20, 40, 80, 160, 320 per round" },
  yahoo: { label: "Yahoo and CBS", short: "Yahoo/CBS", base: [1, 2, 4, 8, 16, 32], seedBonus: false, note: "1, 2, 4, 8, 16, 32 per round" },
  upset: { label: "Upset bonus", short: "Seed bonus", base: [1, 2, 4, 8, 16, 32], seedBonus: true, note: "1, 2, 4, 8, 16, 32 plus the winner's seed" },
  flat: { label: "One per game", short: "Flat", base: [1, 1, 1, 1, 1, 1], seedBonus: false, note: "1 point for every correct game" },
};
export const SCORING_IDS = Object.keys(SCORING) as ScoringId[];

export type PayoutId = "wta" | "top3";
export const PAYOUT: { [k in PayoutId]: { label: string; places: number[] } } = {
  wta: { label: "Winner take all", places: [1] },
  top3: { label: "Top 3 paid (50, 30, 20)", places: [0.5, 0.3, 0.2] },
};

/** Points for a correct pick in game k when the winner has this seed. */
export function pointTable(scoring: ScoringId, teams: BracketTeam[]): Float64Array {
  const sc = SCORING[scoring];
  const pts = new Float64Array(N_GAMES * 64);
  for (let k = 0; k < N_GAMES; k++) for (let i = 0; i < 64; i++) pts[k * 64 + i] = sc.base[ROUND_OF[k]] + (sc.seedBonus ? teams[i].seed : 0);
  return pts;
}

function scoreAt(b: Uint8Array, bAt: number, o: Uint8Array, oAt: number, pts: Float64Array): number {
  let s = 0;
  for (let k = 0; k < N_GAMES; k++) {
    const w = o[oAt + k];
    if (b[bAt + k] === w) s += pts[k * 64 + w];
  }
  return s;
}

export function scoreBracket(picks: Picks, outcome: Uint8Array, scoring: ScoringId, teams: BracketTeam[]): number {
  return scoreAt(picks, 0, outcome, 0, pointTable(scoring, teams));
}

/* ---------------------------------------------------------------- candidates */

export interface Candidate {
  picks: Picks;
  /** How it was built, in a few words ("Duke champion, leverage 0.4"). */
  label: string;
  champion: number;
  aggro: number;
}

/** Title candidates tried, by model title odds. */
export const CANDIDATE_CHAMPIONS = 12;
/** Aggressiveness levels: 0 is pure model favorites; higher trades win chance for leverage. */
export const AGGRO_LEVELS = [0, 0.4, 0.8] as const;
/** Never pick an underdog below this head-to-head chance: an upset pick has to be credible. */
export const MIN_UPSET_CHANCE = 0.28;

/**
 * Fill a bracket around forced picks: each forced slot wins through round
 * forced[slot]. Every other game goes to the model favorite unless the
 * underdog's value is better: log(win chance) + aggro * log(model share /
 * public share) for reaching that round, with the underdog at least
 * MIN_UPSET_CHANCE to win the game.
 */
export function fillBracket(p: Prepared, forced: Map<number, number>, aggro: number): Picks {
  const picks = new Uint8Array(N_GAMES);
  const val = (x: number, y: number, r: number) => Math.log(Math.max(1e-9, p.win[x * 64 + y])) + aggro * Math.log(Math.max(1e-6, p.adv[r][x]) / Math.max(1e-6, p.pub[r][x]));
  for (let k = 0; k < N_GAMES; k++) {
    const r = ROUND_OF[k];
    const [a, b] = gameTeams(k, picks);
    const fa = (forced.get(a) ?? -1) >= r;
    const fb = (forced.get(b) ?? -1) >= r;
    if (fa || fb) {
      picks[k] = fa ? a : b;
      continue;
    }
    const fav = p.win[a * 64 + b] >= 0.5 ? a : b;
    const dog = fav === a ? b : a;
    const credible = p.win[dog * 64 + fav] >= MIN_UPSET_CHANCE;
    picks[k] = aggro > 0 && credible && val(dog, fav, r) > val(fav, dog, r) ? dog : fav;
  }
  return picks;
}

const sameRegion = (a: number, b: number) => a >> 4 === b >> 4;

/** Champion-first candidates: top title teams at each aggressiveness, Final Four variants, and the most likely bracket. */
export function buildCandidates(p: Prepared): Candidate[] {
  const out: Candidate[] = [];
  const seen = new Set<string>();
  const add = (c: Candidate) => {
    const key = c.picks.join(",");
    if (seen.has(key)) return;
    seen.add(key);
    out.push(c);
  };
  const byTitle = [...Array(64).keys()].sort((a, b) => p.adv[5][b] - p.adv[5][a]);
  const champs = byTitle.slice(0, CANDIDATE_CHAMPIONS);
  for (const c of champs)
    for (const a of AGGRO_LEVELS) add({ picks: fillBracket(p, new Map([[c, 5]]), a), label: `${p.teams[c].short} champion, leverage ${a}`, champion: c, aggro: a });
  // Final Four variants: for the top four title picks, swap in the most under-picked credible region winner elsewhere.
  for (const c of champs.slice(0, 4)) {
    let best = -1;
    let bestRatio = 1;
    for (let i = 0; i < 64; i++) {
      if (sameRegion(i, c) || p.adv[3][i] < 0.08) continue;
      const ratio = p.adv[3][i] / Math.max(1e-6, p.pub[3][i]);
      if (ratio > bestRatio) {
        bestRatio = ratio;
        best = i;
      }
    }
    if (best >= 0)
      add({
        picks: fillBracket(
          p,
          new Map([
            [c, 5],
            [best, 3],
          ]),
          0.4,
        ),
        label: `${p.teams[c].short} champion, ${p.teams[best].short} in the Final Four`,
        champion: c,
        aggro: 0.4,
      });
  }
  const ml = mostLikely(p);
  add({ picks: ml.picks, label: "Most likely bracket", champion: ml.picks[62], aggro: 0 });
  return out;
}

/* ---------------------------------------------------------------- pool table */

/**
 * Inside a group, below this many opponents at or above a score the empirical
 * share is blended with the group's normal tail (a small group can't see it).
 */
export const TAIL_N = 3;

export interface PoolTable {
  scoring: ScoringId;
  C: number;
  T: number;
  /**
   * Two halves, weighted across champion groups: q[c * T + t] is the share of
   * public opponents scoring strictly above candidate c in sim t, and
   * q[C * T + c * T + t] the share tied with it. Ties are kept apart because
   * a shared score is settled once for the whole tied group, not opponent by
   * opponent (Astra, 2026-11-02: identical brackets in a pool of 4 read 12.5%
   * to win when it is 25%).
   */
  q: Float32Array;
  /** Candidate c's score in sim t (empty when only q crossed from the worker). */
  score: Float32Array;
}

function upperBound(a: Float64Array, lo: number, hi: number, x: number): number {
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (a[m] <= x) lo = m + 1;
    else hi = m;
  }
  return lo;
}
function lowerBound(a: Float64Array, lo: number, hi: number, x: number): number {
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (a[m] < x) lo = m + 1;
    else hi = m;
  }
  return lo;
}

/** Score every candidate and every opponent in every sim once, and keep each candidate's better and tied shares per sim. */
export function poolTable(p: Prepared, sims: Sims, cands: Candidate[], scoring: ScoringId): PoolTable {
  const { T, K, outcomes, opponents, groups } = sims;
  const C = cands.length;
  const G = groups.length;
  const pts = pointTable(scoring, p.teams);
  const q = new Float32Array(2 * C * T);
  const score = new Float32Array(C * T);
  const opp = new Float64Array(K);
  const mu = new Float64Array(G);
  const sd = new Float64Array(G);
  const flat = new Uint8Array(C * N_GAMES);
  cands.forEach((c, i) => flat.set(c.picks, i * N_GAMES));
  for (let t = 0; t < T; t++) {
    const oAt = t * N_GAMES;
    // The best anyone can score this sim: the bracket that called every game. The normal tail is cut there.
    const max = scoreAt(outcomes, oAt, outcomes, oAt, pts);
    for (let gi = 0; gi < G; gi++) {
      const { start, end } = groups[gi];
      let sum = 0;
      let sum2 = 0;
      for (let k = start; k < end; k++) {
        const v = scoreAt(opponents, k * N_GAMES, outcomes, oAt, pts);
        opp[k] = v;
        sum += v;
        sum2 += v * v;
      }
      opp.subarray(start, end).sort();
      const n = end - start;
      mu[gi] = sum / n;
      sd[gi] = Math.sqrt(Math.max(1e-9, sum2 / n - mu[gi] * mu[gi])) + 1e-6;
    }
    for (let c = 0; c < C; c++) {
      const x = scoreAt(flat, c * N_GAMES, outcomes, oAt, pts);
      let qb = 0;
      let qt = 0;
      for (let gi = 0; gi < G; gi++) {
        const { start, end, weight } = groups[gi];
        const n = end - start;
        const ub = upperBound(opp, start, end, x);
        const lb = lowerBound(opp, start, end, x);
        const above = end - ub;
        const ties = ub - lb;
        let bg = above / n;
        if (above < TAIL_N) {
          // A small group can't see its own upper tail: blend in a normal tail, truncated at the sim's best possible score.
          const zMax = phi((max - mu[gi]) / sd[gi]);
          const tail = x >= max ? 0 : Math.max(0, zMax - phi((x - mu[gi]) / sd[gi])) / Math.max(1e-12, zMax);
          const qN = Math.min(tail, (above + 1) / n);
          const w = above / TAIL_N;
          bg = w * bg + (1 - w) * qN;
        }
        qb += weight * bg;
        qt += weight * (ties / n);
      }
      q[c * T + t] = qb;
      q[C * T + c * T + t] = Math.min(qt, 1 - qb);
      score[c * T + t] = x;
    }
  }
  return { scoring, C, T, q, score };
}

function logChoose(n: number, k: number): number {
  let s = 0;
  for (let i = 0; i < k; i++) s += Math.log(n - i) - Math.log(i + 1);
  return s;
}

export interface PoolValue {
  /** Chance to finish first (a tie for first counts as your share of it). */
  win: number;
  /** Chance to finish in the money (top 3 for that payout, else first). */
  cash: number;
  /** Expected share of the prize pool. An average entry's is 1 / N. */
  share: number;
  /** share * N: how many times an average entry's expected payout. */
  xAvg: number;
  /** Expected finish (1 = first). */
  finish: number;
}

/** Binomial(n, p) at k, in logs so n can be 10,000+. */
const binom = (n: number, k: number, p: number) => (k > n ? 0 : p <= 0 ? (k === 0 ? 1 : 0) : p >= 1 ? (k === n ? 1 : 0) : Math.exp(logChoose(n, k) + k * Math.log(p) + (n - k) * Math.log1p(-p)));

/** E[1 / (X + 1)] for X ~ Binomial(n, p): (1 - (1 - p)^(n+1)) / ((n + 1) p). */
const invOnePlus = (n: number, p: number) => (p <= 1e-12 ? 1 : -Math.expm1((n + 1) * Math.log1p(-Math.min(p, 1 - 1e-15))) / ((n + 1) * p));

/**
 * Chance of each finishing place 0..places-1 in one sim. Each of m opponents
 * independently scores above us (qb), level (qt) or below. B = opponents
 * above; given B = b, ties T ~ Binomial(m - b, qt / (1 - qb)). A tie is
 * broken at random across the tied group, so our place is b + U with U
 * uniform on 0..T: P(place k) = sum over b <= k of P(B = b) * E[1{T >= k - b} / (T + 1)].
 */
export function placeChances(qb: number, qt: number, m: number, places: number): number[] {
  const out = new Array<number>(places).fill(0);
  const pt = qb >= 1 ? 0 : Math.min(1, qt / (1 - qb));
  for (let k = 0; k < places; k++) {
    for (let b = 0; b <= k && b <= m; b++) {
      const pb = binom(m, b, qb);
      if (pb === 0) continue;
      const n = m - b;
      const j = k - b;
      let e = invOnePlus(n, pt);
      for (let t = 0; t < j; t++) e -= binom(n, t, pt) / (t + 1);
      out[k] += pb * Math.max(0, e);
    }
  }
  return out;
}

const qOf = (tab: PoolTable, c: number, t: number) => {
  const qb = Math.min(1, Math.max(0, tab.q[c * tab.T + t]));
  const qt = tab.q.length >= 2 * tab.C * tab.T ? Math.min(1 - qb, Math.max(0, tab.q[tab.C * tab.T + c * tab.T + t])) : 0;
  return { qb, qt };
};

/** A candidate's expected prize share in each sim, with its win and cash chances. */
function bySim(tab: PoolTable, c: number, N: number, payout: PayoutId) {
  const places = PAYOUT[payout].places.slice(0, Math.max(1, N));
  const tot = places.reduce((a, b) => a + b, 0);
  const pay = places.map((x) => x / tot);
  const m = N - 1;
  const share = new Float64Array(tab.T);
  let win = 0;
  let cash = 0;
  let finish = 0;
  for (let t = 0; t < tab.T; t++) {
    const { qb, qt } = qOf(tab, c, t);
    const pk = placeChances(qb, qt, m, pay.length);
    win += pk[0];
    cash += pk.reduce((a, x) => a + x, 0);
    share[t] = pk.reduce((a, x, k) => a + pay[k] * x, 0);
    finish += 1 + m * qb + (m * qt) / 2;
  }
  return { share, win: win / tab.T, cash: cash / tab.T, finish: finish / tab.T };
}

/** A candidate's value in a pool of N under a payout. One pass over the T sims. */
export function poolValue(tab: PoolTable, c: number, N: number, payout: PayoutId): PoolValue {
  const x = bySim(tab, c, N, payout);
  const share = x.share.reduce((a, v) => a + v, 0) / tab.T;
  return { win: x.win, cash: x.cash, share, xAvg: share * N, finish: x.finish };
}

/**
 * The bracket to recommend in a pool of N. Many candidates land within the
 * simulation's noise of each other, and the raw top one flips with the random
 * seed (2026-11-02: four different champions across three seeds at 2,000
 * sims). So: find the top expected share, then take the least aggressive
 * candidate (ties to the one with the stronger champion, which is the earlier
 * in build order) whose share is within one paired standard error of it. The
 * sims are shared by every candidate, so the paired difference is tight.
 */
export function bestCandidate(tab: PoolTable, N: number, payout: PayoutId, cands?: Pick<Candidate, "aggro">[]): { index: number; value: PoolValue } {
  const shares = Array.from({ length: tab.C }, (_, c) => bySim(tab, c, N, payout).share);
  const mean = (a: Float64Array) => a.reduce((x, y) => x + y, 0) / a.length;
  const means = shares.map(mean);
  let top = 0;
  for (let c = 1; c < tab.C; c++) if (means[c] > means[top]) top = c;
  let pick = top;
  if (cands) {
    for (let c = 0; c < tab.C; c++) {
      if (c === top) continue;
      let md = 0;
      for (let t = 0; t < tab.T; t++) md += shares[c][t] - shares[top][t];
      md /= tab.T;
      let v = 0;
      for (let t = 0; t < tab.T; t++) v += (shares[c][t] - shares[top][t] - md) ** 2;
      const se = Math.sqrt(v / Math.max(1, tab.T - 1)) / Math.sqrt(tab.T);
      if (md < -se) continue;
      const better = cands[c].aggro < cands[pick].aggro || (cands[c].aggro === cands[pick].aggro && c < pick);
      if (better) pick = c;
    }
  }
  return { index: pick, value: poolValue(tab, pick, N, payout) };
}

/* ---------------------------------------------------------------- perfection */

/**
 * The single most likely bracket: for each game node and each team that
 * could win it, the best log chance of the whole subtree with that team on
 * top; the root's best is the max joint probability over all 2^63 brackets.
 */
export function mostLikely(p: Prepared): { picks: Picks; prob: number } {
  const lw = (i: number, j: number) => Math.log(Math.max(1e-300, p.win[i * 64 + j]));
  // best[k][slot] for slots in game k's range; NaN elsewhere. arg[k][slot] = best opponent.
  const best: Float64Array[] = [];
  const arg: Int16Array[] = [];
  for (let k = 0; k < N_GAMES; k++) {
    const r = ROUND_OF[k];
    const g = k - OFFSET[r];
    const lo = g << (r + 1);
    const hi = (g + 1) << (r + 1);
    const b = new Float64Array(64).fill(-Infinity);
    const a = new Int16Array(64).fill(-1);
    const sub = (slot: number) => (r === 0 ? 0 : best[OFFSET[r - 1] + 2 * g + ((slot >> r) & 1)][slot]);
    for (let i = lo; i < hi; i++) {
      const [olo, ohi] = halfRange(r, i);
      let m = -Infinity;
      let am = -1;
      for (let j = olo; j < ohi; j++) {
        const v = sub(j) + lw(i, j);
        if (v > m) {
          m = v;
          am = j;
        }
      }
      b[i] = sub(i) + m;
      a[i] = am;
    }
    best.push(b);
    arg.push(a);
  }
  const picks = new Uint8Array(N_GAMES);
  let top = -1;
  let topV = -Infinity;
  for (let i = 0; i < 64; i++)
    if (best[62][i] > topV) {
      topV = best[62][i];
      top = i;
    }
  // Walk down: the winner of game k is w; it came from one child, its opponent from the other.
  const assign = (k: number, w: number) => {
    picks[k] = w;
    const r = ROUND_OF[k];
    if (r === 0) return;
    const g = k - OFFSET[r];
    const opp = arg[k][w];
    const cw = OFFSET[r - 1] + 2 * g + ((w >> r) & 1);
    const co = OFFSET[r - 1] + 2 * g + ((opp >> r) & 1);
    assign(cw, w);
    assign(co, opp);
  };
  assign(62, top);
  return { picks, prob: Math.exp(topV) };
}

/** Pure chalk: the better seed every game (the better rating when seeds tie). */
export function chalk(p: Prepared): { picks: Picks; prob: number } {
  const picks = new Uint8Array(N_GAMES);
  let lp = 0;
  for (let k = 0; k < N_GAMES; k++) {
    const [a, b] = gameTeams(k, picks);
    const ta = p.teams[a];
    const tb = p.teams[b];
    const w = ta.seed !== tb.seed ? (ta.seed < tb.seed ? a : b) : ta.rating >= tb.rating ? a : b;
    picks[k] = w;
    lp += Math.log(p.win[w * 64 + (w === a ? b : a)]);
  }
  return { picks, prob: Math.exp(lp) };
}

/** Chance a given bracket is perfect. */
export function bracketProb(p: Prepared, picks: Picks): number {
  let lp = 0;
  for (let k = 0; k < N_GAMES; k++) {
    const [a, b] = gameTeams(k, picks);
    const w = picks[k];
    lp += Math.log(p.win[w * 64 + (w === a ? b : a)]);
  }
  return Math.exp(lp);
}

const BIG = [
  [1e21, "sextillion"],
  [1e18, "quintillion"],
  [1e15, "quadrillion"],
  [1e12, "trillion"],
  [1e9, "billion"],
  [1e6, "million"],
] as const;

/** A chance as "1 in X", with big numbers in words: "1 in 4.2 billion". */
export function oneIn(p: number): string {
  if (!(p > 0)) return "never";
  const x = 1 / p;
  if (x < 1.05) return "a sure thing";
  if (x >= 1e24) {
    const e = Math.floor(Math.log10(x));
    return `1 in ${(x / 10 ** e).toFixed(1)} × 10^${e}`;
  }
  for (const [v, w] of BIG) if (x >= v) return `1 in ${fmtSig(x / v)} ${w}`;
  return `1 in ${Math.round(x).toLocaleString("en-US")}`;
}
const fmtSig = (v: number) => (v < 10 ? v.toFixed(1).replace(/\.0$/, "") : String(Math.round(v)));

/* ---------------------------------------------------------------- reading a bracket */

export interface PickRow {
  game: number;
  round: number;
  team: number;
  opp: number;
  /** Head-to-head model chance in that matchup. */
  h2h: number;
  /** Model chance the team wins this round (unconditional). */
  model: number;
  /** Public share picking it to win this round. */
  pub: number;
  /** model - pub. */
  lev: number;
}

export function pickRows(p: Prepared, picks: Picks): PickRow[] {
  const rows: PickRow[] = [];
  for (let k = 0; k < N_GAMES; k++) {
    const r = ROUND_OF[k];
    const [a, b] = gameTeams(k, picks);
    const team = picks[k];
    const opp = team === a ? b : a;
    rows.push({ game: k, round: r, team, opp, h2h: p.win[team * 64 + opp], model: p.adv[r][team], pub: p.pub[r][team], lev: p.adv[r][team] - p.pub[r][team] });
  }
  return rows;
}

/** Picks where the worse seed wins. */
export function upsetRows(p: Prepared, picks: Picks): PickRow[] {
  return pickRows(p, picks).filter((x) => p.teams[x.team].seed > p.teams[x.opp].seed);
}

export const finalFour = (picks: Picks): number[] => [56, 57, 58, 59].map((k) => picks[k]);

/** One-call setup for the page: odds, sims, candidates, perfection brackets. */
export function setupOptimizer(field: BracketField, opts: { T?: number; K?: number; seed?: number } = {}) {
  const p = prepare(field);
  const sims = simulate(p, opts);
  const cands = buildCandidates(p);
  return { p, sims, cands, ml: mostLikely(p), chalk: chalk(p) };
}
