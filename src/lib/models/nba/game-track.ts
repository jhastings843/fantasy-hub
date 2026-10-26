// The forward test of our NBA game model (Jack, 2026-10-26: "add nba
// spreads/totals"). Tracked only: no stakes. The backtest
// (scripts/fit-nba-game.mts, 2025-26 out of sample) found no edge at the
// close (52.4% on every spread, totals nothing), but the line moved toward
// our spread lean between the open and the close by +0.35 pts (t 5.6) on
// schedule alone, more with who was out. Live, the open question is whether
// the injury report we read at the time adds to that.
//
// Each game is judged at the first price we saved our number at, and against
// the close. Signals, thresholds fixed from the backtest before any live game:
//   lean        our spread side, any size
//   strong      our spread side when the predicted residual is 1.02+ pts (top 30%)
//   b2b         against the side on the second night of a back-to-back (the other isn't)
//   total       our rating's total against the market's, over or under
// A signal earns a closer look at GATE games over GATE weeks with average
// CLV above zero at t >= 1.645. Pure.

import type { SpreadX, TotalX } from "./game";

export const SIGNALS = [
  { id: "lean", label: "Our spread lean, any size", market: "spread" },
  { id: "strong", label: "Our spread lean, 1+ pt (top 30%)", market: "spread" },
  { id: "b2b", label: "Fade the back-to-back side", market: "spread" },
  { id: "total", label: "Our rating's total, over or under", market: "total" },
] as const;
export type SignalId = (typeof SIGNALS)[number]["id"];
export type Side = "home" | "away" | "over" | "under";
/** NBA plays most nights, so the bar is games plus enough calendar to span schedule spots. */
export const GATE = { games: 150, weeks: 4, t: 1.645 };

export interface GameSnap {
  at: string;
  /** DraftKings' home spread and total at this read, and their openers. */
  spread: number;
  total: number;
  open: { spread: number | null; total: number | null };
  /** Our home spread and our rating's total. */
  ours: { spread: number; total: number };
  /** Predicted spread residual (home margin minus the market's), and the features. */
  res: number;
  x: { spread: SpreadX; total: TotalX };
  /** Players listed Out we counted, per side. */
  out?: { home: number; away: number };
}

export interface TrackedNbaGame {
  event: string;
  home: string;
  away: string;
  tip: string;
  first: GameSnap;
  last: GameSnap;
  close?: { spread: number | null; total: number | null };
  final?: { home: number; away: number };
}

/** Which signals fire on a snapshot, and for which side. */
export function signalsOf(s: GameSnap, strong: number): { id: SignalId; side: Side }[] {
  const out: { id: SignalId; side: Side }[] = [];
  if (s.res !== 0) {
    const side = s.res > 0 ? "home" : "away";
    out.push({ id: "lean", side });
    if (Math.abs(s.res) >= strong) out.push({ id: "strong", side });
  }
  if (s.x.spread.b2b !== 0) out.push({ id: "b2b", side: s.x.spread.b2b > 0 ? "away" : "home" });
  if (s.ours.total !== s.total) out.push({ id: "total", side: s.ours.total > s.total ? "over" : "under" });
  return out;
}

/** Points of closing-line value for a side taken at the first number. */
export function clv(side: Side, first: GameSnap, close: { spread: number | null; total: number | null }): number | null {
  if (side === "home" || side === "away") return close.spread === null ? null : side === "home" ? first.spread - close.spread : close.spread - first.spread;
  return close.total === null ? null : side === "over" ? close.total - first.total : first.total - close.total;
}

/** +1 win, -1 loss, 0 push, at the first number. */
export function result(side: Side, first: GameSnap, f: { home: number; away: number }): number {
  const d = side === "home" || side === "away" ? (f.home - f.away + first.spread) * (side === "home" ? 1 : -1) : (f.home + f.away - first.total) * (side === "over" ? 1 : -1);
  return d > 0 ? 1 : d < 0 ? -1 : 0;
}

export interface SignalRecord {
  id: SignalId;
  label: string;
  games: number;
  weeks: number;
  w: number;
  l: number;
  p: number;
  /** Units at -110, 1u a game. */
  units: number;
  clv: number | null;
  t: number | null;
  verdict: "collecting" | "closer look" | "no edge";
}

/** Monday of the tip's week (UTC), for counting weeks. */
const weekOf = (iso: string) => {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};

export function signalRecords(games: TrackedNbaGame[], strong: number): SignalRecord[] {
  return SIGNALS.map(({ id, label }) => {
    const rows = games.flatMap((g) => signalsOf(g.first, strong).filter((x) => x.id === id).map((x) => ({ g, side: x.side })));
    let w = 0;
    let l = 0;
    let p = 0;
    for (const { g, side } of rows) {
      if (!g.final) continue;
      const r = result(side, g.first, g.final);
      if (r > 0) w++;
      else if (r < 0) l++;
      else p++;
    }
    const clvs = rows.flatMap(({ g, side }) => {
      const v = g.close ? clv(side, g.first, g.close) : null;
      return v === null ? [] : [v];
    });
    const mean = clvs.length ? clvs.reduce((a, v) => a + v, 0) / clvs.length : null;
    const sd = clvs.length > 1 && mean !== null ? Math.sqrt(clvs.reduce((a, v) => a + (v - mean) ** 2, 0) / (clvs.length - 1)) : null;
    const t = mean !== null && sd ? mean / (sd / Math.sqrt(clvs.length)) : null;
    const weeks = new Set(rows.map(({ g }) => weekOf(g.tip))).size;
    const enough = clvs.length >= GATE.games && weeks >= GATE.weeks;
    return {
      id,
      label,
      games: rows.length,
      weeks,
      w,
      l,
      p,
      units: Math.round((w * (100 / 110) - l) * 100) / 100,
      clv: mean === null ? null : Math.round(mean * 100) / 100,
      t: t === null ? null : Math.round(t * 100) / 100,
      verdict: !enough ? "collecting" : t !== null && t >= GATE.t && (mean ?? 0) > 0 ? "closer look" : "no edge",
    };
  });
}
