// Our NBA First Basket model (DraftKings rules: the game's first made field
// goal, free throws don't count, a player who doesn't start is void).
//
// 1. The tip: each jumper's record, shrunk toward even by kTip pseudo-jumps,
//    on the log-odds scale; q = P(team A wins) = logistic(beta x (skill A - skill B)).
//    The expected jumper is the starter who has jumped most often.
// 2. The first basket's team: P(A first) = q x a + (1 - q) x (1 - a), a being
//    how often the team that wins the tip scores first (64% over 2024-26).
// 3. The scorer: among the five starters, each player's share of his team's
//    first baskets in his starts, shrunk by kShare pseudo-games toward his
//    share of the starters' field goals, then scaled to sum to 1.
//    P(player) = P(his team first) x his share.
//
// The tables are cumulative across seasons (a jumper's record carries over).
// Every constant is fit by scripts/fit-first-basket.mts, walk forward. Pure.
//
// Tested and left off (2026-10-26, the fit's test split): blending each
// starter's share of the opening attempts (every shot before the first make)
// into the shrink target, weighting those attempts by his make rate on them,
// and an opponent factor for how often a team gives up the first basket after
// losing the tip. The first two lowered test log loss by under two standard
// errors, the third by less. Each sits behind an optional FbParams field;
// left out, the model is unchanged.

import type { NbaGame } from "./box";
import { implied } from "@/lib/props/parse";

export interface FbParams {
  kTip: number;
  beta: number;
  kShare: number;
  /** Tested ideas, each off when left out (scripts/fit-first-basket.mts). */
  /** Weight on the opening-attempts share in the shrink target (0 or missing: field goals only). */
  wAtt?: number;
  /** Pseudo-starts that fade a player's opening-attempts share toward his field-goal share. */
  kAtt?: number;
  /** Weight opening attempts by the player's make rate on them, shrunk by this many pseudo-attempts. */
  kQ?: number;
  /** Opponent opening defense: its record when it loses the tip, shrunk by this many pseudo-games. */
  kDef?: number;
}

export interface FbTables {
  /** Tip record per jumper: jumps and wins. */
  tips: { [id: string]: { n: number; w: number } };
  /** Per starter: starts, starts where his team scored first, first baskets he made, field goals made in his starts. */
  starts: { [id: string]: { n: number; teamFirst: number; first: number; fgm: number; att?: number } };
  /** Games where the tip winner scored first, and games counted. */
  tipTeamFirst: { n: number; first: number };
  /** Starters' opening attempts (every shot up to the first make) and the makes among them. */
  open?: { att: number; made: number };
  /** Per team: tips it lost, and how many of those its opponent scored first. */
  teams?: { [team: string]: { lost: number; oppFirst: number } };
}

export const emptyTables = (): FbTables => ({ tips: {}, starts: {}, tipTeamFirst: { n: 0, first: 0 } });

/** Fold a final into the tables (in place). Needs the tip and the shots up to the first make. */
export function foldFb(t: FbTables, g: NbaGame) {
  const fb = g.shots.at(-1);
  const scored = fb?.made ? fb : null;
  if (g.jump) {
    const winner = g.jump.team;
    for (const id of g.jump.jumpers) {
      const team = g.players.find((p) => p.id === id)?.team;
      if (!team) continue;
      const r = (t.tips[id] ??= { n: 0, w: 0 });
      r.n++;
      if (team === winner) r.w++;
    }
    if (scored) {
      t.tipTeamFirst.n++;
      if (scored.team === winner) t.tipTeamFirst.first++;
      const loser = [g.home, g.away].find((x) => x !== winner);
      if (loser && (winner === g.home || winner === g.away)) {
        const d = ((t.teams ??= {})[loser] ??= { lost: 0, oppFirst: 0 });
        d.lost++;
        if (scored.team === winner) d.oppFirst++;
      }
    }
  }
  const starter = new Set(g.players.filter((p) => p.starter).map((p) => p.id));
  for (const s of g.shots) {
    if (!starter.has(s.player)) continue;
    const r = (t.starts[s.player] ??= { n: 0, teamFirst: 0, first: 0, fgm: 0 });
    r.att = (r.att ?? 0) + 1;
    const o = (t.open ??= { att: 0, made: 0 });
    o.att++;
    if (s.made) o.made++;
  }
  for (const p of g.players) {
    if (!p.starter) continue;
    const r = (t.starts[p.id] ??= { n: 0, teamFirst: 0, first: 0, fgm: 0 });
    r.n++;
    r.fgm += p.fgm;
    if (scored && scored.team === p.team) {
      r.teamFirst++;
      if (scored.player === p.id) r.first++;
    }
  }
}

