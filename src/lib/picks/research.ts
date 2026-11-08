// Research cuts: each refinement next to the cut it narrows, and PEM's
// contribution on identical games. Pure.
//
// Nothing here can become the rule. The point is to see whether being more
// specific helps, so every row carries the parent's record and the record of
// the parent games the refinement leaves out: a refinement that "wins" only
// because the games it drops happened to lose is no better than its parent.

import { type ClosingLine, clvPoints, pemSplitLine } from "./closing";
import {
  type Cut,
  type CutResult,
  type GradedGame,
  type Record,
  type Result,
  cutResult,
  grade,
  key,
  tally,
} from "./engine";

export interface ClvSummary {
  /** Average points better than the close. */
  avg: number;
  /** Picks with a closing line on file. */
  n: number;
}

export interface ResearchRow {
  id: string;
  label: string;
  record: Record;
  weeks: number[];
  clv: ClvSummary;
  parent: { id: string; label: string; record: Record };
  /** The parent's games this refinement leaves out. */
  excluded: Record;
}

/** The home-side line a cut's pick on this game was graded at, and the side. */
function pickAt(g: GradedGame, cut: Cut): { side: "home" | "away"; homeLine: number } | null {
  const r = g.read;
  if (cut.test.pemSplit) return r.pemSide ? { side: r.pemSide, homeLine: pemSplitLine(g) } : null;
  if (cut.test.splitHome) {
    if (r.agree || (r.samSide !== "home" && r.davidSide !== "home")) return null;
    return { side: "home", homeLine: r.samSide === "home" ? g.sam.market : g.david.market };
  }
  if (!r.side || r.line === undefined) return null;
  return { side: r.side, homeLine: r.side === "home" ? r.line : -r.line };
}

function clvOf(games: GradedGame[], cut: Cut, closes: Map<string, ClosingLine>): ClvSummary {
  const vs = games.flatMap((g) => {
    const c = closes.get(key(g))?.close;
    const p = pickAt(g, cut);
    return p && c !== null && c !== undefined ? [clvPoints(p.side, p.homeLine, c)] : [];
  });
  return { avg: vs.length ? Math.round((vs.reduce((a, b) => a + b, 0) / vs.length) * 100) / 100 : 0, n: vs.length };
}

export function researchRows(
  games: GradedGame[],
  cuts: CutResult[],
  closes: Map<string, ClosingLine>,
): ResearchRow[] {
  const byId = new Map(cuts.map((c) => [c.id, c]));
  return cuts
    .filter((c) => c.group === "Research" && c.parent && byId.has(c.parent))
    .map((c) => {
      const parent = byId.get(c.parent!)!;
      const inCut = games.filter((g) => cutResult(g, c) !== undefined);
      const left = games.filter((g) => cutResult(g, parent) !== undefined && cutResult(g, c) === undefined);
      return {
        id: c.id,
        label: c.label,
        record: c.record,
        weeks: c.weeks,
        clv: clvOf(inCut, c, closes),
        parent: { id: parent.id, label: parent.label, record: parent.record },
        excluded: tally(left.map((g) => cutResult(g, parent) as Result)),
      };
    });
}

// --------------------------------------------------------------------- PEM

export interface PemCompareRow {
  id: string;
  label: string;
  record: Record;
  clv: ClvSummary;
}

/**
 * PEM against Sam and David on exactly the games all three cover, every model
 * judged at ONE line: the average of Sam's and David's market numbers, both
 * of which were posted before the game. Graded at that same line, so the rows
 * are comparable to each other (not to the main backtest, which grades at
 * each site's own number).
 */
export function pemCompare(
  games: GradedGame[],
  closes: Map<string, ClosingLine>,
): { rows: PemCompareRow[]; games: number; weeks: number[] } {
  const covered = games.filter((g) => g.pem);
  const buckets: { [id: string]: { side: "home" | "away"; line: number; g: GradedGame }[] } = {
    agree: [],
    "agree-pem": [],
    "agree-not-pem": [],
    split: [],
    pem: [],
  };
  for (const g of covered) {
    const line = (g.sam.market + g.david.market) / 2;
    const sideOf = (model: number): "home" | "away" | null => (model === line ? null : model < line ? "home" : "away");
    const sam = sideOf(g.sam.model);
    const david = sideOf(g.david.model);
    const pem = sideOf(g.pem!.model);
    if (pem) buckets.pem.push({ side: pem, line, g });
    if (sam && david && sam === david) {
      buckets.agree.push({ side: sam, line, g });
      if (pem === sam) buckets["agree-pem"].push({ side: sam, line, g });
      else if (pem) buckets["agree-not-pem"].push({ side: sam, line, g });
    } else if (sam && david && pem) {
      buckets.split.push({ side: pem, line, g });
    }
  }
  const row = (id: string, label: string): PemCompareRow => {
    const picks = buckets[id];
    const vs = picks.flatMap((p) => {
      const c = closes.get(key(p.g))?.close;
      return c !== null && c !== undefined ? [clvPoints(p.side, p.line, c)] : [];
    });
    return {
      id,
      label,
      record: tally(picks.map((p) => grade(p.g.final, p.line, p.side))),
      clv: { avg: vs.length ? Math.round((vs.reduce((a, b) => a + b, 0) / vs.length) * 100) / 100 : 0, n: vs.length },
    };
  };
  return {
    rows: [
      row("agree", "Sam and David agree"),
      row("agree-pem", "...and PEM agrees"),
      row("agree-not-pem", "...and PEM disagrees"),
      row("split", "Sam and David split: PEM's side"),
      row("pem", "PEM alone"),
    ],
    games: covered.length,
    weeks: [...new Set(covered.map((g) => g.week))].sort((a, b) => a - b),
  };
}

