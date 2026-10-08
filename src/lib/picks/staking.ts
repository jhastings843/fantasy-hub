// How much a bet wants, before the protected limits (allocate.ts). Pure.
//
// A stake needs a win probability, and a cut's raw record is a poor one: a
// 14-2 rule is not an 87% bet. Each record is pulled toward 50% as if it had
// already gone 50-50 over the policy's prior games (100 at baseline). 14-2
// reads as 55.2%, 14-6 as 53.3%. That is an ESTIMATE from the tier's
// source-line history, not a calibrated probability for a common-line
// recommendation: every issued bet stores it, with the policy version, so
// the strategy review can measure its forward calibration before trusting it
// further.
//
// Kelly policy: the policy's fraction of the Kelly bet at the QUOTED price,
// 1u = 1% of bankroll, rounded to the quarter unit, at most MAX_STAKE. Flat
// policy: the same units on every bet with a positive estimated edge. No
// quoted price, no stake: an assumed -110 is never presented as an offer.
//
// Parlays: pickParlays() stays for the shadow parlay policy only. A product
// of uncalibrated leg estimates times a computed payout (DraftKings' real
// parlay price is not quoted to us) is not a demonstrated edge.

import { BASELINE_POLICY, type StakingPolicy } from "./policy";
import { MAX_STAKE, MIN_STAKE, PARLAY_MAX } from "./limits";

export const PRIOR_GAMES = BASELINE_POLICY.staking.priorGames;
export const PARLAY_MIN_EDGE = 0.1;
export const PARLAY_KELLY = 0.125;
export const MAX_PARLAYS = 2;
/** American price to decimal payout per unit risked (stake included). */
export function decimal(price: number): number {
  return 1 + (price < 0 ? 100 / -price : price / 100);
}

/** The record's win rate pulled toward 50% by the prior's games. */
export function shrunk(w: number, l: number, priorGames = PRIOR_GAMES): number {
  return (w + priorGames / 2) / (w + l + priorGames);
}

/** Full Kelly fraction of bankroll for win probability p at this price (negative: no edge). */
export function kelly(p: number, price: number): number {
  const b = decimal(price) - 1;
  return (b * p - (1 - p)) / b;
}

const quarter = (x: number) => Math.round(x * 4) / 4;

/** Units the policy wants to risk, 0 when the price leaves no bet worth a quarter unit. */
export function stakeFor(p: number, price: number, policy: StakingPolicy = BASELINE_POLICY.staking): number {
  if (kelly(p, price) <= 0) return 0;
  const raw = policy.kind === "flat" ? policy.flatUnits : policy.kellyScale * kelly(p, price) * 100;
  if (raw < MIN_STAKE) return 0;
  return Math.min(MAX_STAKE, Math.max(MIN_STAKE, quarter(raw)));
}

/** The worst American price at which this probability still earns a minimum stake. */
export function worstPrice(p: number): number | null {
  for (let price = -100; price >= -200; price -= 1) {
    if (stakeFor(p, price) === 0) return price === -100 ? null : price + 1;
  }
  return -200;
}

export interface Leg {
  id: string;
  /** Game key, so a parlay never pairs two bets on one game. */
  game: string;
  p: number;
  price: number;
}

export interface ParlayPick {
  legs: [Leg, Leg];
  /** Decimal payout per unit risked. */
  decimal: number;
  /** Estimated joint probability. */
  p: number;
  edge: number;
  units: number;
}

/** The best non-overlapping two-leg parlays, if any clear the bar. */
export function pickParlays(legs: Leg[]): ParlayPick[] {
  const pairs: ParlayPick[] = [];
  for (let i = 0; i < legs.length; i++) {
    for (let j = i + 1; j < legs.length; j++) {
      const a = legs[i];
      const b = legs[j];
      if (a.game === b.game) continue;
      const d = decimal(a.price) * decimal(b.price);
      const p = a.p * b.p;
      const edge = p * d - 1;
      if (edge < PARLAY_MIN_EDGE) continue;
      const f = edge / (d - 1);
      const units = Math.min(PARLAY_MAX, quarter(PARLAY_KELLY * f * 100));
      if (units < MIN_STAKE) continue;
      pairs.push({ legs: [a, b], decimal: Math.round(d * 10000) / 10000, p, edge, units });
    }
  }
  pairs.sort((x, y) => y.edge - x.edge);
  const used = new Set<string>();
  const out: ParlayPick[] = [];
  for (const pr of pairs) {
    if (out.length >= MAX_PARLAYS) break;
    if (pr.legs.some((l) => used.has(l.id))) continue;
    pr.legs.forEach((l) => used.add(l.id));
    out.push(pr);
  }
  return out;
}

/** Decimal odds to American, for display ("+264"). */
export function american(dec: number): string {
  const v = dec >= 2 ? Math.round((dec - 1) * 100) : Math.round(-100 / (dec - 1));
  return v > 0 ? `+${v}` : `${v}`;
}

/** Where a bet's price came from: quoted by the book, or missing (then there is no stake). */
export type PriceSource = "quoted" | "missing";

export interface Wanted {
  p?: number;
  price?: number;
  priceSource?: PriceSource;
  /** What the policy wants before limits; the allocator decides `stake`. */
  want?: number;
  stake?: number;
}

/**
 * The stake each Tier 1/2 game at a reference line WANTS under the policy.
 * The allocator turns wants into stakes; nothing here knows the limits.
 */
export function wantStakes<
  G extends { tier: string; basis?: string; side?: "home" | "away"; ref?: { homePrice?: number; awayPrice?: number } },
>(board: G[], records: { t1?: { w: number; l: number }; t2?: { w: number; l: number } }, policy: StakingPolicy = BASELINE_POLICY.staking): (G & Wanted)[] {
  return board.map((g): G & Wanted => {
    const rec = g.tier === "t1" ? records.t1 : g.tier === "t2" ? records.t2 : undefined;
    if (!rec || g.basis !== "reference" || !g.side) return g;
    const p = shrunk(rec.w, rec.l, policy.priorGames);
    const quoted = g.side === "home" ? g.ref?.homePrice : g.ref?.awayPrice;
    if (quoted === undefined) return { ...g, p, priceSource: "missing", want: 0 };
    return { ...g, p, price: quoted, priceSource: "quoted", want: stakeFor(p, quoted, policy) };
  });
}
