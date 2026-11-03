// Our models on the shared learning engine (lib/learning/engine.ts), each as
// its own section so its evidence never mixes with Sam's or David's. A
// model edge shows on the page from day one; it becomes a bet only when one
// of these slices clears the section's gate on games after it registered.

import type { Bet, Candidate } from "@/lib/learning/engine";
import { STAT_LABEL, type PropMarket, type Side, type Stat } from "@/lib/props/parse";
import { nameKey, type GradedBet } from "@/lib/props/grade";
import type { GradedPropsGame } from "@/lib/props/trends";
import { marketBets, type GradedGame as FtdGradedGame } from "@/lib/firsttd/trends";
import { bestBets, ftdEdge, type Books } from "./nfl/ftd-price";

type Keep = Parameters<typeof marketBets>[1];

export const OUR_SECTION = {
  nbaProps: "nba-props-ours",
  nbaFirstBasket: "nba-firstbasket-ours",
  nflProps: "nfl-props-ours",
  nflFirstTd: "nfl-firsttd-ours",
} as const;

/** Edge bands: our chance on the side minus DK's no-vig chance. */
const BANDS: [string, string, number, number][] = [
  ["edge:lo", "Edge under 3 points", -1, 0.03],
  ["edge:mid", "Edge 3 to 6 points", 0.03, 0.06],
  ["edge:hi", "Edge 6 points or more", 0.06, 2],
];

const towardOf = (side: "over" | "under", first: number | undefined, last: number) =>
  first === undefined || first === last ? 0 : (side === "over" ? last > first : last < first) ? 1 : -1;

/** Slice ids and labels, in page order. Ids are stable: the engine keeps them in Redis. */
export function ourPropSlices(stats: Stat[]): [string, string][] {
  return [
    ["edge:all", "Every model edge (our chance beats DK's break-even)"],
    ...stats.map((s): [string, string] => [`edge:${s}`, `Edges: ${STAT_LABEL[s].toLowerCase()}`]),
    ["edge:over", "Edges on the over"],
    ["edge:under", "Edges on the under"],
    ...BANDS.map(([id, label]): [string, string] => [id, label]),
    ["lean:all", "Model lean, every prop"],
    ...stats.map((s): [string, string] => [`lean:${s}`, `Lean: ${STAT_LABEL[s].toLowerCase()}`]),
  ];
}

/**
 * The bet an edge or lean slice takes on one market, or null. Shared by the
 * graded record (ourSliceBets) and today's staked bets (lib/props/staked.ts),
 * so a bet is a bet by the same rule in both. Pure.
 *
 *   pickOurSlice("edge:under", m, { play: { side: "under" }, lean: { side: "under" } }) -> the play
 */
export function pickOurSlice<T extends { side: Side }>(id: string, m: Pick<PropMarket, "stat" | "gap">, b: { play: T | null; lean: T | null }): T | null {
  const [group, key] = id.split(":");
  const bet = group === "edge" ? b.play : group === "lean" ? b.lean : null;
  if (!bet) return null;
  const band = BANDS.find((x) => x[0] === id);
  const keep = key === "all" || key === m.stat || key === bet.side || (band !== undefined && m.gap !== null && m.gap >= band[2] && m.gap < band[3]);
  return keep ? bet : null;
}

/** Every graded bet in one slice. */
export function ourSliceBets(list: GradedPropsGame[], id: string): { x: GradedPropsGame; bet: GradedBet; marketId: string; line: number }[] {
  const out: { x: GradedPropsGame; bet: GradedBet; marketId: string; line: number }[] = [];
  for (const x of list) {
    const byId = new Map(x.game.markets.map((m) => [m.id, m]));
    for (const g of x.result.markets) {
      const m = byId.get(g.id);
      if (!m || g.actual === null) continue;
      const bet = pickOurSlice(id, m, g);
      if (bet) out.push({ x, bet, marketId: m.id, line: m.line });
    }
  }
  return out;
}

type SliceBet = ReturnType<typeof ourSliceBets>[number];
const toBet = ({ x, bet, marketId, line }: SliceBet): Bet => ({ game: x.slug, key: `${x.week}|${x.slug}|${marketId}|${bet.side}`, week: x.week, at: x.kickoff ?? x.capturedAt ?? "", net: bet.net, toward: towardOf(bet.side, x.first?.[marketId], line) });

