// When a bet becomes official. Pure.
//
// Jack, 2026-10-08: stakes go out only on the day of the game. Every game,
// NFL and college, is an early look (shown, no bet) until 9:00 ET on its own
// game day, when the daily "today's bets" email issues it at that morning's
// line and price. A pick made days ahead can be overtaken by line moves,
// model updates and injury news; holding it lets those count first.
//
// Held games still take their place in the week's allocation by edge, so a
// thin Thursday play can't use up room a stronger Sunday play needs.
//
// The cost, measured on one week only (an estimate): the NFL line had moved
// 0.60 points toward the models by Wednesday night, of 0.69 by kickoff. The
// strategy review's "timing" hypothesis keeps measuring first line vs
// game-day line, so this can be revisited on evidence.

import { etClock } from "@/lib/pulse/tempo";
import type { League } from "./parse";

/** The daily bets email (tempo.ts: "picks-day"), minutes after midnight ET. */
export const RELEASE_MINUTE = 9 * 60;

/** YYYY-MM-DD in Eastern time. */
export const etDate = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });

/** 9:00 ET on the ET calendar day of `at`, DST-safe. */
export function releaseOn(at: Date): Date {
  const c = etClock(at);
  const t = new Date(Math.floor(at.getTime() / 60000) * 60000 + (RELEASE_MINUTE - (c.hour * 60 + c.minute)) * 60000);
  // A DST change between midnight and `at` leaves the ET clock an hour off.
  const h = etClock(t).hour;
  return h === RELEASE_MINUTE / 60 ? t : new Date(t.getTime() + (RELEASE_MINUTE / 60 - h) * 3600000);
}

/**
 * When this game's bet may be issued (ISO), or null when it may be issued
 * now. A game is held until 9:00 ET on its game day (or an hour before a
 * kickoff earlier than that).
 */
export function heldUntil(_league: League, kickoff: string | undefined, now: Date): string | null {
  if (!kickoff) return null;
  const k = new Date(kickoff);
  const release = Math.min(releaseOn(k).getTime(), k.getTime() - 3600000);
  return now.getTime() < release ? new Date(release).toISOString() : null;
}
