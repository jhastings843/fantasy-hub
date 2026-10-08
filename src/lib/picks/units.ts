// Units: what each bet is worth, and the running +/- per sport. Pure.
//
// Staking is flat by tier, because nothing here has proven an edge big or
// stable enough to size bets by: Tier 1 is 1 unit, Tier 2 half a unit, and
// a totals play (once a totals rule exists) 1 unit. A unit is "to win": a
// 1u bet at -110 risks 1.1u to win 1u, the same convention the backtest's
// units use, so the two read on one scale. Each bet is graded at the price
// on the quote it was sent with (DraftKings via ESPN); a bet sent without a
// price is graded at -110 and counted as such.
//
// Only bets that went out with a stake count. The Week 5 card predates
// units, so its plays stay in the win-loss record but not in the unit total.

import type { Result } from "./engine";
import type { IssuedRecord } from "./issued";
import { gradeTotal } from "./totals";
import { grade, key } from "./engine";
import type { Slot } from "./update";

export const STAKE = { t1: 1, t2: 0.5, total: 1 } as const;

/** The default price when a quote carried none. */
export const DEFAULT_PRICE = -110;

/** Units risked on a to-win stake at an American price. */
export function risk(units: number, price: number): number {
  return price < 0 ? (units * -price) / 100 : (units * 100) / price;
}

/** Units won or lost: a win pays the stake, a loss costs the risk, a push nothing. */
export function payout(result: Result, units: number, price: number): number {
  return result === "W" ? units : result === "L" ? -risk(units, price) : 0;
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
  l.risked += risk(units, price);
}

function finish(l: Ledger): Ledger {
  return { ...l, units: Math.round(l.units * 100) / 100, risked: Math.round(l.risked * 100) / 100, roi: l.risked ? l.units / l.risked : 0 };
}

export interface UnitReport {
  total: Ledger;
  byTier: { t1: Ledger; t2: Ledger; totals: Ledger };
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
  const byTier = { t1: empty(), t2: empty(), totals: empty() };
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
  }
  return {
    total: finish(total),
    byTier: { t1: finish(byTier.t1), t2: finish(byTier.t2), totals: finish(byTier.totals) },
    bySlot: { tue: finish(bySlot.tue), sat: finish(bySlot.sat), sun: finish(bySlot.sun) },
    byWeek: [...weeks].filter(([, l]) => l.bets).sort((a, b) => a[0] - b[0]).map(([week, l]) => ({ week, ledger: finish(l) })),
    unstaked,
  };
}

/** "+3.2u" */
export const fmtUnits = (u: number) => `${u >= 0 ? "+" : "−"}${Math.abs(u).toFixed(1)}u`;
