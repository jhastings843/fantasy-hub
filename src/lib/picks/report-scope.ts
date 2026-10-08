import type { League } from "./parse";

/** This league's activated research cuts, from league-scoped ids ("nfl:dog-band-a"). */
export function activatedFor(league: League, ids: string[]): string[] {
  return ids.filter((x) => x.startsWith(`${league}:`)).map((x) => x.slice(league.length + 1));
}
