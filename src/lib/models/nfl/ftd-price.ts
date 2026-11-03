// The best First TD price Jack could actually get, per player: Kalshi's ask
// with its fee, or DraftKings' or FanDuel's American price as a break-even
// (the books' vig is already in their price). Our First TD board, record and
// learner all grade at this one price (Jack, 2026-10-26: "grading based on
// Kalshi rather than the actual best odds"). Games saved before the books'
// morning read (Oct 21) have Kalshi only, so they grade as before.
//
//   bestCost({ kalshi: ask 0.14, dk: +650 }, "J.Chase") -> { cost: 0.133, where: "+650 DK" }  (Kalshi 0.14 + fee 0.01)
//
// Pure.

import { implied } from "@/lib/props/parse";
import { nameKey } from "@/lib/props/grade";
import { kalshiCost, kalshiFor, type GradedGame } from "@/lib/firsttd/trends";
import { pricedPlayers, type FtdGame, type FtdPlayer } from "@/lib/firsttd/parse";
import type { KalshiGame } from "@/lib/firsttd/kalshi";
import { appeared, type Played } from "./ftd-void";

type BookPrices = { at: string; prices: { [nameKey: string]: number } };

/** The prices saved with a board. */
export interface Books {
  kalshi?: KalshiGame;
  dk?: BookPrices;
  fd?: BookPrices;
}

export type Book = "kalshi" | "dk" | "fd";

const am = (p: number) => (p > 0 ? `+${p}` : `${p}`);

/** A book's price for a board name ("J.Chase"): the one key that starts with the initial and ends with the surname. */
export function bookPrice(book: BookPrices | undefined, name: string): number | null {
  if (!book) return null;
  const [ini, ...rest] = name.split(".");
  if (!rest.length) return book.prices[nameKey(name)] ?? null;
  const last = nameKey(rest.join(" "));
  const hits = Object.keys(book.prices).filter((k) => k.startsWith(ini.toLowerCase()) && k.endsWith(last));
  return hits.length === 1 ? book.prices[hits[0]] : null;
}

/** The cheapest break-even across Kalshi (fee in), DraftKings and FanDuel, and where it is. Null when none priced him. */
export function bestCost(g: Books, name: string): { cost: number; where: string; book: Book } | null {
  const opts: { cost: number; where: string; book: Book }[] = [];
  const k = kalshiFor(g.kalshi, name);
  if (k?.ask) {
    const c = kalshiCost(k.ask);
    opts.push({ cost: c, where: `${Math.round(c * 100)}¢ Kalshi`, book: "kalshi" });
  }
  const d = bookPrice(g.dk, name);
  if (d !== null) opts.push({ cost: implied(d), where: `${am(d)} DK`, book: "dk" });
  const f = bookPrice(g.fd, name);
  if (f !== null) opts.push({ cost: implied(f), where: `${am(f)} FanDuel`, book: "fd" });
  return opts.sort((a, b) => a.cost - b.cost)[0] ?? null;
}

/**
 * What counts as a First TD edge (Jack, 2026-11-02): the best price is 6% or
 * shorter (about +1567 or less) and our chance beats it by 2+ points. The old
 * rule (any amount above the price) went 2-126, -102.9u, with 111 of the 128
 * bets priced under 6% (0-111). Thin evidence either way: judged from here on.
 *
 *   ftdEdge(0.12, 0.09) true · ftdEdge(0.06, 0.03) false (long shot) · ftdEdge(0.11, 0.10) false (1 pt)
 */
export const FTD_EDGE = { minCost: 0.06, gap: 0.02 };
export const ftdEdge = (p: number, cost: number) => cost >= FTD_EDGE.minCost && p >= cost + FTD_EDGE.gap;

type Keep = (p: FtdPlayer & { p: number }, cost: number, g: FtdGame) => boolean;

/**
 * Every bet a slice would make, one unit at the best price, graded. marketBets' counterpart for our model.
 * A player the game's participation record (ftd-void.ts) shows did not play is void, as at the books: left
 * out, not a bet. Games graded without that record (played absent) count every non-winner -1, as before.
 */
export function bestBets(
  list: (GradedGame & Books & { played?: Played })[],
  keep: Keep,
): { game: FtdGame; player: string; kickoff?: string; cost: number; book: Book; win: boolean; net: number; p: number }[] {
  const out: { game: FtdGame; player: string; kickoff?: string; cost: number; book: Book; win: boolean; net: number; p: number }[] = [];
  for (const x of list) {
    for (const p of pricedPlayers(x.game)) {
      const b = bestCost(x, p.name);
      if (!b || b.cost >= 1 || !keep(p, b.cost, x.game)) continue;
      if (appeared(x.played, p.team, p.name) === false) continue; // void
      const win = x.result.key === p.key;
      out.push({ game: x.game, player: p.key, kickoff: x.kickoff ?? x.capturedAt, cost: b.cost, book: b.book, win, net: win ? (1 - b.cost) / b.cost : -1, p: p.p });
    }
  }
  return out;
}
