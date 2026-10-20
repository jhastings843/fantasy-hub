// Trends in Sam's first TD model, from the graded games only.
//
// Every check here has the same shape: pick a slice of the model's output
// (his pick, the side he favored, players in a price range, players whose
// usage runs ahead of their scoring...), count how often that slice actually
// scored the first TD, and set it against how often Sam said it would (the
// sum of his own chances for it). Over means the model undersold that slice,
// under means it oversold it.
//
// A first TD is a long shot even for the pick, so samples are tiny for a long
// time. A slice is only called a trend when it is more than 1.645 standard
// deviations from Sam's number (the same 90% bar the Picks tab uses) AND at
// least MIN_GAMES games are graded. Short of that it reads "leaning" (1 sd) or
// "in line", and before MIN_GAMES everything reads "too early".

import { pricedPlayers, type FtdGame, type FtdPlayer } from "./parse";
import { sameName, type Graded } from "./grade";
import { kalshiFee, type KalshiGame, type KalshiPlayer } from "./kalshi";

export const MIN_GAMES = 30;
const Z_TREND = 1.645;
const Z_LEAN = 1;

export interface GradedGame {
  game: FtdGame;
  result: Graded;
  kalshi?: KalshiGame;
  kickoff?: string;
  /** When the pregame copy was saved: the learning engine's date for a game with no kickoff. */
  capturedAt?: string;
}

type Keep = (p: FtdPlayer & { p: number }, cost: number, g: FtdGame) => boolean;

/** The money checks at Kalshi's ask, in page order. Ids are stable: the learning engine keeps them. */
export const MARKET_SLICES: [string, string, Keep][] = [
  ["k-value", "Sam's chance above Kalshi's cost", (p, c) => p.p > c],
  ["k-value3", "Above Kalshi's cost by 3+ points", (p, c) => p.p >= c + 0.03],
  ["k-pick", "Sam's pick, bought at Kalshi's ask", (p, _c, g) => !!g.pick && g.pick.name === p.name && g.pick.team === p.team],
  ["k-short", "Kalshi priced 10% or less, Sam above cost", (p, c) => c <= 0.1 && p.p > c],
  // By probability, value or not: which tier of Sam's list (if any) beats Kalshi's price.
  ["k-top2", "Sam's two most likely in each game", (p, _c, g) => pricedPlayers(g).slice(0, 2).some((x) => x.key === p.key)],
  ["k-p12", "Sam 12% or more, every one", (p) => p.p >= 0.12],
  ["k-p8", "Sam 8% to 12%, every one", (p) => p.p >= 0.08 && p.p < 0.12],
  ["k-p4", "Sam 4% to 8%, every one", (p) => p.p >= 0.04 && p.p < 0.08],
  ["k-p0", "Sam under 4%, every one", (p) => p.p < 0.04],
  ["k-p8-value", "Sam 8% or more and above Kalshi's cost", (p, c) => p.p >= 0.08 && p.p > c],
];

/** One contract per priced player a slice keeps, at Kalshi's ask (fee in). Games without Kalshi prices are skipped. */
export function marketBets(list: GradedGame[], keep: Keep): { game: FtdGame; kickoff?: string; cost: number; win: boolean; net: number }[] {
  const out: { game: FtdGame; kickoff?: string; cost: number; win: boolean; net: number }[] = [];
  for (const { game, result, kalshi, kickoff, capturedAt } of list) {
    if (!kalshi) continue;
    for (const p of pricedPlayers(game)) {
      const k = kalshiFor(kalshi, p.name);
      if (!k?.ask) continue;
      const cost = kalshiCost(k.ask);
      if (cost >= 1 || !keep(p, cost, game)) continue;
      const win = isPlayer(result, p);
      out.push({ game, kickoff: kickoff ?? capturedAt, cost, win, net: win ? (1 - cost) / cost : -1 });
    }
  }
  return out;
}

/** A bet slice at Kalshi's ask: money, not just counts. */
export interface PriceSlice {
  id: string;
  label: string;
  bets: number;
  w: number;
  units: number;
  /** Wins needed to break even: the sum of the costs paid. */
  needed: number;
  z: number | null;
  verdict: Verdict;
}

/** Sam's player against Kalshi's market for him. Null when Kalshi has no single match. */
export function kalshiFor(k: KalshiGame | undefined, samName: string): KalshiPlayer | null {
  if (!k) return null;
  const xs = k.players.filter((x) => sameName(samName, x.name));
  return xs.length === 1 ? xs[0] : null;
}
/** What one contract costs at the ask, fee included. */
export const kalshiCost = (ask: number) => Math.round((ask + kalshiFee(ask)) * 100) / 100;

export type Verdict = "early" | "in-line" | "lean-over" | "lean-under" | "over" | "under";

export interface Slice {
  id: string;
  label: string;
  /** How many chances went into the slice (games, or player-games). */
  n: number;
  actual: number;
  expected: number;
  z: number | null;
  verdict: Verdict;
}

