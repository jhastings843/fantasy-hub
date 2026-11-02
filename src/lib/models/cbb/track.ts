// The forward test of our college basketball model. Tracked only: no stakes.
// The backtest (scripts/fit-cbb.mts, 2025-26 from Jan 15, which no fit saw)
// found the blend about as good as T-Rank alone and a little behind the
// closing line: 50.8% on every spread at the close, totals nothing, but the
// line moved toward our spread side from open to close (+0.11 pts, t 3.9)
// and leans of 5+ points went 37-24 at the opener (retrospective: the
// backtest's projection can postdate the opener, so treat it as a hint). Live, each game is judged
// at the first price we saved a number at, and against the close.
//
// Signals, thresholds fixed from the backtest before any live game:
//   lean      our spread side, any size
//   strong    our spread side, params.strong+ pts off the market (top 30% on the fit half, 2.94 on 2025-26)
//   big       our spread side, 5+ pts off the market
//   agree     our ratings and T-Rank both on the same side of the market
//   total     our total's side, over or under
//   strongT   our total's side, params.strongTotal+ pts off (top 30%, 5.08)
//   winner    our straight-up winner, at the moneyline
// A signal earns a closer look at GATE games over GATE weeks with average
// CLV above zero at t >= 1.645. Pure.

import { payout } from "./lines";

export const SIGNALS = [
  { id: "lean", label: "Our spread side, any size", market: "ats" },
  { id: "strong", label: "Our spread side, top 30% of gaps", market: "ats" },
  { id: "big", label: "Our spread side, 5+ pts", market: "ats" },
  { id: "agree", label: "Ours and T-Rank on the same side", market: "ats" },
  { id: "total", label: "Our total, over or under", market: "ou" },
  { id: "strongT", label: "Our total, top 30% of gaps", market: "ou" },
  { id: "winner", label: "Our winner, every game", market: "su" },
] as const;
export type SignalId = (typeof SIGNALS)[number]["id"];
export type CbbMarket = "ats" | "ou" | "su";
export type Side = "home" | "away" | "over" | "under";
export const GATE = { games: 200, weeks: 4, t: 1.645 };

export interface CbbSnap {
  at: string;
  spread: number | null;
  homePrice?: number;
  awayPrice?: number;
  total: number | null;
  overPrice?: number;
  underPrice?: number;
  mlHome?: number;
  mlAway?: number;
  open: { spread: number | null; total: number | null };
  /** Our blended home spread and total, win chance; ours and T-Rank's margins apart. */
  ours: { spread: number; total: number; homeWin: number };
  parts: { ours: { margin: number; total: number }; trank: { margin: number; total: number } | null };
}

export interface TrackedCbbGame {
  event: string;
  /** ESPN team ids and short names. */
  home: string;
  away: string;
  homeName: string;
  awayName: string;
  tip: string;
  neutral: boolean;
  /** Conference game (saved from 2026-11-02 evening on; older rows leave it out). */
  conf?: boolean;
  first: CbbSnap;
  last: CbbSnap;
  close?: { spread: number | null; total: number | null };
  final?: { home: number; away: number };
}

export interface Strong {
  strong: number;
  strongTotal: number;
}

/** Which signals fire on a snapshot, and for which side. */
export function signalsOf(s: CbbSnap, p: Strong): { id: SignalId; side: Side }[] {
  const out: { id: SignalId; side: Side }[] = [];
  if (s.spread !== null) {
    const edge = s.spread - s.ours.spread; // >0: our home number is better than the market's: home
    if (edge !== 0) {
      const side: Side = edge > 0 ? "home" : "away";
      out.push({ id: "lean", side });
      if (Math.abs(edge) >= p.strong) out.push({ id: "strong", side });
      if (Math.abs(edge) >= 5) out.push({ id: "big", side });
      const t = s.parts.trank;
      if (t) {
        const a = s.parts.ours.margin + s.spread;
        const b = t.margin + s.spread;
        if (a !== 0 && Math.sign(a) === Math.sign(b)) out.push({ id: "agree", side: a > 0 ? "home" : "away" });
      }
    }
  }
  if (s.total !== null && s.ours.total !== s.total) {
    const side: Side = s.ours.total > s.total ? "over" : "under";
    out.push({ id: "total", side });
    if (Math.abs(s.ours.total - s.total) >= p.strongTotal) out.push({ id: "strongT", side });
  }
  if (s.ours.homeWin !== 0.5) out.push({ id: "winner", side: s.ours.homeWin > 0.5 ? "home" : "away" });
  return out;
}