// ------------------------------------------------------------------- Venom

/**
 * Venom's Game Cheat Code (NFL) on the games he covers, like pemCompare: every
 * spread row judged and graded at one line, the average of Sam's and David's
 * posted market numbers. Two more spread rows for his own "VENOM EDGE" flag, and
 * his totals: his side of the total he showed, graded on the final score. The
 * totals use the market number printed on his board (backfilled weeks were read
 * after the games, so that number may be a late one); no CLV for them.
 */
export function venomCompare(
  games: GradedGame[],
  closes: Map<string, ClosingLine>,
): { rows: PemCompareRow[]; games: number; weeks: number[] } {
  const covered = games.filter((g) => g.venom);
  const b: { [id: string]: { side: "home" | "away"; line: number; g: GradedGame }[] } = { agree: [], "agree-v": [], "agree-not-v": [], split: [], venom: [], flag: [] };
  const tot: { [id: string]: Result[] } = { total: [], "total-flag": [], "total-3": [] };
  for (const g of covered) {
    const v = g.venom!;
    const line = (g.sam.market + g.david.market) / 2;
    const sideOf = (model: number): "home" | "away" | null => (model === line ? null : model < line ? "home" : "away");
    const sam = sideOf(g.sam.model), david = sideOf(g.david.model), ven = sideOf(v.model);
    if (ven) b.venom.push({ side: ven, line, g });
    if (v.edgeSide) b.flag.push({ side: v.edgeSide, line, g });
    if (sam && david && sam === david) {
      b.agree.push({ side: sam, line, g });
      if (ven === sam) b["agree-v"].push({ side: sam, line, g });
      else if (ven) b["agree-not-v"].push({ side: sam, line, g });
    } else if (sam && david && ven) b.split.push({ side: ven, line, g });
    const pts = g.final.home + g.final.away;
    if (v.modelTotal !== v.total) {
      const over = v.modelTotal > v.total;
      const r: Result = pts === v.total ? "P" : (pts > v.total) === over ? "W" : "L";
      tot.total.push(r);
      if (Math.abs(v.modelTotal - v.total) >= 3) tot["total-3"].push(r);
    }
    if (v.edgeTotal) tot["total-flag"].push(pts === v.total ? "P" : (pts > v.total) === (v.edgeTotal === "over") ? "W" : "L");
  }
  const row = (id: string, label: string): PemCompareRow => {
    const vs = b[id].flatMap((p) => {
      const c = closes.get(key(p.g))?.close;
      return c !== null && c !== undefined ? [clvPoints(p.side, p.line, c)] : [];
    });
    return { id, label, record: tally(b[id].map((p) => grade(p.g.final, p.line, p.side))), clv: { avg: vs.length ? Math.round((vs.reduce((a, x) => a + x, 0) / vs.length) * 100) / 100 : 0, n: vs.length } };
  };
  const trow = (id: string, label: string): PemCompareRow => ({ id, label, record: tally(tot[id]), clv: { avg: 0, n: 0 } });
  return {
    rows: [
      row("agree", "Sam and David agree"),
      row("agree-v", "...and Venom agrees"),
      row("agree-not-v", "...and Venom disagrees"),
      row("split", "Sam and David split: Venom's side"),
      row("venom", "Venom alone, his spread"),
      row("flag", "Venom alone, his EDGE flag on the side"),
      trow("total", "Venom's total, any gap (his board's number)"),
      trow("total-3", "Venom's total, 3+ pts off"),
      trow("total-flag", "Venom's total, his EDGE flag"),
    ],
    games: covered.length,
    weeks: [...new Set(covered.map((g) => g.week))].sort((a, b) => a - b),
  };
}