export interface Trends {
  games: number;
  /** Season-wide checks, each one line on the page. */
  headline: Slice[];
  /** Where the scorer sat in Sam's list. */
  rank: Slice[];
  /** Priced players by the size of Sam's number. */
  price: Slice[];
  /** Sam's two inputs, scoring rate (s1) and opportunity rate (s2). */
  usage: Slice[];
  /** Pass share of offensive first TDs against the defense table's pass share. */
  passShare: { n: number; actual: number; expected: number } | null;
  /** Betting Sam's number at Kalshi's ask, 1 unit per player. */
  market: PriceSlice[];
  /** Games that had Kalshi prices saved. */
  kalshiGames: number;
  /** Plain sentences for the slices that cleared the bar, strongest first. */
  findings: string[];
}

/** Count against expectation for independent chances p_i, with a z score. */
function slice(id: string, label: string, chances: number[], hits: number, games: number): Slice {
  const expected = chances.reduce((a, p) => a + p, 0);
  const variance = chances.reduce((a, p) => a + p * (1 - p), 0);
  const z = variance > 0 ? (hits - expected) / Math.sqrt(variance) : null;
  let verdict: Verdict = "in-line";
  if (games < MIN_GAMES) verdict = "early";
  else if (z !== null && z >= Z_TREND) verdict = "over";
  else if (z !== null && z <= -Z_TREND) verdict = "under";
  else if (z !== null && z >= Z_LEAN) verdict = "lean-over";
  else if (z !== null && z <= -Z_LEAN) verdict = "lean-under";
  return { id, label, n: chances.length, actual: hits, expected: Math.round(expected * 100) / 100, z: z === null ? null : Math.round(z * 100) / 100, verdict };
}

const pctOf = (s: string) => {
  const m = s.match(/(\d+(?:\.\d+)?)%/);
  return m ? Number(m[1]) / 100 : null;
};

/** The defense table's row for a team's defense ("How each defense has been scored on"). */
function defenseStat(g: FtdGame, label: RegExp, defense: string): number | null {
  const row = g.defense.find((r) => label.test(r.label));
  if (!row) return null;
  return pctOf(defense === g.home ? row.home : row.away);
}

const isPlayer = (r: Graded, p: FtdPlayer) => r.key === p.key;

