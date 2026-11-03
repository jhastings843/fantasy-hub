// How much to stake on a prop bet (Jack, 2026-11-02: "would different unit
// staking change anything? ... tracked as well and switched where necessary").
//
// Every prop record is graded flat, 1u risked at the saved price. This module
// sizes the same bets other ways, from our saved win chance and the saved
// price, so each section can show what each way would have made, and so a
// section's live bets switch off flat only when the evidence says to. Pure.
//
// 1u = 1% of bankroll, as on NBA picks (lib/picks/nba-track.ts nbaStake).
// Every scheme is capped at 3u a bet; 0 means no bet.
//
//   stakeFor("flat", { p: 0.55, price: -110 })          -> 1
//   stakeFor("towin", { p: 0.55, price: -200 })         -> 2     (risk 2u to win 1u)
//   stakeFor("kelly25", { p: 0.6, price: -110 })        -> 4.0 raw, capped -> 3
//   stakeFor("kelly25shrunk", { p: 0.55, price: -110 }) -> 0.75  (p pulled to 0.537)
//   stakeFor("edge", { p: 0.62, price: -110 })          -> 9.6 pts over break-even -> 2.5
//
// Switch rule (staked bets only): a section leaves flat for scheme X when X
// beats flat on log-growth over the section's graded bets, with 200+ bets over
// 4+ weeks and a paired t of 1.645+ on per-bet log-growth differences. It goes
// back to flat once X's log-growth falls below flat's on those bets.

import type { Bet } from "@/lib/learning/engine";

export type SchemeId = "flat" | "towin" | "kelly25" | "kelly25shrunk" | "edge";

export const SCHEME_IDS: SchemeId[] = ["flat", "towin", "kelly25", "kelly25shrunk", "edge"];

/**
 * "To win 1u" is left out of long-odds sections (Jack, 2026-11-03): First TD,
 * Anytime TD, First Basket, lottos, King of the Court. Judged from the bets:
 * a section whose median price is +200 or longer.
 *
 *   schemesFor([+650, +900, +1200]) -> flat, kelly25, kelly25shrunk, edge
 *   schemesFor([-110, -115, +105])  -> all five
 */
