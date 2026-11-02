// College hoops on the shared learning engine (lib/learning/engine.ts), the
// same cycle as our college football model (lib/models/cfb/track.ts): each
// slice is a paper bet, 1u at the saved price, on games that tip after the
// slice first registered. The weekly review turns a slice live only past the
// gate (CBB_MODEL_GATE) and against the slice it narrows, rolls it back if it
// then loses, and writes every step to the journal. Nothing is staked.
//
// The same slice definitions grade the 2025-26 backtest (scripts/fit-cbb.mts
// writes backtest.json "slices"), shown beside the live record as background
// evidence only: the engine never sees backtest games, and every live record
// starts at 0-0 on opening night (2026-11-03).
//
// A slice reads a Read: our side, how far off the market, and a few facts
// about the game, all known before tip. Pure.

import type { Bet, Candidate } from "@/lib/learning/engine";
import { payout } from "./lines";
import type { TrackedCbbGame } from "./track";

export const CBB_SECTION = "cbb-model-ours";

export interface Read {
  /** Spread side: ours, points off the market, whether it is the favorite or at home. */
  side: "home" | "away" | null;
  edge: number;
  fav: boolean;
  /** Ours and T-Rank on the same side of the market. Null when T-Rank didn't rate the game. */
  agree: boolean | null;
  /** The line moved from the opener toward our side (true), against (false), not / unknown (null). */
  withMove: boolean | null;
  conf: boolean | null;
  neutral: boolean;
  /** Tip before Dec 15: ratings still settling, rosters new. */
  early: boolean;
  total: { side: "over" | "under"; edge: number; agree: boolean | null } | null;
}

/** Everything a Read needs, from a live snapshot or a backtest row. */
export interface ReadInput {
  spread: number | null;
  openSpread: number | null;
  total: number | null;
  /** Our blended home margin and total; ours and T-Rank's margins and totals apart. */
  margin: number;
  ourTotal: number;
  parts: { ours: { margin: number; total: number }; trank: { margin: number; total: number } | null };
  conf: boolean | null;
  neutral: boolean;
  tip: string;
}

const r1 = (x: number) => Math.round(x * 10) / 10;

export function readOf(x: ReadInput, earlyBefore = "12-15"): Read {
  let side: Read["side"] = null;
  let edge = 0;
  let fav = false;
  let agree: boolean | null = null;
  let withMove: boolean | null = null;
  if (x.spread !== null) {
    const e = x.margin + x.spread; // > 0: home covers by our number
    if (e !== 0) {
      side = e > 0 ? "home" : "away";
      edge = r1(Math.abs(e));
      fav = side === "home" ? x.spread < 0 : x.spread > 0;
      const t = x.parts.trank;
      agree = t ? Math.sign(t.margin + x.spread) === Math.sign(e) : null;
      if (x.openSpread !== null && x.openSpread !== x.spread) withMove = side === "home" ? x.spread < x.openSpread : x.spread > x.openSpread;
    }
  }
  let total: Read["total"] = null;
  if (x.total !== null && x.ourTotal !== x.total) {
    const ts = x.ourTotal > x.total ? "over" : "under";
    const t = x.parts.trank;
    total = { side: ts, edge: r1(Math.abs(x.ourTotal - x.total)), agree: t ? (t.total > x.total ? "over" : "under") === ts : null };
  }
  const md = x.tip.slice(5, 10);
  return { side, edge, fav, agree, withMove, conf: x.conf, neutral: x.neutral, early: md >= "08-01" && md < earlyBefore, total };
}

type Pick = "ours" | "fade" | "total";
type Keep = (r: Read) => boolean;

