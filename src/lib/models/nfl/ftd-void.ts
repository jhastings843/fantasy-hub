// Who took the field in a graded First TD game, so a bet on a player who did
// not play is void (net 0, not a bet), as DraftKings, FanDuel and Kalshi
// settle it (Jack, 2026-11-02). Until then our grading gave every non-winner
// -1. Weeks 7-8 of 2026 (scripts/ftd-season-table.mts): 5 of 626 priced
// players did not play, 3 of them in the 128 "any edge" bets.
//
// The source is ESPN's game-day roster (core API competitors/{id}/roster):
// every entry with didNotPlay false, plus every name in the box score. The
// box score alone is not enough: it lists only players with a stat, and a
// tight end who only blocked played. Game-roster names are short and
// disambiguated ("Penix Jr.", "D. London", "Bi. Robinson"), the box score's
// are full ("Michael Penix Jr."); onRoster reads both.
//
//   appeared({ ATL: ["D. London", "Penix Jr."] }, "ATL", "M.Penix Jr.") -> true
//   appeared({ ATL: ["D. London"] }, "ATL", "D.Mooney")                -> false (void)
//   appeared(undefined, "ATL", "D.Mooney")                             -> null (no record: graded as before, a loss)
//
// Lenient on purpose: any entry that could be him counts as played (two
// Robinsons, one inactive: played), so a doubt grades as before, a loss.
// Pure.

import { sameName } from "@/lib/firsttd/grade";
import { nameKey, type EspnBoxTeam } from "@/lib/props/grade";

/** Names that took the field, per team (the board's team codes). Empty or missing team: no record. */
export type Played = { [team: string]: string[] };

const letters = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

/** Could this game-roster or box-score name be the board's "M.Penix Jr."? */
export function onRoster(entry: string, board: string): boolean {
  const dot = board.indexOf(".");
  if (dot < 0) return nameKey(entry) === nameKey(board);
  const ini = letters(board.slice(0, dot));
  const sk = nameKey(board.slice(dot + 1));
  if (!sk) return false;
  if (nameKey(entry) === sk) return true; // surname only: "Penix Jr.", "St. Brown"
  // Initials then surname, split at any ". ": "D. London", "Bi. Robinson", "A.J. Terrell Jr."
  for (let i = entry.indexOf(". "); i >= 0; i = entry.indexOf(". ", i + 1))
    if (nameKey(entry.slice(i + 2)) === sk && letters(entry.slice(0, i)).startsWith(ini)) return true;
  return sameName(board, entry); // full name, "Michael Penix Jr."
}

/** Did the board's player take the field? Null when there is no record for his team. */
export function appeared(played: Played | undefined, team: string, board: string): boolean | null {
  const list = played?.[team];
  if (!list?.length) return null;
  return list.some((e) => onRoster(e, board));
}

/** Game-roster entries that played (didNotPlay false). */
export const rosterPlayed = (entries: { displayName?: string; didNotPlay?: boolean }[]): string[] =>
  entries.flatMap((e) => (e.displayName && !e.didNotPlay ? [e.displayName] : []));

/** Every name in a team's box score (any table), didNotPlay false. */
export const boxPlayed = (t: EspnBoxTeam): string[] => [
  ...new Set((t.statistics ?? []).flatMap((s) => (s.athletes ?? []).flatMap((a) => (a.athlete?.displayName && !a.didNotPlay ? [a.athlete.displayName] : [])))),
];
