// Which live system slices an unsettled Sam or David prop falls in, and the
// side each one bets. Moved here from app/props/playerprops.tsx (which
// re-exports it) so the Today tab, the bets email and the pushes mark the
// same bets the Props page does (lib/props/staked.ts). Pure.

import type { PropMarket, Side } from "./parse";
import { isPlay } from "./grade";
import { matches, rwSide, type GradedPropsGame } from "./trends";
import { davidSliceSide, isDavidSlice, type DavidProp } from "./david";
import type { StoredProps } from "./store";

/** The side a Sam system slice would bet on this market, before its own test. */
export function systemSide(id: string, m: PropMarket, saved: Pick<StoredProps, "rw" | "espn" | "david">): Side | null {
  return id.startsWith("play:")
    ? isPlay(m)
      ? m.side
      : null
    : id.startsWith("rw:")
      ? rwSide(m, saved.rw?.[m.id])
      : id.startsWith("espn:")
        ? rwSide(m, saved.espn?.[m.id])
        : id.startsWith("david:")
          ? rwSide(m, saved.david?.[m.id])
          : m.lean;
}

/** Slice ids an unsettled market's play or lean falls in, among the active system slices. */
export function systemHits(m: PropMarket, saved: StoredProps, active: string[], all: GradedPropsGame[]): string[] {
  const rw = saved.rw?.[m.id];
  const espn = saved.espn?.[m.id];
  const david = saved.david?.[m.id];
  const dk = saved.dk?.[m.id];
  const pseudo = (side: Side | null) =>
    side
      ? { week: 0, slug: saved.game.slug, m, g: { id: m.id, actual: null, play: null, lean: null }, bet: { side, line: m.line, price: 0, book: "", outcome: "P" as const, net: 0, breakEven: 0 }, rw, espn, david, dk }
      : null;
  return active.filter((id) => {
    if (isDavidSlice(id)) return false;
    const row = pseudo(systemSide(id, m, saved));
    // Favorites need the week's own game; pass it as the only list entry.
    return !!row && matches(id, row, [{ week: 0, slug: saved.game.slug, game: saved.game, result: { markets: [], void: 0 } }, ...all]);
  });
}

/** Active system slices a David prop falls in. */
export const davidHits = (p: DavidProp, samProj: number | undefined, active: string[]) => active.filter((id) => isDavidSlice(id) && davidSliceSide(id, p, samProj) !== null);