/** [id, label, parent, which bet, keep]. Thresholds fixed 2026-11-02 before any live game. */
export const CBB_SLICES: [string, string, string | undefined, Pick, Keep][] = [
  ["cbb:lean", "Our side, any edge", undefined, "ours", () => true],
  ["cbb:edge3", "Our side, 3+ pts off the line", "cbb:lean", "ours", (r) => r.edge >= 3],
  ["cbb:edge5", "Our side, 5+ pts off the line", "cbb:edge3", "ours", (r) => r.edge >= 5],
  ["cbb:fade8", "Against our side when we're 8+ pts off (the market knows something)", undefined, "fade", (r) => r.edge >= 8],
  ["cbb:agree", "Our side when ours and T-Rank agree", "cbb:lean", "ours", (r) => r.agree === true],
  ["cbb:split", "Our side when ours and T-Rank split", "cbb:lean", "ours", (r) => r.agree === false],
  ["cbb:home", "Our side when it's the home team", "cbb:lean", "ours", (r) => r.side === "home" && !r.neutral],
  ["cbb:away", "Our side when it's the road team", "cbb:lean", "ours", (r) => r.side === "away" && !r.neutral],
  ["cbb:neutral", "Our side at a neutral site", "cbb:lean", "ours", (r) => r.neutral],
  ["cbb:fav", "Our side when it's the favorite", "cbb:lean", "ours", (r) => r.fav],
  ["cbb:dog", "Our side when it's the underdog", "cbb:lean", "ours", (r) => !r.fav],
  ["cbb:conf", "Our side in conference games", "cbb:lean", "ours", (r) => r.conf === true],
  ["cbb:nonconf", "Our side in non-conference games", "cbb:lean", "ours", (r) => r.conf === false],
  ["cbb:early", "Our side before Dec 15", "cbb:lean", "ours", (r) => r.early],
  ["cbb:with-move", "Our side when the line has moved our way since the open", "cbb:lean", "ours", (r) => r.withMove === true],
  ["cbb:vs-move", "Our side when the line has moved against us since the open", "cbb:lean", "ours", (r) => r.withMove === false],
  ["cbb:total", "Our side of the total, any edge", undefined, "total", (r) => !!r.total],
  ["cbb:total5", "Our side of the total, 5+ pts", "cbb:total", "total", (r) => !!r.total && r.total.edge >= 5],
  ["cbb:under", "The under when we're below the total", "cbb:total", "total", (r) => r.total?.side === "under"],
  ["cbb:over", "The over when we're above the total", "cbb:total", "total", (r) => r.total?.side === "over"],
  ["cbb:total-agree", "Our total when ours and T-Rank agree", "cbb:total", "total", (r) => r.total?.agree === true],
];

/** The bet a slice makes on a read: side and market, or null. */
export function betOf(pick: Pick, r: Read): { market: "ats" | "ou"; side: "home" | "away" | "over" | "under" } | null {
  if (pick === "total") return r.total ? { market: "ou", side: r.total.side } : null;
  if (!r.side) return null;
  return { market: "ats", side: pick === "fade" ? (r.side === "home" ? "away" : "home") : r.side };
}

/** Units on 1u, and the result sign, for a bet at a line and price. */
export function settle(market: "ats" | "ou", side: string, line: number, price: number | undefined, f: { home: number; away: number }) {
  const d = market === "ats" ? (f.home - f.away + line) * (side === "home" ? 1 : -1) : (f.home + f.away - line) * (side === "over" ? 1 : -1);
  const r = Math.sign(d);
  return { r, net: r > 0 ? payout(price ?? -110) : r < 0 ? -1 : 0 };
}

/** Season week for the engine: week 1 starts the Monday on or before Nov 3 (opening week). */
export function cbbWeek(iso: string, season: number): number {
  const start = new Date(Date.UTC(season, 10, 3));
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  return Math.max(1, Math.floor((Date.parse(iso) - start.getTime()) / (7 * 86_400_000)) + 1);
}

export function liveRead(g: TrackedCbbGame): Read {
  const s = g.first;
  return readOf({
    spread: s.spread,
    openSpread: s.open.spread,
    total: s.total,
    margin: -s.ours.spread,
    ourTotal: s.ours.total,
    parts: s.parts,
    conf: g.conf ?? null,
    neutral: g.neutral,
    tip: g.tip,
  });
}

/** Graded games into the engine's candidates, at the first saved price. */
export function cbbCandidates(games: TrackedCbbGame[], season: number): Candidate[] {
  return CBB_SLICES.map(([id, label, parent, pick, keep]) => ({
    id,
    label,
    ...(parent ? { parent } : {}),
    bets: games.flatMap((g): Bet[] => {
      if (!g.final) return [];
      const r = liveRead(g);
      if (!keep(r)) return [];
      const b = betOf(pick, r);
      if (!b) return [];
      const s = g.first;
      const line = b.market === "ats" ? s.spread : s.total;
      if (line === null) return [];
      const price = b.side === "home" ? s.homePrice : b.side === "away" ? s.awayPrice : b.side === "over" ? s.overPrice : s.underPrice;
      const { net } = settle(b.market, b.side, line, price, g.final);
      const close = b.market === "ats" ? g.close?.spread : g.close?.total;
      const clv = close == null ? 0 : b.side === "home" ? line - close : b.side === "away" ? close - line : b.side === "over" ? close - line : line - close;
      return [{ game: g.event, key: `${g.event}|${b.side}`, week: cbbWeek(g.tip, season), at: g.tip, net: Math.round(net * 1000) / 1000, toward: Math.sign(clv) }];
    }),
  }));
}

/** A slice's backtest record (background evidence only). */
export interface SliceBacktest {
  id: string;
  w: number;
  l: number;
  p: number;
  units: number;
  /** Average points the close moved toward the bet from the open, when both are known. */
  move: number | null;
}