/** Points of closing-line value for a side taken at the first number (spreads and totals only). */
export function clv(side: Side, first: CbbSnap, close: { spread: number | null; total: number | null }): number | null {
  if (side === "home" || side === "away") {
    if (close.spread === null || first.spread === null) return null;
    return side === "home" ? first.spread - close.spread : close.spread - first.spread;
  }
  if (close.total === null || first.total === null) return null;
  return side === "over" ? close.total - first.total : first.total - close.total;
}

/** Units on a 1u stake for a signal at the first number: -110 on spreads and totals without a price, the saved moneyline for winners (null without one). */
export function graded(id: SignalId, side: Side, first: CbbSnap, f: { home: number; away: number }): { r: number; u: number } | null {
  const mk = SIGNALS.find((x) => x.id === id)!.market;
  if (mk === "su") {
    const won = side === "home" ? f.home > f.away : f.away > f.home;
    const pr = side === "home" ? first.mlHome : first.mlAway;
    // No moneyline saved, no bet: it counts nowhere, so an unpriced game can't pad the gate.
    if (pr === undefined) return null;
    return { r: won ? 1 : -1, u: won ? payout(pr) : -1 };
  }
  const line = mk === "ats" ? first.spread : first.total;
  if (line === null) return null;
  const d = mk === "ats" ? (f.home - f.away + line) * (side === "home" ? 1 : -1) : (f.home + f.away - line) * (side === "over" ? 1 : -1);
  const pr = side === "home" ? first.homePrice : side === "away" ? first.awayPrice : side === "over" ? first.overPrice : first.underPrice;
  const r = d > 0 ? 1 : d < 0 ? -1 : 0;
  return { r, u: r > 0 ? payout(pr ?? -110) : r < 0 ? -1 : 0 };
}

export interface SignalRecord {
  id: SignalId;
  label: string;
  market: CbbMarket;
  games: number;
  weeks: number;
  w: number;
  l: number;
  p: number;
  units: number;
  clv: number | null;
  t: number | null;
  verdict: "collecting" | "closer look" | "no edge";
}

const weekOf = (iso: string) => {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};

export function signalRecords(games: TrackedCbbGame[], p: Strong): SignalRecord[] {
  return SIGNALS.map(({ id, label, market }) => {
    const rows = games.flatMap((g) => signalsOf(g.first, p).filter((x) => x.id === id).map((x) => ({ g, side: x.side })));
    let w = 0;
    let l = 0;
    let pu = 0;
    let units = 0;
    for (const { g, side } of rows) {
      if (!g.final) continue;
      const x = graded(id, side, g.first, g.final);
      if (!x) continue;
      if (x.r > 0) w++;
      else if (x.r < 0) l++;
      else pu++;
      units += x.u;
    }
    const clvs = market === "su" ? [] : rows.flatMap(({ g, side }) => {
      const v = g.close ? clv(side, g.first, g.close) : null;
      return v === null ? [] : [v];
    });
    const mean = clvs.length ? clvs.reduce((a, v) => a + v, 0) / clvs.length : null;
    const sd = clvs.length > 1 && mean !== null ? Math.sqrt(clvs.reduce((a, v) => a + (v - mean) ** 2, 0) / (clvs.length - 1)) : null;
    const t = mean !== null && sd ? mean / (sd / Math.sqrt(clvs.length)) : null;
    const weeks = new Set(rows.map(({ g }) => weekOf(g.tip))).size;
    const enough = (market === "su" ? w + l : clvs.length) >= GATE.games && weeks >= GATE.weeks;
    return {
      id,
      label,
      market,
      games: rows.length,
      weeks,
      w,
      l,
      p: pu,
      units: Math.round(units * 100) / 100,
      clv: mean === null ? null : Math.round(mean * 100) / 100,
      t: t === null ? null : Math.round(t * 100) / 100,
      verdict: market === "su" ? (!enough ? "collecting" : units > 0 ? "closer look" : "no edge") : !enough ? "collecting" : t !== null && t >= GATE.t && (mean ?? 0) > 0 ? "closer look" : "no edge",
    };
  });
}
