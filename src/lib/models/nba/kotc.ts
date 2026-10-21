// King of the Court: each player's chance to lead the night's slate in points
// + rebounds + assists (PRA), DraftKings' promo (bet a prop on a player at
// -200 or longer, tag him, and a pool of bonus bets is split among everyone
// whose player led; ties split it across every tied player's backers).
//
// A Monte Carlo of the whole slate, built on our props model's projections
// (props.ts: minutes, then per-minute rates, then pace). Players are not drawn
// independently, because the night's leader comes out of shared shocks:
// 1. Game script: each game's final margin is drawn around DK's spread
//    (sd `sdMargin`). A margin past `blowAt` benches the starters for part of
//    the fourth (they lose `blow` of their PRA per point past it, at most
//    `blowMax`). A margin inside `otBand` goes to overtime and the starters
//    gain `ot` of their PRA.
// 2. Game pace: one multiplier per game (sd `sdGame`), shared by both teams.
// 3. Player: a minutes multiplier (sd `sdMin`), then the box score's own
//    noise around the mean (variance `phi` x mean).
// The max of each draw is the king; a tie splits the win. Every constant in
// KotcParams is fit walk forward by scripts/fit-kotc.mts. Pure: no fetches.

export interface KotcParams {
  sims: number;
  sdMargin: number;
  blowAt: number;
  blow: number;
  blowMax: number;
  otBand: number;
  ot: number;
  sdGame: number;
  sdMin: number;
  phi: number;
}

export interface KotcGame {
  id: string;
  home: string;
  away: string;
  /** Home side's spread (negative when home is favored), null when not posted. */
  homeSpread: number | null;
}

export interface KotcPlayer {
  id: string;
  name: string;
  team: string;
  game: string;
  /** Projected minutes and PRA. */
  min: number;
  pra: number;
  starter: boolean;
}

export interface KotcRow {
  id: string;
  name: string;
  team: string;
  game: string;
  pra: number;
  min: number;
  /** Chance to lead the slate, ties split. */
  p: number;
  /** Chance to finish top 3 (for "Three Kings" nights). */
  top3: number;
  /** His 90th percentile PRA: the ceiling that wins nights. */
  p90: number;
}

export interface KotcBoard {
  rows: KotcRow[];
  /** The winning PRA's 10th, 50th and 90th percentiles. */
  winning: { p10: number; p50: number; p90: number };
  sims: number;
}

/** Seeded generator (mulberry32), so a board is reproducible. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normal(u: () => number): () => number {
  let spare: number | null = null;
  return () => {
    if (spare !== null) {
      const s = spare;
      spare = null;
      return s;
    }
    let x = 0;
    let y = 0;
    let r = 0;
    do {
      x = u() * 2 - 1;
      y = u() * 2 - 1;
      r = x * x + y * y;
    } while (r === 0 || r >= 1);
    const f = Math.sqrt((-2 * Math.log(r)) / r);
    spare = y * f;
    return x * f;
  };
}

/** A stable seed from the slate, so the same inputs give the same board. */
export function slateSeed(players: KotcPlayer[]): number {
  let h = 2166136261;
  for (const p of players) for (const c of `${p.id}:${p.pra.toFixed(2)}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

const quantile = (xs: Float64Array | number[], q: number) => {
  const s = Array.from(xs).sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : 0;
};

export function simulateSlate(games: KotcGame[], players: KotcPlayer[], p: KotcParams, seed = slateSeed(players)): KotcBoard {
  const n = normal(rng(seed));
  const gi = new Map(games.map((g, i) => [g.id, i]));
  const ps = players.filter((x) => gi.has(x.game) && x.pra > 0);
  const win = new Float64Array(ps.length);
  const top3 = new Float64Array(ps.length);
  const draws: number[][] = ps.map(() => []);
  const winning = new Float64Array(p.sims);
  const keepDraws = Math.min(p.sims, 4000);
  const gFactor = new Float64Array(games.length);
  const gBlow = new Float64Array(games.length);
  const gOt = new Uint8Array(games.length);
  const val = new Float64Array(ps.length);
  for (let s = 0; s < p.sims; s++) {
    games.forEach((g, i) => {
      const margin = -(g.homeSpread ?? 0) + p.sdMargin * n();
      const m = Math.abs(margin);
      gOt[i] = m < p.otBand ? 1 : 0;
      gBlow[i] = Math.min(p.blowMax, Math.max(0, m - p.blowAt) * p.blow);
      gFactor[i] = Math.max(0.5, 1 + p.sdGame * n());
    });
    let best = -Infinity;
    for (let j = 0; j < ps.length; j++) {
      const x = ps[j];
      const g = gi.get(x.game)!;
      let mu = x.pra * gFactor[g] * Math.max(0.2, 1 + p.sdMin * n());
      if (x.starter) mu *= (1 - gBlow[g]) * (gOt[g] ? 1 + p.ot : 1);
      const v = Math.max(0, mu + Math.sqrt(p.phi * Math.max(mu, 0.01)) * n());
      // Box scores are whole numbers: the king is decided on rounded PRA, so ties happen.
      val[j] = Math.round(v);
      if (val[j] > best) best = val[j];
      if (s < keepDraws) draws[j].push(val[j]);
    }
    winning[s] = best;
    let tied = 0;
    for (let j = 0; j < ps.length; j++) if (val[j] === best) tied++;
    // Top 3 by value (ties at the third spot all count).
    let third = -Infinity;
    {
      let a = -Infinity;
      let b = -Infinity;
      let c = -Infinity;
      for (let j = 0; j < ps.length; j++) {
        const v = val[j];
        if (v > a) {
          c = b;
          b = a;
          a = v;
        } else if (v > b) {
          c = b;
          b = v;
        } else if (v > c) c = v;
      }
      third = c;
    }
    for (let j = 0; j < ps.length; j++) {
      if (val[j] === best) win[j] += 1 / tied;
      if (val[j] >= third) top3[j]++;
    }
  }
  const rows: KotcRow[] = ps.map((x, j) => ({
    id: x.id,
    name: x.name,
    team: x.team,
    game: x.game,
    pra: Math.round(x.pra * 10) / 10,
    min: Math.round(x.min * 10) / 10,
    p: win[j] / p.sims,
    top3: top3[j] / p.sims,
    p90: quantile(draws[j], 0.9),
  }));
  rows.sort((a, b) => b.p - a.p || b.pra - a.pra);
  return { rows, winning: { p10: quantile(winning, 0.1), p50: quantile(winning, 0.5), p90: quantile(winning, 0.9) }, sims: p.sims };
}

/** The night's actual leaders: every player tied at the top PRA. */
export function kingsOf(actual: { id: string; pra: number }[]): { ids: string[]; pra: number } {
  const top = Math.max(...actual.map((x) => x.pra));
  return { ids: actual.filter((x) => x.pra === top).map((x) => x.id), pra: top };
}

/** Log loss of a board against the actual king(s): -log of the chance given to whoever won. */
export function kingLogLoss(rows: { id: string; p: number }[], kings: string[], floor = 1e-4): number {
  const got = rows.filter((r) => kings.includes(r.id)).reduce((a, r) => a + r.p, 0);
  return -Math.log(Math.max(floor, got));
}
