// The prop to tag for King of the Court (Jack, 2026-10-27: "every player in
// top 30 should have the prop to tag even if there isn't a huge edge, I have
// to bet something on the player for it to count"). For each player, of every
// side of every prop DraftKings prices at -200 or longer (the promo's rule),
// the one where our chance beats DK's break-even by the most, edge or not.
// A player with 3+ games this season (his minutes from this season's role) is
// preferred over an earlier read. Shared by the board and the learner, so the
// prop the page names is the prop the record grades. Pure.
import { implied, payout, type PropMarket, type Side } from "@/lib/props/parse";
import { noVig } from "./market";
import { settle } from "@/lib/props/grade";
import type { OurStoredProps } from "./store";

/** DK's rule for the tagged prop. */
export const KOTC_QUALIFIES = -200;
/** NBA games a player needs this season before his number leans on this season's role. */
export const TAG_GAMES = 3;

export interface KotcTag {
  board: OurStoredProps;
  m: PropMarket;
  side: Side;
  price: number;
  /** Our chance of the side, DK's with the vig out (null when one side is missing), and ours minus DK's break-even. */
  ours: number;
  fair: number | null;
  gap: number;
  /** Our model's own edge on this side (the props board would track it). */
  edge: boolean;
  /** Under 3 games this season: the number still leans on last season. */
  early: boolean;
}

export function bestTag(boards: OurStoredProps[], name: string): KotcTag | null {
  let best: KotcTag | null = null;
  for (const b of boards)
    for (const m of b.game.markets) {
      if (m.player !== name || !m.stat) continue;
      const x = b.extra[m.id];
      if (!x) continue;
      const dk = m.books[0];
      const early = (x.games ?? 0) < TAG_GAMES;
      for (const side of ["over", "under"] as const) {
        const price = dk?.[side];
        if (price === null || price === undefined || price < KOTC_QUALIFIES) continue;
        const ours = x[side];
        const t: KotcTag = {
          board: b,
          m,
          side,
          price,
          ours,
          fair: dk.over !== null && dk.under !== null ? noVig(dk.over, dk.under)[side] : null,
          gap: ours - implied(price),
          edge: !early && m.clears && m.side === side && m.gap !== null,
          early,
        };
        if (!best || Number(best.early) - Number(t.early) > 0 || (best.early === t.early && t.gap > best.gap)) best = t;
      }
    }
  return best;
}

/** The tag's result once its game is graded: units on 1u at the saved price, null before grading or when he sat. */
export function gradeTag(t: KotcTag): { id: string; net: number; outcome: "W" | "L" | "P" } | null {
  const r = t.board.result?.markets.find((x) => x.id === t.m.id);
  if (!r || r.actual === null || r.actual === undefined) return null;
  const outcome = settle(t.side, t.m.line, r.actual);
  return { id: t.m.id, net: outcome === "W" ? Math.round(payout(t.price) * 1000) / 1000 : outcome === "L" ? -1 : 0, outcome };
}
