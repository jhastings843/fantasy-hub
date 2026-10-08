// Totals: over/under, the same discipline as the spread side. Pure.
//
// Both sites publish projected scores for every game, so each model has a
// projected total (away + home). Neither publishes the market total it saw,
// and only Sam's record page keeps history, so:
//
//   History, Sam alone: his projected total against ESPN's OPENING total for
//   that game (a pregame number; not necessarily the one Sam saw). Research.
//
//   Agreement history builds forward: the first time both models' totals and
//   a current quote are all on the board together, that triple is archived
//   and never rewritten. Agreement cuts are graded at that archived quote.
//
//   This week: every model judged at ONE current total (DraftKings via ESPN,
//   pregame games only).
//
// A totals rule is chosen exactly as the spread rule is (10+ decided games,
// past 52.4%, highest low end of the 90% range) and until one qualifies the
// totals are shown, never emailed as plays. Cut thresholds were fixed before
// any grading: both models at least 3 points off the total in the NFL (a
// field goal) and 5 in college, where totals run higher and swing wider.

import type { League } from "./parse";
import { BREAK_EVEN, MIN_SAMPLE, type Record, type Result, decided, tally } from "./engine";

export type OU = "over" | "under";

export interface TotalsRead {
  samSide?: OU;
  davidSide?: OU;
  /** Both present, both off the number, same side. */
  agree: boolean;
  side?: OU;
  /** The smaller of the two models' distances from the line. */
  minEdge: number;
  /** |average model total - line|. */
  avgEdge: number;
}

const sideOf = (model: number | undefined, line: number): OU | undefined =>
  model === undefined || model === line ? undefined : model > line ? "over" : "under";

export function readTotal(line: number, sam?: number, david?: number): TotalsRead {
  const samSide = sideOf(sam, line);
  const davidSide = sideOf(david, line);
  const agree = !!samSide && samSide === davidSide;
  const ms = [sam, david].filter((x): x is number => x !== undefined);
  return {
    samSide,
    davidSide,
    agree,
    side: agree ? samSide : undefined,
    minEdge: sam !== undefined && david !== undefined ? Math.min(Math.abs(sam - line), Math.abs(david - line)) : 0,
    avgEdge: ms.length ? Math.abs(ms.reduce((a, b) => a + b, 0) / ms.length - line) : 0,
  };
}

/** Over wins when the final total is above the line. */
export function gradeTotal(points: number, line: number, side: OU): Result {
  const v = side === "over" ? points - line : line - points;
  return v > 0 ? "W" : v < 0 ? "L" : "P";
}

/** Points better than the closing total: an over wants a lower number, an under a higher one. */
export function clvTotal(side: OU, line: number, close: number): number {
  return side === "over" ? close - line : line - close;
}

export interface TotalsTest {
  side?: OU;
  minBothEdge?: number;
}

export interface TotalsCut {
  id: string;
  label: string;
  test: TotalsTest;
}

export const TOTALS_EDGE = { nfl: 3, cfb: 5 } as const;

export function totalsCuts(league: League): TotalsCut[] {
  const e = TOTALS_EDGE[league];
  return [
    { id: "t-agree", label: "Both agree, any edge", test: {} },
    { id: "t-over", label: "Both agree on the over", test: { side: "over" } },
    { id: "t-under", label: "Both agree on the under", test: { side: "under" } },
    { id: `t-both-${e}`, label: `Both ${e}+ off the total`, test: { minBothEdge: e } },
  ];
}

export function totalsMatches(r: TotalsRead, t: TotalsTest): boolean {
  if (!r.agree || !r.side) return false;
  if (t.side && r.side !== t.side) return false;
  if (t.minBothEdge !== undefined && r.minEdge < t.minBothEdge) return false;
  return true;
}

// ------------------------------------------------------------------ history

/** One archived agreement row: both models and the quote, as first seen together. */
export interface TotalsSeen {
  week: number;
  home: string;
  away: string;
  sam: number;
  david: number;
  /** The total both were judged at. */
  line: number;
  source: string;
  seenAt: string;
}

