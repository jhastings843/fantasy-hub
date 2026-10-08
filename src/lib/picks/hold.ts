// When a bet becomes official. Pure.
//
// NFL Sunday and Monday games are held until the Sunday 9am brief (Jack,
// 2026-10-08): a pick made Tuesday for a game five days out can be overtaken
// by line moves, model updates and injuries, so it is shown as an early look
// with no stake and becomes a bet at that morning's line. Games before the
// brief (Thursday, late-season Saturdays) still go out on the Tuesday card.
// College is not held: its games are mostly Saturday and the Tuesday card
// catches the early line move. The cost, measured on one week only: the NFL
// line had moved 0.60 points toward the models by Wednesday night, of 0.69 by
// kickoff. The "timing" hypothesis in the strategy review keeps measuring
// first line vs game-day line, so this can be revisited on evidence.

import { etClock } from "@/lib/pulse/tempo";
import type { League } from "./parse";

/** The Sunday brief's slot (tempo.ts: { id: "sunday", day: SUN, at: 9 * 60 }). */
export const NFL_RELEASE = { day: 0, minute: 9 * 60 } as const;

/** The next Sunday 9:00 ET strictly after `now`, DST-safe. */
export function nextNflRelease(now: Date): Date {
  const c = etClock(now);
  const nowMin = c.day * 1440 + c.hour * 60 + c.minute;
  let ahead = NFL_RELEASE.day * 1440 + NFL_RELEASE.minute - nowMin;
  if (ahead <= 0) ahead += 7 * 1440;
  const t = new Date(Math.floor(now.getTime() / 60000) * 60000 + ahead * 60000);
  // A DST change in between leaves the ET clock an hour off: correct it.
  const h = etClock(t).hour;
  return h === 9 ? t : new Date(t.getTime() + (9 - h) * 3600000);
}

/**
 * When this game's bet may be issued, or null when it may be issued now.
 * Only NFL games kicking off after the next Sunday brief are held.
 */
export function heldUntil(league: League, kickoff: string | undefined, now: Date): string | null {
  if (league !== "nfl" || !kickoff) return null;
  const release = nextNflRelease(now);
  return new Date(kickoff).getTime() > release.getTime() ? release.toISOString() : null;
}