export const LONG_ODDS = 200;
export function schemesFor(bets: { price?: number }[]): SchemeId[] {
  const prices = bets.map((b) => b.price).filter((x): x is number => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
  const median = prices.length ? prices[Math.floor(prices.length / 2)] : 0;
  return median >= LONG_ODDS ? SCHEME_IDS.filter((x) => x !== "towin") : SCHEME_IDS;
}

/** How each scheme reads on a page (label) and next to a stake ("2u, quarter Kelly"). */
export const SCHEME: { [k in SchemeId]: { label: string; note: string; how: string } } = {
  flat: { label: "Flat 1u", note: "flat", how: "1u on every bet" },
  towin: { label: "To win 1u", note: "to win 1u", how: "risk what it takes to win 1u, up to 3u" },
  kelly25: { label: "Quarter Kelly", note: "quarter Kelly", how: "a quarter of the Kelly stake at our chance, 0.25u steps, 0.25u to 3u" },
  kelly25shrunk: { label: "Quarter Kelly, shrunk", note: "quarter Kelly, shrunk", how: "quarter Kelly with our chance pulled halfway to the break-even" },
  edge: { label: "By edge", note: "by edge", how: "1u at the edge bar, plus 0.5u per 3 more points, up to 3u" },
};

/** Largest stake any scheme sets on one bet. */
export const MAX_UNITS = 3;
/** Smallest Kelly stake, and the step Kelly stakes round to. */
export const KELLY_MIN = 0.25;
const KELLY = 0.25;
/** 1u = this share of the bankroll, for log-growth. */
export const UNIT_SHARE = 0.01;

/** Break-even chance at an American price (vig in). */
export const breakEven = (price: number) => (price < 0 ? -price / (-price + 100) : 100 / (price + 100));
/** Profit on 1u risked at an American price. */
export const profit = (price: number) => (price < 0 ? 100 / -price : price / 100);
/** A cost per $1 contract (Kalshi, 0..1) as an American price, so cost-priced bets size like the rest. */
export const costToAmerican = (cost: number) => (cost <= 0.5 ? (100 * (1 - cost)) / cost : (-100 * cost) / (1 - cost));

const r2 = (x: number) => Math.round(x * 100) / 100;
const r4 = (x: number) => Math.round(x * 10000) / 10000;

export interface StakeInput {
  /** Our win chance on the side. */
  p: number;
  /** American price. */
  price: number;
}

/** Quarter Kelly in units at chance p, before the min and the cap. */
function kellyRaw(p: number, price: number): number {
  const b = profit(price);
  return (((p * (b + 1) - 1) / b) * KELLY) / UNIT_SHARE;
}

function kellyUnits(p: number, price: number): number {
  const raw = kellyRaw(p, price);
  if (!(raw > 0)) return 0;
  return Math.min(MAX_UNITS, Math.max(KELLY_MIN, Math.round(raw / KELLY_MIN) * KELLY_MIN));
}

/**
 * Units risked on one bet under a scheme; 0 = no bet. `edgeBar` is the
 * section's edge bar in points over break-even (default 0: every section's
 * widest slice bets any chance above break-even).
 */
export function stakeFor(scheme: SchemeId, bet: StakeInput, edgeBar = 0): number {
  const { p, price } = bet;
  if (scheme === "flat") return 1;
  if (!Number.isFinite(p) || !Number.isFinite(price) || price === 0 || (price > -100 && price < 100)) return 0;
  if (scheme === "towin") return r2(Math.min(MAX_UNITS, 1 / profit(price)));
  if (scheme === "kelly25") return kellyUnits(p, price);
  if (scheme === "kelly25shrunk") return kellyUnits((p + breakEven(price)) / 2, price);
  // edge: points of chance over the break-even
  const pts = (p - breakEven(price)) * 100;
  if (pts < edgeBar - 1e-9) return 0;
  return Math.min(MAX_UNITS, 1 + 0.5 * Math.floor((pts - edgeBar) / 3 + 1e-9));
}

/** A graded bet that can be sized: our chance and the saved price are known. */
export type Sizable = Bet & { p: number; price: number };
export const sizable = (b: Bet): b is Sizable => typeof b.p === "number" && typeof b.price === "number" && Number.isFinite(b.p) && Number.isFinite(b.price);

const byTime = (a: Bet, b: Bet) => a.at.localeCompare(b.at) || a.game.localeCompare(b.game) || (a.key ?? "").localeCompare(b.key ?? "");

/** One bet's log-growth at `units` risked: log(1 + 1% x units x return per unit). */
const growth = (units: number, net: number) => Math.log(Math.max(1e-9, 1 + UNIT_SHARE * units * net));

export interface SchemeStats {
  scheme: SchemeId;
  /** Bets the scheme stakes (stake above 0). */
  bets: number;
  units: number;
  /** Units risked on bets that settled (pushes give the stake back). */
  risked: number;
  /** Units won per unit risked. */
  roi: number;
  /** Largest fall from a running high, in units, bet by bet in kickoff order. */
  drawdown: number;
  /** Sum of log(1 + 1% x stake x return): what compounding would make of it. */
  logGrowth: number;
}

/** What one scheme makes of a set of graded bets (only bets with a chance and price). */
export function schemeStats(bets: Bet[], scheme: SchemeId, edgeBar = 0): SchemeStats {
  const list = bets.filter(sizable).sort(byTime);
  let n = 0;
  let units = 0;
  let risked = 0;
  let run = 0;
  let peak = 0;
  let dd = 0;
  let lg = 0;
  for (const b of list) {
    const s = stakeFor(scheme, b, edgeBar);
    if (!(s > 0)) continue;
    n++;
    const won = s * b.net;
    units += won;
    if (b.net !== 0) risked += s;
    run += won;
    peak = Math.max(peak, run);
    dd = Math.max(dd, peak - run);
    lg += growth(s, b.net);
  }
  return { scheme, bets: n, units: r2(units), risked: r2(risked), roi: risked ? r4(units / risked) : 0, drawdown: r2(dd), logGrowth: r4(lg) };
}

// ------------------------------------------------------------- switch rule

export const SWITCH_RULE = { minBets: 200, minWeeks: 4, minT: 1.645 };

export interface SwitchTest {
  scheme: SchemeId;
  bets: number;
  weeks: number;
  /** Scheme's log-growth minus flat's, over the same bets. */
  diff: number;
  /** Paired t on per-bet log-growth differences (scheme minus flat). */
  t: number;
  pass: boolean;
}

function tOf(xs: number[]): number {
  if (xs.length < 2) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((t, x) => t + (x - mean) ** 2, 0) / (xs.length - 1));
  const raw = sd > 0 ? mean / (sd / Math.sqrt(xs.length)) : mean > 0 ? 99 : mean < 0 ? -99 : 0;
  return r2(Math.max(-99, Math.min(99, raw)));
}