const logit = (x: number) => Math.log(x / (1 - x));
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

export function tipSkill(t: FbTables, id: string, p: FbParams): number {
  const r = t.tips[id] ?? { n: 0, w: 0 };
  return logit((r.w + p.kTip * 0.5) / (r.n + p.kTip || 1));
}

/** The starter likeliest to jump: most jumps on file, then a center, then the first listed. */
export function expectedJumper(t: FbTables, starters: { id: string; pos: string }[]): string | null {
  if (!starters.length) return null;
  const ranked = [...starters].sort((a, b) => (t.tips[b.id]?.n ?? 0) - (t.tips[a.id]?.n ?? 0) || Number(/C/.test(b.pos)) - Number(/C/.test(a.pos)));
  return ranked[0].id;
}

export interface FbTeam {
  team: string;
  starters: { id: string; pos: string }[];
}

export interface FbPlayer {
  id: string;
  team: string;
  p: number;
}

export interface FbForecast {
  /** P(home wins the tip) and P(home scores first). */
  home: string;
  away: string;
  jumpers: { [team: string]: string | null };
  tip: number;
  first: number;
  players: FbPlayer[];
}

/** Per-start rates scaled to sum to 1 across the starters; a starter with no starts gets the others' average. */
function perStartShare(t: FbTables, starters: string[], val: (r: FbTables["starts"][string]) => number): number[] {
  const per = starters.map((id) => {
    const r = t.starts[id];
    return r && r.n ? val(r) / r.n : NaN;
  });
  const known = per.filter(Number.isFinite);
  const fill = known.length ? known.reduce((a, x) => a + x, 0) / known.length : 1;
  const f = per.map((x) => (Number.isFinite(x) ? x : fill));
  const sum = f.reduce((a, x) => a + x, 0) || 1;
  return f.map((x) => x / sum);
}

/**
 * What each starter's first-basket share shrinks toward: his share of the
 * starters' field goals, blended (weight wAtt, faded by kAtt pseudo-starts)
 * with his share of their opening attempts, those optionally weighted by his
 * make rate on them shrunk to the league's by kQ pseudo-attempts.
 */
export function shareTarget(t: FbTables, starters: string[], p: FbParams): number[] {
  const fg = perStartShare(t, starters, (r) => r.fgm);
  const w = p.wAtt ?? 0;
  if (!w) return fg;
  const lg = t.open && t.open.att ? t.open.made / t.open.att : 0.45;
  const att = perStartShare(t, starters, (r) => {
    const a = r.att ?? 0;
    return p.kQ === undefined ? a : (a * (r.first + p.kQ * lg)) / (a + p.kQ || 1);
  });
  const mix = starters.map((id, i) => {
    const n = t.starts[id]?.n ?? 0;
    const wi = p.kAtt === undefined ? w : (w * n) / (n + p.kAtt || 1);
    return (1 - wi) * fg[i] + wi * att[i];
  });
  const s = mix.reduce((a, x) => a + x, 0) || 1;
  return mix.map((x) => x / s);
}

/** Share of a team's first basket per starter. */
export function starterShares(t: FbTables, starters: string[], p: FbParams): number[] {
  const target = shareTarget(t, starters, p);
  const raw = starters.map((id, i) => {
    const r = t.starts[id] ?? { n: 0, teamFirst: 0, first: 0, fgm: 0 };
    return (r.first + p.kShare * target[i]) / (r.teamFirst + p.kShare || 1);
  });
  const s = raw.reduce((a, x) => a + x, 0) || 1;
  return raw.map((x) => x / s);
}

/**
 * How much likelier (log odds) a team's opponent is to score first after the
 * team loses the tip, than the league's tip winner (a), shrunk by kDef
 * pseudo-games. 0 when kDef is off.
 */
export function openDefense(t: FbTables, team: string, a: number, p: FbParams): number {
  if (p.kDef === undefined) return 0;
  const r = t.teams?.[team] ?? { lost: 0, oppFirst: 0 };
  if (!r.lost) return 0;
  return logit((r.oppFirst + p.kDef * a) / (r.lost + p.kDef)) - logit(a);
}

