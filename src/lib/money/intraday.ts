import type { Intraday, IntradayRow, IntradayStats } from "./types";

// Plain reads of the intraday desk's snapshot (trade-bot tradebot/intraday.py),
// kept pure so the page and the tests share them.

/** Under this many graded breakouts on either side, taken vs shadow is noise. */
export const FILTER_MIN = 30;
/** A gap in average R smaller than this reads as "no clear difference". */
export const FILTER_GAP = 0.05;

export type FilterRead =
  | { kind: "empty"; text: string }
  | { kind: "early"; text: string }
  | { kind: "helping" | "hurting" | "even"; text: string; gap: number };

const r2 = (x: number) => `${x > 0 ? "+" : x < 0 ? "-" : ""}${Math.abs(x).toFixed(2)}R`;

/** Is the Time Machine filter helping? Compares the trades it took with the ones it turned down, replayed. */
export function filterRead(taken?: IntradayStats | null, shadow?: IntradayStats | null): FilterRead {
  const t = taken?.n ?? 0;
  const s = shadow?.n ?? 0;
  if (!t && !s) return { kind: "empty", text: "Nothing graded yet. The comparison starts after the first session closes." };
  if (t < FILTER_MIN || s < FILTER_MIN || taken?.meanR == null || shadow?.meanR == null) {
    return {
      kind: "early",
      text: `Too early to tell: ${t} taken and ${s} turned down are graded, and it needs ${FILTER_MIN} on each side before the gap means anything.`,
    };
  }
  const gap = taken.meanR - shadow.meanR;
  if (gap >= FILTER_GAP) return { kind: "helping", gap, text: `Helping: the trades it took average ${r2(taken.meanR)}, the ones it turned down ${r2(shadow.meanR)}.` };
  if (gap <= -FILTER_GAP) return { kind: "hurting", gap, text: `Hurting: the ones it turned down average ${r2(shadow.meanR)}, better than the ${r2(taken.meanR)} on the trades it took.` };
  return { kind: "even", gap, text: `No clear difference yet: taken ${r2(taken.meanR)} against turned down ${r2(shadow.meanR)}.` };
}

const rowKey = (r: IntradayRow) => `${r.day}|${r.symbol}|${r.trigger_time ?? ""}`;

/** Open trades, minus any the day's rows already show as closed (a snapshot can carry both mid-replay). */
export function openTrades(d: Intraday): IntradayRow[] {
  const closed = new Set((d.today ?? []).filter((r) => r.outcome !== null).map(rowKey));
  return (d.open ?? []).filter((r) => r.outcome === null && !closed.has(rowKey(r)));
}

/** The day's breakouts: taken first, then by trigger time, latest first. */
export function todayRows(d: Intraday): IntradayRow[] {
  return [...(d.today ?? [])]
    .filter((r) => r.decision !== "stale")
    .sort((a, b) => (a.decision === "taken" ? 0 : 1) - (b.decision === "taken" ? 0 : 1) || (b.trigger_time ?? "").localeCompare(a.trigger_time ?? ""));
}

/** Time Machine's target-first chance among replays that reached a side, the number the filter grades. */
export function decidedOdds(r: IntradayRow): number | null {
  if (r.p_target == null || r.p_stop == null || r.p_target + r.p_stop <= 0) return null;
  return r.p_target / (r.p_target + r.p_stop);
}

export interface IntradayHead {
  start: number;
  equity: number;
  ret: number;
  spyRet: number | null;
  /** Desk minus SPY, both from the same start. */
  edge: number | null;
  asOf: string | null;
  waiting: boolean;
}

export function intradayHead(d: Intraday): IntradayHead {
  const start = d.start ?? 100_000;
  const equity = d.equity ?? start;
  const ret = equity / start - 1;
  const spyRet = d.spyEquity != null ? d.spyEquity / start - 1 : null;
  return { start, equity, ret, spyRet, edge: spyRet !== null ? ret - spyRet : null, asOf: d.asOf ?? null, waiting: !(d.curve ?? []).length };
}