export function trends(list: GradedGame[]): Trends {
  const games = list.length;
  const s = (id: string, label: string, pick: (x: GradedGame) => { chances: number[]; hits: number }) => {
    let hits = 0;
    const chances: number[] = [];
    for (const x of list) {
      const r = pick(x);
      hits += r.hits;
      chances.push(...r.chances);
    }
    return slice(id, label, chances, hits, games);
  };
  const fav = (g: FtdGame) => [...g.teams].sort((a, b) => b.pFirst - a.pFirst)[0];

  const headline = [
    s("pick", "Sam's pick scores first", ({ game, result }) => ({ chances: game.pick ? [game.pick.p] : [], hits: result.pickHit ? 1 : 0 })),
    s("side", "The side Sam favored scores first", ({ game, result }) => ({ chances: [fav(game).pFirst], hits: result.team === fav(game).team ? 1 : 0 })),
    s("home", "The home side scores first", ({ game, result }) => ({
      chances: [game.teams.find((t) => t.team === game.home)?.pFirst ?? 0],
      hits: result.team === game.home ? 1 : 0,
    })),
    s("leaky", "The side facing the defense that more often allows the first TD", ({ game, result }) => {
      const a = defenseStat(game, /allowing the first/i, game.away);
      const h = defenseStat(game, /allowing the first/i, game.home);
      if (a === null || h === null || a === h) return { chances: [], hits: 0 };
      // The away defense leaks more, so the home offense is the side facing it.
      const side = a > h ? game.home : game.away;
      return { chances: [game.teams.find((t) => t.team === side)?.pFirst ?? 0], hits: result.team === side ? 1 : 0 };
    }),
    s("none", "No offensive first TD (defense, special teams or no TD)", ({ game, result }) => ({ chances: [game.none], hits: result.bucket === "none" ? 1 : 0 })),
  ];

  const rankGroup = (id: string, label: string, from: number, to: number) =>
    s(id, label, ({ game, result }) => {
      const priced = pricedPlayers(game);
      const group = priced.slice(from - 1, to);
      return { chances: [group.reduce((a, p) => a + p.p, 0)], hits: result.rank !== null && result.rank >= from && result.rank <= to ? 1 : 0 };
    });
  const rank = [
    rankGroup("r1", "Sam's #1 (the pick)", 1, 1),
    rankGroup("r2", "#2 or #3", 2, 3),
    rankGroup("r4", "#4 to #6", 4, 6),
    rankGroup("r7", "#7 or lower", 7, 99),
    s("thin", "A THIN player (no number shown)", ({ game, result }) => ({ chances: [game.teams.reduce((a, t) => a + t.thin, 0)], hits: result.bucket === "thin" ? 1 : 0 })),
    s("rest", "Anyone else (below his list)", ({ game, result }) => ({ chances: [game.teams.reduce((a, t) => a + t.rest, 0)], hits: result.bucket === "unlisted" ? 1 : 0 })),
  ];

  const byPlayers = (id: string, label: string, keep: (p: FtdPlayer & { p: number }) => boolean) =>
    s(id, label, ({ game, result }) => {
      const ps = pricedPlayers(game).filter(keep);
      return { chances: ps.map((p) => p.p), hits: ps.some((p) => isPlayer(result, p)) ? 1 : 0 };
    });
  const price = [
    byPlayers("p12", "Priced 12% or more", (p) => p.p >= 0.12),
    byPlayers("p8", "8% to 12%", (p) => p.p >= 0.08 && p.p < 0.12),
    byPlayers("p4", "4% to 8%", (p) => p.p >= 0.04 && p.p < 0.08),
    byPlayers("p0", "Under 4%", (p) => p.p < 0.04),
  ];

  // Sam's own note on each player compares these two, with a 5-point band.
  const gap = (p: FtdPlayer) => (p.s1 !== undefined && p.s2 !== undefined ? p.s2 - p.s1 : null);
  const usage = [
    byPlayers("u-ahead", "Usage ahead of scoring (\"the ball finds him more\")", (p) => (gap(p) ?? 0) > 0.05),
    byPlayers("u-agree", "Scoring and usage agree", (p) => gap(p) !== null && Math.abs(gap(p)!) <= 0.05),
    byPlayers("u-behind", "Scoring ahead of usage (\"scored more than his workload\")", (p) => (gap(p) ?? 0) < -0.05),
    byPlayers("u-light", "Under 20 touches (leans on last year)", (p) => p.touches < 20),
  ];

  // Pass share: of offensive first TDs, how many were passes, against the
  // scored-on defense's "share of those allowed by pass".
  let pn = 0;
  let pa = 0;
  let pe = 0;
  for (const { game, result } of list) {
    if (result.first.kind !== "offense" || result.first.how === "other") continue;
    const scoredOn = result.first.team === game.home ? game.away : game.home;
    const share = defenseStat(game, /allowed by pass/i, scoredOn);
    if (share === null) continue;
    pn++;
    pe += share;
    if (result.first.how === "pass") pa++;
  }
  const passShare = pn ? { n: pn, actual: pa, expected: Math.round(pe * 100) / 100 } : null;

  // Money: every priced player whose Sam chance beats Kalshi's cost, bought at the ask.
  const withK = list.filter((x) => x.kalshi);
  const priceSlice = (id: string, label: string, keep: Keep): PriceSlice => {
    const bs = marketBets(withK, keep);
    const w = bs.filter((x) => x.win).length;
    const units = bs.reduce((t, x) => t + x.net, 0);
    const needed = bs.reduce((t, x) => t + x.cost, 0);
    const variance = bs.reduce((t, x) => t + x.cost * (1 - x.cost), 0);
    const z = variance > 0 ? (w - needed) / Math.sqrt(variance) : null;
    let verdict: Verdict = "in-line";
    if (withK.length < MIN_GAMES) verdict = "early";
    else if (z !== null && z >= Z_TREND && units > 0) verdict = "over";
    else if (z !== null && z <= -Z_TREND) verdict = "under";
    else if (z !== null && z >= Z_LEAN) verdict = "lean-over";
    else if (z !== null && z <= -Z_LEAN) verdict = "lean-under";
    return { id, label, bets: bs.length, w, units: Math.round(units * 100) / 100, needed: Math.round(needed * 100) / 100, z: z === null ? null : Math.round(z * 100) / 100, verdict };
  };
  const market = MARKET_SLICES.map(([id, label, keep]) => priceSlice(id, label, keep));

  const findings = [...headline, ...rank, ...price, ...usage]
    .filter((x) => x.verdict === "over" || x.verdict === "under")
    .sort((a, b) => Math.abs(b.z ?? 0) - Math.abs(a.z ?? 0))
    .map((x) => `${x.label}: ${x.actual} actual against ${x.expected.toFixed(1)} expected, so the model has ${x.verdict === "over" ? "undersold" : "oversold"} it.`);

  for (const x of market) {
    if (x.verdict === "over") findings.push(`${x.label}: ${x.w} winners on ${x.bets} bets, ${x.units >= 0 ? "+" : ""}${x.units}u at Kalshi's ask.`);
    if (x.verdict === "under") findings.push(`${x.label}: losing at Kalshi's ask (${x.units}u on ${x.bets} bets).`);
  }
  return { games, headline, rank, price, usage, passShare, market, kalshiGames: withK.length, findings };
}