/** Does `scheme` beat flat on these graded bets, by the switch rule? */
export function switchTest(bets: Bet[], scheme: SchemeId, edgeBar = 0): SwitchTest {
  const list = bets.filter(sizable);
  const diffs = list.map((b) => growth(stakeFor(scheme, b, edgeBar), b.net) - growth(1, b.net));
  const weeks = new Set(list.map((b) => b.week)).size;
  const t = tOf(diffs);
  const diff = r4(diffs.reduce((a, b) => a + b, 0));
  const pass = scheme !== "flat" && list.length >= SWITCH_RULE.minBets && weeks >= SWITCH_RULE.minWeeks && t >= SWITCH_RULE.minT && diff > 0;
  return { scheme, bets: list.length, weeks, diff, t, pass };
}

export interface StakeChoice {
  scheme: SchemeId;
  /** When it took effect, ISO. */
  at: string;
  why: string;
}

/**
 * The scheme a section's live bets should use, given the one in use. From
 * flat: the passing scheme with the most log-growth, else flat. From another
 * scheme: it stays while its log-growth is still above flat's, else flat.
 */
export function decideScheme(bets: Bet[], current: SchemeId, edgeBar = 0): { scheme: SchemeId; changed: boolean; why: string; tests: SwitchTest[] } {
  const tests = schemesFor(bets).filter((x) => x !== "flat").map((x) => switchTest(bets, x, edgeBar));
  if (current !== "flat") {
    const t = tests.find((x) => x.scheme === current);
    // A scheme no longer allowed for the section (to win 1u on long odds) goes back to flat.
    if (!t) return { scheme: "flat", changed: true, why: `${SCHEME[current].label} isn't used on long-odds sections, so stakes go back to flat 1u`, tests };
    if (t.diff > 0) return { scheme: current, changed: false, why: `${SCHEME[current].label} still beats flat (log-growth ${t.diff >= 0 ? "+" : ""}${t.diff}, t ${t.t}, ${t.bets} bets)`, tests };
    return { scheme: "flat", changed: true, why: `${SCHEME[current].label} fell below flat on log-growth (${t.diff}, t ${t.t}, ${t.bets} bets), so stakes go back to flat 1u`, tests };
  }
  const best = tests.filter((x) => x.pass).sort((a, b) => b.diff - a.diff)[0];
  if (!best) return { scheme: "flat", changed: false, why: "No scheme beats flat by the rule yet", tests };
  return {
    scheme: best.scheme,
    changed: true,
    why: `${SCHEME[best.scheme].label} beats flat on log-growth over ${best.bets} graded bets in ${best.weeks} weeks (+${best.diff}, t ${best.t} vs ${SWITCH_RULE.minT}), so live bets stake that way from now on`,
    tests,
  };
}

// ------------------------------------------------------------------- views

/**
 * The bets a section's staking is judged on: its widest slice (the first
 * candidate with no parent whose bets carry a chance and price, "every edge"
 * in each section's own order). Undefined when no slice can be sized.
 */
export function stakingBase<C extends { id: string; label: string; parent?: string; bets: Bet[] }>(cands: C[]): C | undefined {
  return cands.find((c) => !c.parent && c.bets.some(sizable));
}

export interface StakingTable {
  /** The slice the table is on. */
  base: string;
  baseLabel: string;
  rows: SchemeStats[];
  /** Graded bets in the slice with no saved chance or price (left out of every row). */
  missing: number;
  inUse: SchemeId;
  since?: string;
  tests: SwitchTest[];
}

/** Every scheme on a section's widest slice, with the switch tests, for the Results page. */
export function stakingTable(base: { id: string; label: string; bets: Bet[] }, inUse: SchemeId = "flat", since?: string, edgeBar = 0): StakingTable {
  return {
    base: base.id,
    baseLabel: base.label,
    rows: schemesFor(base.bets).map((x) => schemeStats(base.bets, x, edgeBar)),
    missing: base.bets.filter((b) => !sizable(b)).length,
    inUse,
    ...(since ? { since } : {}),
    tests: schemesFor(base.bets).filter((x) => x !== "flat").map((x) => switchTest(base.bets, x, edgeBar)),
  };
}

/**
 * Our saved chance per market and side from a board's `extra` (our NBA and
 * NFL props boards), as GradedPropsGame.chance. Empty object when none.
 */
export function chanceOf(extra: { [id: string]: { over?: number; under?: number } } | undefined): { chance?: { [id: string]: { over: number; under: number } } } {
  if (!extra) return {};
  const chance: { [id: string]: { over: number; under: number } } = {};
  for (const [id, x] of Object.entries(extra)) if (typeof x?.over === "number" && typeof x?.under === "number") chance[id] = { over: x.over, under: x.under };
  return Object.keys(chance).length ? { chance } : {};
}