export function forecast(t: FbTables, home: FbTeam, away: FbTeam, p: FbParams): FbForecast {
  const jh = expectedJumper(t, home.starters);
  const ja = expectedJumper(t, away.starters);
  const tip = sigmoid(p.beta * ((jh ? tipSkill(t, jh, p) : 0) - (ja ? tipSkill(t, ja, p) : 0)));
  const a = (t.tipTeamFirst.first + 1) / (t.tipTeamFirst.n + 2);
  const aHome = p.kDef === undefined ? a : sigmoid(logit(a) + openDefense(t, away.team, a, p));
  const aAway = p.kDef === undefined ? a : sigmoid(logit(a) + openDefense(t, home.team, a, p));
  const first = tip * aHome + (1 - tip) * (1 - aAway);
  const players: FbPlayer[] = [];
  for (const [side, pt] of [
    [home, first],
    [away, 1 - first],
  ] as const) {
    const ids = side.starters.map((x) => x.id);
    starterShares(t, ids, p).forEach((sh, i) => players.push({ id: ids[i], team: side.team, p: pt * sh }));
  }
  players.sort((x, y) => y.p - x.p);
  return { home: home.team, away: away.team, jumpers: { [home.team]: jh, [away.team]: ja }, tip, first, players };
}

/** DK's chance per listed player with the vig taken out across the whole listed field. */
export function fieldNoVig(prices: { id: string; price: number }[]): Map<string, number> {
  const imp = prices.map((x) => implied(x.price));
  const s = imp.reduce((a, x) => a + x, 0) || 1;
  return new Map(prices.map((x, i) => [x.id, imp[i] / s]));
}

/** The first basket's scorer from a final (null: no made field goal on file). */
export const firstBasketOf = (g: NbaGame): { player: string; team: string } | null => {
  const s = g.shots.at(-1);
  return s?.made ? { player: s.player, team: s.team } : null;
};

// The live board: our chances next to DraftKings' First Basket prices.

export interface FbBoardPlayer {
  id: string;
  name: string;
  team: string;
  p: number;
  /** DK's price and its no-vig chance across the listed field, when listed. */
  price: number | null;
  fair: number | null;
  /** Our chance beats DK's break-even at its price. */
  edge: boolean;
}
export interface FbBoard {
  home: string;
  away: string;
  /** P(home wins the tip), P(home scores first). */
  tip: number;
  first: number;
  jumpers: { [team: string]: string | null };
  /** Where the starters came from: DK's listed field (its probable starters) or each team's last game. */
  starters: "dk" | "last game";
  players: FbBoardPlayer[];
  /** Filled at grading: the first basket's scorer, null when none was found. */
  result?: { player: string; team: string } | null;
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;

/**
 * DK lists about ten players for First Basket: its probable starters. When it
 * lists four or more per team they are the starters; otherwise each team's
 * starters from its last game (less anyone Out) stand in.
 */
export function fbBoard(
  home: string,
  away: string,
  dk: { id: string; price: number }[],
  lastStarters: { [team: string]: { id: string; pos: string }[] },
  names: Map<string, { name: string; team: string; pos: string }>,
  t: FbTables,
  p: FbParams,
): FbBoard | null {
  const byTeam = (team: string) => dk.filter((x) => names.get(x.id)?.team === team).map((x) => ({ id: x.id, pos: names.get(x.id)!.pos }));
  const fromDk = byTeam(home).length >= 4 && byTeam(away).length >= 4;
  const st = (team: string) => (fromDk ? byTeam(team) : (lastStarters[team] ?? []).slice(0, 5));
  if (st(home).length < 4 || st(away).length < 4) return null;
  const f = forecast(t, { team: home, starters: st(home) }, { team: away, starters: st(away) }, p);
  const fair = fieldNoVig(dk);
  const price = new Map(dk.map((x) => [x.id, x.price]));
  return {
    home,
    away,
    tip: r3(f.tip),
    first: r3(f.first),
    jumpers: f.jumpers,
    starters: fromDk ? "dk" : "last game",
    players: f.players.map((x) => {
      const pr = price.get(x.id) ?? null;
      return { id: x.id, name: names.get(x.id)?.name ?? x.id, team: x.team, p: r3(x.p), price: pr, fair: fair.has(x.id) ? r3(fair.get(x.id)!) : null, edge: pr !== null && x.p > implied(pr) };
    }),
  };
}

export interface FbBet {
  id: string;
  name: string;
  price: number;
  p: number;
  won: boolean;
  /** Units on 1 risked. */
  net: number;
}

/** Every edge on a graded board, settled. A non-starter's first basket still settles the starters' bets as losses. */
export function fbBets(b: FbBoard): FbBet[] {
  if (b.result === undefined) return [];
  return b.players
    .filter((x) => x.edge && x.price !== null)
    .map((x) => {
      const won = b.result?.player === x.id;
      const pay = x.price! > 0 ? x.price! / 100 : 100 / -x.price!;
      return { id: x.id, name: x.name, price: x.price!, p: x.p, won, net: won ? Math.round(pay * 1000) / 1000 : -1 };
    });
}