export interface TotalsCutResult extends TotalsCut {
  record: Record;
  games: number;
  weeks: number[];
}

export interface TotalsBacktest {
  cuts: TotalsCutResult[];
  rule: TotalsCutResult | null;
  /** Sam alone at ESPN's opening total, from his record page. */
  samAlone: { record: Record; weeks: number[]; clv: { avg: number; n: number } };
  /** Archived agreement rows that have a final. */
  archived: number;
}

const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : 0);

export function totalsBacktest(
  league: League,
  seen: TotalsSeen[],
  /** Final total points by game key. */
  finals: Map<string, number>,
  samRows: { week: number; home: string; away: string; modelTotal?: number }[],
  /** ESPN opening and closing totals by game key. */
  market: Map<string, { open: number | null; close: number | null }>,
  keyOf: (g: { week: number; home: string; away: string }) => string,
): TotalsBacktest {
  const graded = seen.filter((g) => finals.has(keyOf(g)));
  const cuts = totalsCuts(league).map((cut) => {
    const hits = graded.filter((g) => totalsMatches(readTotal(g.line, g.sam, g.david), cut.test));
    const results = hits.map((g) => gradeTotal(finals.get(keyOf(g))!, g.line, readTotal(g.line, g.sam, g.david).side!));
    return { ...cut, record: tally(results), games: hits.length, weeks: [...new Set(hits.map((g) => g.week))].sort((a, b) => a - b) };
  });
  const rule =
    cuts
      .filter((c) => decided(c.record) >= MIN_SAMPLE && c.record.pct > BREAK_EVEN)
      .sort((a, b) => b.record.lo - a.record.lo || decided(b.record) - decided(a.record))[0] ?? null;

  const results: Result[] = [];
  const clvs: number[] = [];
  const weeks = new Set<number>();
  for (const r of samRows) {
    const k = keyOf(r);
    const m = market.get(k);
    const pts = finals.get(k);
    if (r.modelTotal === undefined || !m || m.open === null || pts === undefined) continue;
    const side = sideOf(r.modelTotal, m.open);
    if (!side) continue;
    results.push(gradeTotal(pts, m.open, side));
    weeks.add(r.week);
    if (m.close !== null) clvs.push(clvTotal(side, m.open, m.close));
  }
  return {
    cuts,
    rule,
    samAlone: { record: tally(results), weeks: [...weeks].sort((a, b) => a - b), clv: { avg: avg(clvs), n: clvs.length } },
    archived: graded.length,
  };
}

// -------------------------------------------------------------------- board

export interface TotalsBoardGame {
  home: string;
  away: string;
  sam?: number;
  david?: number;
  /** The one current total every model is judged at. */
  ref?: TotalsRef;
  read?: TotalsRead;
  /** "t1" only when a totals rule qualifies; otherwise lean, split, one model or no line. */
  tier: "t1" | "lean" | "split" | "one" | "noline";
  /** "Over 47.5". */
  play?: string;
  side?: OU;
  line?: number;
  p?: number;
  price?: number;
  stake?: number;
}

export interface TotalsRef {
  total: number;
  source: string;
  fetchedAt: string;
  overPrice?: number;
  underPrice?: number;
  kickoff?: string;
}

export function totalsBoard(
  rows: { home: string; away: string; sam?: number; david?: number; ref?: TotalsRef }[],
  rule: TotalsCut | null,
): TotalsBoardGame[] {
  return rows.map((row) => {
    if (!row.ref) return { ...row, tier: "noline" };
    if (row.sam === undefined || row.david === undefined) return { ...row, tier: "one" };
    const r = readTotal(row.ref.total, row.sam, row.david);
    if (!r.agree || !r.side) return { ...row, read: r, tier: "split" };
    const play = `${r.side === "over" ? "Over" : "Under"} ${row.ref.total}`;
    const base = { ...row, read: r, play, side: r.side, line: row.ref.total };
    return rule && totalsMatches(r, rule.test) ? { ...base, tier: "t1" } : { ...base, tier: "lean" };
  });
}
