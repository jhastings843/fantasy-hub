// The forward test and the edge hunt for our college model. Pure.
//
// Each board game is saved at the first read that had both our projection
// and DraftKings' line (the earliest price we could have bet) and again at
// every pregame read after (the last one before kickoff stays). Graded at
// the line we first saw, with closing-line value against the close, and the
// line's move from the opener.
//
// The backtest (scripts/fit-cfb-ratings.mts, 2024-2025) found no edge betting
// our side against the line at -110, but the line moved our way from open to
// close (+0.35 pts at 3+ pts of edge, t 4.6). Too small to beat -110 alone, so
// the model hunts: every slice below is a paper bet (1u at -110) on the
// shared learning engine (lib/learning/engine.ts), registered on games after
// it was first seen, live only if it clears the gate, rolled back if it then
// loses. The learner also combines its strongest slice with others. Nothing
// here stakes money: a live slice marks its games on the panel, and the
// Picks review judges it as a source.

import type { Bet, Candidate, Entry, ViewStatus } from "@/lib/learning/engine";
import type { Projection } from "./model";

export const CFB_SECTION = "cfb-model-ours";

export interface CfbSnap {
  at: string;
  /** DraftKings' home spread at this read. */
  line: number;
  total?: number;
  /** Opening home spread, when the splits feed had it. */
  open?: number;
  proj: Projection;
}

export interface CfbTracked {
  week: number;
  home: string;
  away: string;
  kickoff: string;
  neutral: boolean;
  /** Conference game (ESPN), null when unknown. */
  conf: boolean | null;
  first: CfbSnap;
  last: CfbSnap;
  final?: { home: number; away: number };
}

export const gameKey = (g: { week: number; home: string; away: string }) => `${g.week}|${g.home}|${g.away}`;

/**
 * Folds a new read into a game's record. A read at or after kickoff never
 * counts. Returns the record to store, or null when nothing changed.
 */
export function foldRead(prev: CfbTracked | undefined, base: Omit<CfbTracked, "first" | "last" | "final">, snap: CfbSnap): CfbTracked | null {
  if (snap.at >= base.kickoff) return null;
  if (!prev) return { ...base, first: snap, last: snap };
  const same = prev.last.line === snap.line && prev.last.total === snap.total && prev.last.proj.spread === snap.proj.spread && prev.last.proj.total === snap.proj.total;
  if (same && prev.kickoff === base.kickoff) return null;
  return { ...prev, kickoff: base.kickoff, neutral: base.neutral, conf: base.conf ?? prev.conf, last: snap };
}

type Side = "home" | "away";

export interface Signal {
  side: Side;
  /** Points between our spread and the line, toward our side. */
  edge: number;
  /** Our side is the favorite at the line. */
  fav: boolean;
  /** The line moved from the opener toward our side (true), against it (false), or not / unknown (null). */
  withMove: boolean | null;
  /** Totals: our side of the total and how far ours is from it. */
  total?: { side: "over" | "under"; edge: number };
}

/** What our projection says at the first read. Null when we sit exactly on the line. */
export function signalOf(g: Pick<CfbTracked, "first">, open?: number | null): Signal | null {
  const s = g.first;
  const d = s.proj.spread - s.line; // > 0: our spread is above the line (home gets more points from us), so we like away
  if (d === 0) return null;
  const side: Side = d > 0 ? "away" : "home";
  const fav = side === "home" ? s.line < 0 : s.line > 0;
  const o = s.open ?? open ?? null;
  const moved = o === null ? 0 : s.line - o; // < 0: the home spread went down, toward home
  const withMove = moved === 0 ? null : side === "home" ? moved < 0 : moved > 0;
  const te = s.total === undefined ? 0 : s.proj.total - s.total;
  return {
    side,
    edge: Math.round(Math.abs(d) * 10) / 10,
    fav,
    withMove,
    ...(te !== 0 ? { total: { side: te > 0 ? "over" : "under", edge: Math.round(Math.abs(te) * 10) / 10 } } : {}),
  };
}

type Keep = (s: Signal, g: CfbTracked) => boolean;
type Pick_ = "ours" | "fade" | "total";

/** The slices the learner tests, all paper bets at -110. [id, label, parent, which bet, keep]. */
export const CFB_SLICES: [string, string, string | undefined, Pick_, Keep][] = [
  ["cfbm:lean", "Our side, any edge", undefined, "ours", () => true],
  ["cfbm:edge3", "Our side, 3+ pts from the line", "cfbm:lean", "ours", (s) => s.edge >= 3],
  ["cfbm:edge7", "Our side, 7+ pts from the line", "cfbm:lean", "ours", (s) => s.edge >= 7],
  ["cfbm:fade7", "Against our side when we're 7+ pts off (the market knows something)", undefined, "fade", (s) => s.edge >= 7],
  ["cfbm:home", "Our side when it's the home team", "cfbm:lean", "ours", (s) => s.side === "home"],
  ["cfbm:away", "Our side when it's the road team", "cfbm:lean", "ours", (s) => s.side === "away"],
  ["cfbm:fav", "Our side when it's the favorite", "cfbm:lean", "ours", (s) => s.fav],
  ["cfbm:dog", "Our side when it's the underdog", "cfbm:lean", "ours", (s) => !s.fav],
  ["cfbm:conf", "Our side in conference games", "cfbm:lean", "ours", (_s, g) => g.conf === true],
  ["cfbm:nonconf", "Our side in non-conference games", "cfbm:lean", "ours", (_s, g) => g.conf === false],
  ["cfbm:with-move", "Our side when the line has moved our way since the open", "cfbm:lean", "ours", (s) => s.withMove === true],
  ["cfbm:vs-move", "Our side when the line has moved against us since the open", "cfbm:lean", "ours", (s) => s.withMove === false],
  ["cfbm:total", "Our side of the total, any edge", undefined, "total", (s) => !!s.total],
  ["cfbm:total5", "Our side of the total, 5+ pts", "cfbm:total", "total", (s) => !!s.total && s.total.edge >= 5],
];