// Venom's NFL prop boards (pass yards, rush yards, receptions; Jack, 2026-10-30).
// No line and no side: a weekly 0-100 score for every player on the board for how
// well set up he is for the stat. Scores run differently by board (receptions sit
// at 55-100 for most starters, rush yards spans 2-100), so each player is placed
// by his percentile within that week's board instead of a fixed cutoff. Top 40%
// is an over lean (top 20% strong), bottom 40% an under lean (bottom 20% strong),
// the middle 20% no lean. Judged like PEM, as our edges he agrees with and the
// ones he is against. Receiving yards has no board of its own; his receptions
// board stands in for it, kept in its own slices so the stand-in is judged apart.
export type VenomProps = Map<number, Map<string, Map<string, number>>>;
export type VenomLean = { side: "over" | "under"; strong: boolean };
export const VENOM_STRONG = 0.2;
export const VENOM_LEAN = 0.4;
export const VENOM_PROP_SLICES: [string, string, string][] = [
  ["venom:agree", "Our edges Venom agrees with (his yards and receptions boards)", "edge:all"],
  ["venom:against", "Our edges Venom is against", "edge:all"],
  ["venom:agree-strong", "Venom agrees strongly (his top or bottom fifth)", "venom:agree"],
  ["venom:agree-mild", "Venom agrees mildly (his second fifth from either end)", "venom:agree"],
  ["venom:recyds-agree", "Receiving yards edges his receptions board agrees with", "edge:rec_yds"],
  ["venom:recyds-against", "Receiving yards edges his receptions board is against", "edge:rec_yds"],
];

const pctCache = new WeakMap<Map<string, number>, Map<string, number>>();
/** Each player's percentile on a board, 0 (lowest score) to 1 (highest); ties share the midpoint. */
function percentiles(board: Map<string, number>): Map<string, number> {
  const hit = pctCache.get(board);
  if (hit) return hit;
  const scores = [...board.values()];
  const out = new Map([...board].map(([k, s]) => [k, (scores.filter((x) => x < s).length + (scores.filter((x) => x === s).length - 1) / 2) / Math.max(1, scores.length - 1)]));
  pctCache.set(board, out);
  return out;
}

/** Venom's lean on a player's stat that week, or null (no board, not on it, or the middle fifth). */
export function venomLean(v: VenomProps, week: number, stat: Stat | null, player: string): VenomLean | null {
  const board = stat ? v.get(week)?.get(stat === "rec_yds" ? "rec" : stat) : undefined;
  const p = board ? percentiles(board).get(nameKey(player)) : undefined;
  if (p === undefined) return null;
  if (p >= 1 - VENOM_LEAN) return { side: "over", strong: p >= 1 - VENOM_STRONG };
  if (p <= VENOM_LEAN) return { side: "under", strong: p <= VENOM_STRONG };
  return null;
}

// David Sasser (davidsasser.com, NFL and NBA props; Jack, 2026-11-02): his
// projection is saved with our pregame copy and his side graded at the same
// DraftKings line and price as ours. Judged two ways, both on games after the
// slices registered: as a check on our edges (agree / against), and on his own
// (his side on every prop we price). Any of them can go live past PROPS_GATE.
export const DAVID_PROP_SLICES: [string, string, string | undefined][] = [
  ["david:agree", "Our edges David agrees with", "edge:all"],
  ["david:against", "Our edges David is against", "edge:all"],
  ["david:side", "David's side on every prop we price (DK's line and price)", undefined],
  ["david:far", "David's side when he is 10%+ off the line", "david:side"],
  ["david:both", "David's side when our lean agrees", "david:side"],
];

/** David is 10%+ off the line. */
export const davidFar = (proj: number | undefined, line: number) => proj !== undefined && Math.abs(proj - line) / Math.max(line, 0.5) >= 0.1;

/** The bet one of David's slices takes on a market, or null. Shared with today's staked bets. Pure. */
export function pickDavidSlice<T extends { side: Side }>(id: string, b: { play: T | null; lean: T | null; david?: T | null }, far: boolean): T | null {
  const d = b.david;
  if (!d) return null;
  return id === "david:agree" ? (b.play && b.play.side === d.side ? b.play : null)
    : id === "david:against" ? (b.play && b.play.side !== d.side ? b.play : null)
    : id === "david:side" ? d
    : id === "david:far" ? (far ? d : null)
    : id === "david:both" ? (b.lean && b.lean.side === d.side ? d : null)
    : null;
}

/** Every David bet in one of his slices. */
export function davidSliceBets(list: GradedPropsGame[], id: string): SliceBet[] {
  const out: SliceBet[] = [];
  for (const x of list) {
    const byId = new Map(x.game.markets.map((m) => [m.id, m]));
    for (const g of x.result.markets) {
      const m = byId.get(g.id);
      if (!m || g.actual === null || !g.david) continue;
      const bet = pickDavidSlice(id, g, davidFar(x.david?.[g.id], m.line));
      if (bet) out.push({ x, bet, marketId: m.id, line: m.line });
    }
  }
  return out;
}

