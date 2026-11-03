// An NBA game's opening and closing (or current) spread and total from ESPN's
// core odds API (sports.core.api.espn.com .../events/{id}/competitions/{id}/odds).
// One item per provider; each carries open, close and current numbers, the
// spread per side as an American-style string ("-5.5", "+1.5", "PK"). Pure.

import { americanOf, spreadFlipped } from "@/lib/picks/orient";

export interface CoreOddsItem {
  provider?: { name?: string };
  homeTeamOdds?: CoreSide;
  awayTeamOdds?: CoreSide;
  open?: { total?: { american?: string } };
  close?: { total?: { american?: string } };
  current?: { total?: { american?: string } };
}
type Leg = { pointSpread?: { american?: string }; moneyLine?: { american?: string } };
interface CoreSide {
  open?: Leg;
  close?: Leg;
  current?: Leg;
  moneyLine?: number;
  favorite?: boolean;
}
export interface CoreOdds {
  items?: CoreOddsItem[];
}

export interface OpenClose {
  provider: string;
  /** Home spread (negative: home favored) and total, at the open and at the close (current, before the close is set). */
  open: { spread: number | null; total: number | null };
  close: { spread: number | null; total: number | null };
}

/** "-5.5" -> -5.5, "PK"/"EVEN" -> 0, "o229.5" -> 229.5; null when unreadable. */
export function num(s: string | undefined): number | null {
  if (s === undefined || s === null) return null;
  const t = String(s).trim();
  if (/^(pk|even|ev)$/i.test(t)) return 0;
  const v = Number(t.replace(/^[ou]/i, ""));
  return Number.isFinite(v) ? v : null;
}

// Pregame books first; ESPN's live-odds feed moves during the game.
const ORDER = ["DraftKings", "ESPN BET", "FanDuel"];

/** The best pregame provider's open and close, or null when none has a spread. */
export function readOpenClose(d: CoreOdds): OpenClose | null {
  const items = (d.items ?? []).filter((it) => !/live/i.test(it.provider?.name ?? ""));
  const rank = (it: CoreOddsItem) => {
    const i = ORDER.indexOf(it.provider?.name ?? "");
    return i < 0 ? ORDER.length : i;
  };
  for (const it of [...items].sort((a, b) => rank(a) - rank(b))) {
    const h = it.homeTeamOdds;
    const close = { spread: num(h?.close?.pointSpread?.american) ?? num(h?.current?.pointSpread?.american), total: num(it.close?.total?.american) ?? num(it.current?.total?.american) };
    const open = { spread: num(h?.open?.pointSpread?.american), total: num(it.open?.total?.american) };
    if (close.spread === null && open.spread === null) continue;
    // The spread must agree with the moneyline (or the favorite flag) on who is favored (lib/picks/orient.ts).
    const a = it.awayTeamOdds;
    const ml = (x?: CoreSide) => americanOf(x?.close?.moneyLine?.american) ?? americanOf(x?.current?.moneyLine?.american) ?? americanOf(x?.moneyLine);
    if (spreadFlipped(close.spread ?? open.spread, { mlHome: ml(h), mlAway: ml(a), homeFav: h?.favorite, awayFav: a?.favorite })) {
      const turn = (x: number | null) => (x === null ? x : -x || 0);
      return { provider: it.provider?.name ?? "", open: { ...open, spread: turn(open.spread) }, close: { ...close, spread: turn(close.spread) } };
    }
    return { provider: it.provider?.name ?? "", open, close };
  }
  return null;
}
