// Players Jack will not trade, per league. Recommenders never offer them and
// the analyzer declines any proposal that includes one. Safe to import from
// client components.

import type { PlayerRow, TeamSummary } from "./power-rankings";

export const DAH_DYNASTY_LEAGUE_ID = "1312136721281859584";

// Keyed by Sleeper league id, then Sleeper player id.
// 2026-10-05: Gibbs is the core of the 2027 retool (24, top-2 dynasty asset).
const UNTOUCHABLES: Record<string, Record<string, string>> = {
  [DAH_DYNASTY_LEAGUE_ID]: {
    "9221": "Jahmyr Gibbs",
  },
};

/** Flags Jack's untouchable players on his own roster, in place. */
export function markUntouchables(
  teams: TeamSummary[],
  leagueId: string,
  myRosterId: number,
): void {
  const ids = UNTOUCHABLES[leagueId];
  if (!ids) return;
  const mine = teams.find((t) => t.rosterId === myRosterId);
  for (const p of mine?.players ?? []) {
    if (ids[p.id]) p.untouchable = true;
  }
}

export function tradeable(p: PlayerRow): boolean {
  return !p.untouchable;
}

export function untouchableNote(players: PlayerRow[]): string {
  const names = players.map((p) => p.name).join(" and ");
  return `${names} ${players.length > 1 ? "are" : "is"} on your do-not-trade list`;
}