export function ourPropCandidates(graded: GradedPropsGame[], stats: Stat[], venom?: VenomProps): Candidate[] {
  const base = [
    ...ourPropSlices(stats).map(([id, label]) => ({
      id,
      label,
      ...(id.endsWith(":all") ? {} : { parent: `${id.split(":")[0]}:all` }),
      bets: ourSliceBets(graded, id).map(toBet),
    })),
    ...DAVID_PROP_SLICES.map(([id, label, parent]) => ({ id, label, ...(parent ? { parent } : {}), bets: davidSliceBets(graded, id).map(toBet) })),
  ];
  if (!venom?.size) return base;
  const edges = ourSliceBets(graded, "edge:all").map((b) => {
    const m = b.x.game.markets.find((x) => x.id === b.marketId);
    const lean = m ? venomLean(venom, b.x.week, m.stat, m.player) : null;
    return { b, recYds: m?.stat === "rec_yds", agree: lean ? lean.side === b.bet.side : null, strong: !!lean?.strong };
  });
  return [...base, ...VENOM_PROP_SLICES.map(([id, label, parent]) => ({ id, label, parent, bets: edges.filter((e) => VENOM_KEEP[id](e)).map(({ b }) => toBet(b)) }))];
}

/** Which of our edges each Venom slice keeps, by his lean against our side. Shared with today's staked bets. */
export const VENOM_KEEP: { [id: string]: (e: { recYds: boolean; agree: boolean | null; strong: boolean }) => boolean } = {
  "venom:agree": (e) => !e.recYds && e.agree === true,
  "venom:against": (e) => !e.recYds && e.agree === false,
  "venom:agree-strong": (e) => !e.recYds && e.agree === true && e.strong,
  "venom:agree-mild": (e) => !e.recYds && e.agree === true && !e.strong,
  "venom:recyds-agree": (e) => e.recYds && e.agree === true,
  "venom:recyds-against": (e) => e.recYds && e.agree === false,
};

/** Won, lost, pushed and units over a set of graded bets. */
export function record(bets: { bet: GradedBet }[]): { w: number; l: number; p: number; units: number } {
  const r = { w: 0, l: 0, p: 0, units: 0 };
  for (const { bet } of bets) {
    if (bet.outcome === "W") r.w++;
    else if (bet.outcome === "L") r.l++;
    else r.p++;
    r.units += bet.net;
  }
  r.units = Math.round(r.units * 100) / 100;
  return r;
}

// First Basket: one market per game, long prices, so it runs on FTD_GATE.

export interface FbGradedBoard {
  event: string;
  week: number;
  at: string;
  /** P(home wins the tip). */
  tip: number;
  home: string;
  /** Our top player in the game. */
  top: string;
  bets: { id: string; team: string; price: number; net: number }[];
}

export const FB_SLICES: [string, string, (b: FbGradedBoard, x: FbGradedBoard["bets"][number]) => boolean][] = [
  ["fb:all", "Every First Basket edge", () => true],
  ["fb:tip", "Edges on the team we favor to win the tip", (b, x) => (b.tip >= 0.5 ? x.team === b.home : x.team !== b.home)],
  ["fb:short", "Edges at +600 or shorter", (_, x) => x.price <= 600],
  ["fb:long", "Edges longer than +600", (_, x) => x.price > 600],
  ["fb:top", "Our top player in the game, when he is an edge", (b, x) => x.id === b.top],
];

export function fbCandidates(boards: FbGradedBoard[]): Candidate[] {
  return FB_SLICES.map(([id, label, keep]) => ({
    id,
    label,
    ...(id === "fb:all" ? {} : { parent: "fb:all" }),
    bets: boards.flatMap((b) => b.bets.filter((x) => keep(b, x)).map((x): Bet => ({ game: b.event, key: `${b.event}|${x.id}`, week: b.week, at: b.at, net: x.net }))),
  }));
}

// NFL First TD: our chances against the best price Jack could get (Kalshi's
// ask with fee, DraftKings or FanDuel; lib/models/nfl/ftd-price.ts), on
// FTD_GATE. New ids from 2026-10-26 (they graded at Kalshi only before), so the
// engine registers them fresh and counts only games after that.

export const OUR_FTD_SLICES: [string, string, Keep][] = [
  ["ftdb:value", "Our chance above the best price (Kalshi, DK or FanDuel)", (p, c) => p.p > c],
  ["ftdb:value3", "Above the best price by 3+ points", (p, c) => p.p >= c + 0.03],
  ["ftdb:gate", "The edge rule: best price 6%+ and ours above it by 2+ points (from Nov 2, 2026)", (p, c) => ftdEdge(p.p, c)],
  ["ftdb:pick", "Our most likely scorer, at the best price", (p, _c, g) => !!g.pick && g.pick.name === p.name && g.pick.team === p.team],
  ["ftdb:short", "Best price 10% or less, ours above it", (p, c) => c <= 0.1 && p.p > c],
  ["ftdb:long", "Best price above 10%, ours above it", (p, c) => c > 0.1 && p.p > c],
];

export function ourFtdCandidates(list: (FtdGradedGame & Books)[]): Candidate[] {
  return OUR_FTD_SLICES.map(([id, label, keep]) => ({
    id,
    label,
    ...(id === "ftdb:value" ? {} : { parent: "ftdb:value" }),
    bets: bestBets(list, keep).map((b): Bet => ({ game: b.game.slug, key: `${b.game.week}|${b.game.slug}|${b.player}`, week: b.game.week, at: b.kickoff ?? "", net: Math.round(b.net * 1000) / 1000 })),
  }));
}
