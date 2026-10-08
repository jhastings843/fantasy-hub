// Units: the running +/- per sport for the bets the emails gave. Pure.
//
// Stakes come from staking.ts (0.25u to 5u, quarter Kelly on each tier's
// record pulled toward 50%; parlays 0.25u to 1u). A unit here is RISKED: a
// 2u bet at -110 risks 2u to win 1.82u. Each bet is graded at the price on
// the quote it was sent with (DraftKings via ESPN); a bet sent without a
// price is graded at -110. The backtest's units elsewhere on the page are a
// different, fixed convention (to win 1 at -110) and say so.
//
// Only bets that went out with a stake count. The Week 5 card predates
// units, so its plays stay in the win-loss record but not in the unit total.

import type { Result } from "./engine";
import type { IssuedRecord } from "./issued";
import { gradeTotal } from "./totals";
import { grade, key } from "./engine";
import { decimal } from "./staking";
import type { Slot } from "./update";

/** The default price when a quote carried none. */
export const DEFAULT_PRICE = -110;

/** Units risked: the stake itself. */
export function risk(units: number): number {
  return units;
}

/** Units won or lost on a single: a win pays stake x (decimal - 1), a loss costs the stake, a push nothing. */
export function payout(result: Result, units: number, price: number): number {
  return result === "W" ? units * (decimal(price) - 1) : result === "L" ? -units : 0;
}

/**
 * A parlay: any losing leg loses the stake; a pushed leg drops out (the book
 * re-prices on the rest); all legs pushed returns the stake.
 */
export function parlayPayout(legs: { result: Result; price: number }[], units: number): number {
  if (legs.some((l) => l.result === "L")) return -units;
  const live = legs.filter((l) => l.result === "W");
  if (!live.length) return 0;
  return units * (live.reduce((d, l) => d * decimal(l.price), 1) - 1);
}

export interface Ledger {
  bets: number;
  w: number;
  l: number;
  p: number;
  /** Net units. */
  units: number;
  risked: number;
  /** Net over risked, on settled bets. */
  roi: number;
  pending: number;
}

const empty = (): Ledger => ({ bets: 0, w: 0, l: 0, p: 0, units: 0, risked: 0, roi: 0, pending: 0 });

function add(l: Ledger, result: Result | undefined, units: number, price: number) {
  l.bets++;
  if (!result) {
    l.pending++;
    return;
  }
  if (result === "W") l.w++;
  else if (result === "L") l.l++;
  else l.p++;
  l.units += payout(result, units, price);
  l.risked += risk(units);
}

function finish(l: Ledger): Ledger {
  return { ...l, units: Math.round(l.units * 100) / 100, risked: Math.round(l.risked * 100) / 100, roi: l.risked ? l.units / l.risked : 0 };
}

export interface UnitReport {
  total: Ledger;
  byTier: { t1: Ledger; t2: Ledger; totals: Ledger; parlays: Ledger };
  /** Tuesday's card against game-day additions: are late bets worth it? */
  bySlot: { [s in Slot]: Ledger };
  byWeek: { week: number; ledger: Ledger }[];
  /** Plays sent before units existed: in the W-L record, not here. */
  unstaked: number;
}

/**
 * Every staked bet the emails showed, each game once at its first-sent line
 * (pass records through firstSends first).
 */
export function unitReport(records: IssuedRecord[], finals: Map<string, { home: number; away: number }>): UnitReport {
  const total = empty();
  const byTier = { t1: empty(), t2: empty(), totals: empty(), parlays: empty() };
  const bySlot = { tue: empty(), sat: empty(), sun: empty() };
  const weeks = new Map<number, Ledger>();
  let unstaked = 0;
  for (const rec of records) {
    const slot = rec.slot ?? "tue";
    const wk = weeks.get(rec.week) ?? empty();
    weeks.set(rec.week, wk);
    const settle = (result: Result | undefined, units: number, price: number, tier: Ledger) => {
      for (const l of [total, tier, bySlot[slot], wk]) add(l, result, units, price);
    };
    for (const p of rec.plays) {
      if (!p.shownInEmail) continue;
      if (p.units === undefined) {
        unstaked++;
        continue;
      }
      const f = finals.get(key({ week: rec.week, home: p.home, away: p.away }));
      settle(f ? grade(f, p.homeLine, p.side) : undefined, p.units, p.price ?? DEFAULT_PRICE, byTier[p.tier]);
    }
    for (const t of rec.totals ?? []) {
      if (!t.shownInEmail || t.units === undefined) continue;
      const f = finals.get(key({ week: rec.week, home: t.home, away: t.away }));
      settle(f ? gradeTotal(f.home + f.away, t.line, t.side) : undefined, t.units, t.price ?? DEFAULT_PRICE, byTier.totals);
    }
    for (const pr of rec.parlays ?? []) {
      if (!pr.shownInEmail) continue;
      const legs = pr.legs.map((leg) => {
        const f = finals.get(key({ week: rec.week, home: leg.home, away: leg.away }));
        return f ? { result: grade(f, leg.homeLine, leg.side), price: leg.price } : null;
      });
      // A parlay settles once every leg has (or one leg has lost).
      const lost = legs.some((x) => x?.result === "L");
      const done = lost || legs.every((x) => x);
      for (const l of [total, byTier.parlays, bySlot[slot], wk]) {
        l.bets++;
        if (!done) {
          l.pending++;
          continue;
        }
        const net = parlayPayout(legs.filter((x): x is { result: Result; price: number } => !!x), pr.units);
        if (net > 0) l.w++;
        else if (net < 0) l.l++;
        else l.p++;
        l.units += net;
        l.risked += pr.units;
      }
    }
  }
  return {
    total: finish(total),
    byTier: { t1: finish(byTier.t1), t2: finish(byTier.t2), totals: finish(byTier.totals), parlays: finish(byTier.parlays) },
    bySlot: { tue: finish(bySlot.tue), sat: finish(bySlot.sat), sun: finish(bySlot.sun) },
    byWeek: [...weeks].filter(([, l]) => l.bets).sort((a, b) => a[0] - b[0]).map(([week, l]) => ({ week, ledger: finish(l) })),
    unstaked,
  };
}

/** "+3.2u" */
export const fmtUnits = (u: number) => `${u >= 0 ? "+" : "−"}${Math.abs(u).toFixed(1)}u`;