const WIN = 100 / 110;
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const netOf = (m: number) => (m > 0 ? WIN : m < 0 ? -1 : 0);

/** Margin of a spread bet on `side` at this home line (> 0 covers). */
export const coverMargin = (side: Side, line: number, f: { home: number; away: number }) => (side === "home" ? 1 : -1) * (f.home - f.away + line);

/** Points of closing-line value for `side` bet at `line`, judged against `close`. */
export const clvOf = (side: Side, line: number, close: number) => (side === "home" ? line - close : close - line);

export interface Closing {
  open: number | null;
  close: number | null;
  totalClose: number | null;
}

/** Graded games into the engine's candidates. Only games with a final count; a void (no final) is left out. */
export function cfbCandidates(games: CfbTracked[], closes: Map<string, Closing>): Candidate[] {
  return CFB_SLICES.map(([id, label, parent, pick, keep]) => ({
    id,
    label,
    ...(parent ? { parent } : {}),
    bets: games.flatMap((g): Bet[] => {
      if (!g.final) return [];
      const c = closes.get(gameKey(g));
      const s = signalOf(g, c?.open);
      if (!s || !keep(s, g)) return [];
      const game = gameKey(g);
      if (pick === "total") {
        const t = g.first.total;
        if (!s.total || t === undefined) return [];
        const m = (s.total.side === "over" ? 1 : -1) * (g.final.home + g.final.away - t);
        const tc = c?.totalClose;
        const toward = tc == null || tc === t ? 0 : (s.total.side === "over" ? tc > t : tc < t) ? 1 : -1;
        return [{ game, key: `${game}|${s.total.side}`, week: g.week, at: g.kickoff, net: r3(netOf(m)), toward }];
      }
      const side: Side = pick === "fade" ? (s.side === "home" ? "away" : "home") : s.side;
      const clv = c?.close == null ? 0 : clvOf(side, g.first.line, c.close);
      return [{ game, key: `${game}|${side}`, week: g.week, at: g.kickoff, net: r3(netOf(coverMargin(side, g.first.line, g.final))), toward: Math.sign(clv) }];
    }),
  }));
}

export interface ForwardRecord {
  games: number;
  graded: number;
  /** Our side at the first line we saw. */
  w: number;
  l: number;
  p: number;
  units: number;
  /** Average closing-line value on our side, points, and its t. */
  clv: number | null;
  clvT: number | null;
  clvGames: number;
  /** Our margin error and the first line's, on graded games. */
  maeOurs: number | null;
  maeLine: number | null;
  /** Straight up: our favorite won. */
  suW: number;
  suL: number;
}

/** The headline forward test: our side on every game, graded at the first line. */
export function forwardRecord(games: CfbTracked[], closes: Map<string, Closing>): ForwardRecord {
  let w = 0, l = 0, p = 0, units = 0, suW = 0, suL = 0;
  const clvs: number[] = [];
  const errO: number[] = [];
  const errL: number[] = [];
  for (const g of games) {
    const c = closes.get(gameKey(g));
    const s = signalOf(g, c?.open);
    if (s && c?.close != null) clvs.push(clvOf(s.side, g.first.line, c.close));
    if (!g.final) continue;
    const margin = g.final.home - g.final.away;
    errO.push(Math.abs(margin - g.first.proj.margin));
    errL.push(Math.abs(margin + g.first.line));
    if (margin !== 0 && g.first.proj.margin !== 0) (margin > 0 === g.first.proj.margin > 0 ? suW++ : suL++);
    if (!s) continue;
    const m = coverMargin(s.side, g.first.line, g.final);
    if (m > 0) w++;
    else if (m < 0) l++;
    else p++;
    units += netOf(m);
  }
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : null);
  const m = mean(clvs);
  const sd = clvs.length > 1 && m !== null ? Math.sqrt(clvs.reduce((a, v) => a + (v - m) ** 2, 0) / (clvs.length - 1)) : null;
  const r2 = (x: number | null) => (x === null ? null : Math.round(x * 100) / 100);
  return {
    games: games.length,
    graded: games.filter((g) => g.final).length,
    w, l, p,
    units: Math.round(units * 100) / 100,
    clv: r2(m),
    clvT: m !== null && sd ? r2(m / (sd / Math.sqrt(clvs.length))) : null,
    clvGames: clvs.length,
    maeOurs: r2(mean(errO)),
    maeLine: r2(mean(errL)),
    suW, suL,
  };
}

type LiveEntry = Pick<Entry, "id" | "activatedAt"> & { status: ViewStatus };

/** Live slices that keep this game (from the moment they went live), by label. Marks the panel; never stakes. */
export function liveSlicesFor(entries: LiveEntry[], g: CfbTracked, open?: number | null): string[] {
  const s = signalOf(g, open);
  if (!s) return [];
  return CFB_SLICES.filter(([id, , , , keep]) => entries.some((e) => e.id === id && e.status === "active" && e.activatedAt && Date.parse(g.kickoff) >= Date.parse(e.activatedAt)) && keep(s, g)).map(([, label]) => label);
}
