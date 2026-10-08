// How much to bet: 0.25u to 5u, and when a two-leg parlay is worth it. Pure.
//
// A stake needs a win probability, and a cut's raw record is a poor one: a
// 14-2 rule is not an 87% bet. So each record is pulled toward 50% as if it
// had already gone 50-50 over PRIOR_GAMES games (100: about a season of plays
// before the record outweighs the doubt). 14-2 reads as 55.2%, 14-6 as 53.3%.
//
// The stake is a quarter of the Kelly bet for that probability at the actual
// price, with 1u = 1% of bankroll, rounded to the quarter unit and capped at
// 5u. Under a quarter unit it is not a bet: the price has eaten the edge
// (the page and email say so). Reaching 5u takes a long record at ~60%+.
//
// Parlays: two legs, different games, same sport, each leg a bet in its own
// right. Worth sending only when the pair's estimated edge (joint probability
// times the parlay payout, less one) is 10% or more; the bar is that high
// because errors in each leg's probability multiply. Staked at an eighth
// Kelly, 0.25u to 1u. Legs in different games are treated as independent.

export const PRIOR_GAMES = 100;
export const KELLY_SCALE = 0.25;
export const MIN_STAKE = 0.25;
export const MAX_STAKE = 5;
export const PARLAY_MIN_EDGE = 0.1;
export const PARLAY_KELLY = 0.125;
export const PARLAY_MAX = 1;
export const MAX_PARLAYS = 2;
/**
 * Most units at risk per sport on one card, parlays included. Every bet on a
 * card leans on the same estimate of how good the rule is, so if the rule is
 * really a coin flip they all lose together; a week heavy with plays is
 * scaled down rather than staked as if the bets were independent.
 */
export const WEEKLY_CAP = 15;

/** American price to decimal payout per unit risked (stake included). */
export function decimal(price: number): number {
  return 1 + (price < 0 ? 100 / -price : price / 100);
}

/** The record's win rate pulled toward 50% by PRIOR_GAMES. */
export function shrunk(w: number, l: number): number {
  return (w + PRIOR_GAMES / 2) / (w + l + PRIOR_GAMES);
}

/** Full Kelly fraction of bankroll for win probability p at this price (negative: no edge). */
export function kelly(p: number, price: number): number {
  const b = decimal(price) - 1;
  return (b * p - (1 - p)) / b;
}

const quarter = (x: number) => Math.round(x * 4) / 4;

/** Units to risk, 0 when the price leaves no bet worth a quarter unit. */
export function stakeFor(p: number, price: number): number {
  const raw = KELLY_SCALE * kelly(p, price) * 100;
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

/** Stakes every Tier 1/2 game at a reference line from its tier's record, and returns the parlays worth sending. */
export function stakeBoard<
  G extends { home: string; away: string; tier: string; basis?: string; side?: "home" | "away"; ref?: { homePrice?: number; awayPrice?: number } },
>(board: G[], records: { t1?: { w: number; l: number }; t2?: { w: number; l: number } }, week: number | null): { board: (G & { p?: number; price?: number; stake?: number })[]; parlays: ParlayPick[] } {
  const staked = board.map((g): G & { p?: number; price?: number; stake?: number } => {
    const rec = g.tier === "t1" ? records.t1 : g.tier === "t2" ? records.t2 : undefined;
    if (!rec || g.basis !== "reference" || !g.side) return g;
    const p = shrunk(rec.w, rec.l);
    const price = (g.side === "home" ? g.ref?.homePrice : g.ref?.awayPrice) ?? -110;
    return { ...g, p, price, stake: stakeFor(p, price) };
  });
  // Over the cap: scale every stake down by the same factor, never below a quarter unit.
  const total = staked.reduce((t, g) => t + (g.stake ?? 0), 0);
  if (total > WEEKLY_CAP * 0.8) {
    const k = (WEEKLY_CAP * 0.8) / total;
    for (const g of staked) if (g.stake) g.stake = Math.max(MIN_STAKE, Math.floor(g.stake * k * 4) / 4);
  }
  const legs: Leg[] = staked.flatMap((g) =>
    g.stake && g.p !== undefined && g.price !== undefined
      ? [{ id: `${week}:${g.away}@${g.home}`, game: `${week}:${g.away}@${g.home}`, p: g.p, price: g.price }]
      : [],
  );
  // Parlays get the rest of the cap (singles are capped at 80% of it above).
  const room = WEEKLY_CAP - staked.reduce((t, g) => t + (g.stake ?? 0), 0);
  const parlays: ParlayPick[] = [];
  let used = 0;
  for (const pr of pickParlays(legs)) {
    if (used + pr.units > room) break;
    parlays.push(pr);
    used += pr.units;
  }
  return { board: staked, parlays };
}
