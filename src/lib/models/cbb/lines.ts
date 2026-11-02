// A college basketball game's lines from ESPN's core odds API
// (sports.core.api.espn.com/v2/sports/basketball/leagues/mens-college-basketball
// /events/{id}/competitions/{id}/odds): spread, total and moneyline with
// prices, now and at the open, from the best pregame book. Pure.

import { num } from "@/lib/models/nba/game-lines";

interface Price {
  american?: string;
}
interface Side {
  moneyLine?: number;
  spreadOdds?: number;
  open?: { pointSpread?: Price; spread?: Price; moneyLine?: Price };
  close?: { pointSpread?: Price; spread?: Price; moneyLine?: Price };
  current?: { pointSpread?: Price; spread?: Price; moneyLine?: Price };
}
export interface CbbOddsItem {
  provider?: { name?: string };
  overUnder?: number;
  spread?: number;
  overOdds?: number;
  underOdds?: number;
  homeTeamOdds?: Side;
  awayTeamOdds?: Side;
  open?: { total?: Price; over?: Price; under?: Price };
  close?: { total?: Price; over?: Price; under?: Price };
  current?: { total?: Price; over?: Price; under?: Price };
}
export interface CbbOdds {
  items?: CbbOddsItem[];
}

export interface CbbLine {
  provider: string;
  /** Home spread (negative: home favored), prices for each side. */
  spread: number | null;
  homePrice?: number;
  awayPrice?: number;
  total: number | null;
  overPrice?: number;
  underPrice?: number;
  mlHome?: number;
  mlAway?: number;
  open: { spread: number | null; total: number | null };
}

const ORDER = ["DraftKings", "ESPN BET", "FanDuel"];

/** An American price: "-110" -> -110, "EVEN"/"EV" -> +100; null for anything that is not a price. */
export function priceOf(s: string | undefined): number | null {
  if (s === undefined || s === null) return null;
  const t = String(s).trim();
  if (/^(even|ev)$/i.test(t)) return 100;
  const v = Number(t);
  return Number.isFinite(v) && Math.abs(v) >= 100 ? v : null;
}
const firstPrice = (...xs: (Price | number | undefined)[]) => {
  for (const x of xs) {
    const v = typeof x === "number" ? (Math.abs(x) >= 100 ? x : null) : priceOf(x?.american);
    if (v !== null) return v;
  }
  return undefined;
};
const firstNum = (...xs: (string | number | undefined)[]) => {
  for (const x of xs) {
    const v = typeof x === "number" ? x : num(x);
    if (v !== null && Number.isFinite(v)) return v;
  }
  return null;
};

/**
 * The best pregame book's numbers, or null when no book has a spread or total.
 * `at: "now"` reads current then close (for a save before tip); `at: "close"`
 * reads close then current (for grading). Each field falls back on its own,
 * so a `current` block holding only a moneyline never hides the spread.
 */
export function readCbbLine(d: CbbOdds, at: "now" | "close" = "now"): CbbLine | null {
  const items = (d.items ?? []).filter((it) => !/live/i.test(it.provider?.name ?? ""));
  const rank = (it: CbbOddsItem) => {
    const i = ORDER.indexOf(it.provider?.name ?? "");
    return i < 0 ? ORDER.length : i;
  };
  for (const it of [...items].sort((a, b) => rank(a) - rank(b))) {
    const h = it.homeTeamOdds;
    const a = it.awayTeamOdds;
    const pair = <T,>(cur: T | undefined, cl: T | undefined): [T | undefined, T | undefined] => (at === "now" ? [cur, cl] : [cl, cur]);
    const [h1, h2] = pair(h?.current, h?.close);
    const [a1, a2] = pair(a?.current, a?.close);
    const [t1, t2] = pair(it.current, it.close);
    // The top-level numbers are ESPN's current ones: last resort when reading the close.
    const spread = firstNum(h1?.pointSpread?.american, h2?.pointSpread?.american, it.spread);
    const total = firstNum(t1?.total?.american, t2?.total?.american, it.overUnder);
    if (spread === null && total === null) continue;
    return {
      provider: it.provider?.name ?? "",
      spread,
      homePrice: firstPrice(h1?.spread, h2?.spread, h?.spreadOdds),
      awayPrice: firstPrice(a1?.spread, a2?.spread, a?.spreadOdds),
      total,
      overPrice: firstPrice(t1?.over, t2?.over, it.overOdds),
      underPrice: firstPrice(t1?.under, t2?.under, it.underOdds),
      mlHome: firstPrice(h1?.moneyLine, h2?.moneyLine, h?.moneyLine),
      mlAway: firstPrice(a1?.moneyLine, a2?.moneyLine, a?.moneyLine),
      open: { spread: num(h?.open?.pointSpread?.american), total: num(it.open?.total?.american) },
    };
  }
  return null;
}

/** American price -> implied chance, no vig removed. */
export const implied = (p: number) => (p < 0 ? -p / (-p + 100) : 100 / (p + 100));
/** Both sides' no-vig chances from a pair of prices. */
export function noVig(a?: number, b?: number): [number, number] | null {
  if (a === undefined || b === undefined) return null;
  const x = implied(a);
  const y = implied(b);
  return [x / (x + y), y / (x + y)];
}
/** Units won on a 1u stake at an American price. */
export const payout = (p: number) => (p > 0 ? p / 100 : 100 / -p);
