import "server-only";
import { cachedWithFallback } from "@/lib/redis/cached";
import type { PoolEntry } from "./entries";

// The 500-entry pool, read straight from Sleeper.
//
// It took a while to find because it is not where anything suggested. It is not
// a "pool" in their GraphQL schema, which returns nothing for this account, and
// it does not come back from the leagues endpoint either, because its sport is
// "pickem:nfl" rather than "nfl". Given the league id from the browser URL, the
// ordinary public v1 league endpoints serve all of it, with no token at all.
//
// Every roster is one entry, and its metadata carries the whole history:
//
//   previous_picks: {"v1:regular:1": ["JAX"], "v1:regular:2": ["TB"]}
//   is_eliminated:  "true"
//   lost_leg_ids:   ["v1:regular:2"]
//
// Which makes the estimate the rest of this module was built on unnecessary
// for this pool. No pasting a distribution, no modelling who carries what, no
// counting the survivors by hand.

const BASE = "https://api.sleeper.app/v1/league";

/** Fresh enough that Tuesday's picks are in, cheap enough to call on a render. */
const TTL = 15 * 60;

interface RawRoster {
  roster_id?: number;
  owner_id?: string | null;
  metadata?: {
    is_eliminated?: string | null;
    previous_picks?: Record<string, string[]> | null;
  } | null;
}

interface RawUser {
  user_id?: string;
  display_name?: string | null;
}

export interface PickemBoard {
  entries: PoolEntry[];
  /** Entries still standing, straight off their own elimination flag. */
  alive: number;
  /** Everything ever registered, which in a pool with re-buys is much larger. */
  total: number;
}

/** "v1:regular:3" -> 3. */
function legWeek(key: string): number | null {
  const n = Number(key.split(":").pop());
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function parsePickemRosters(rosters: RawRoster[], users: RawUser[]): PickemBoard {
  const nameById = new Map<string, string>();
  for (const u of users) {
    if (u.user_id) nameById.set(u.user_id, (u.display_name ?? "").trim() || u.user_id);
  }

  // A pool this size runs several entries per person, so the names repeat and
  // have to be told apart. 1,584 rosters against 477 users on week 3.
  const seen = new Map<string, number>();
  const entries: PoolEntry[] = [];

  for (const roster of rosters) {
    const meta = roster.metadata ?? {};
    const base = roster.owner_id ? (nameById.get(roster.owner_id) ?? roster.owner_id) : `Entry ${roster.roster_id ?? "?"}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);

    const picks: Record<string, string> = {};
    for (const [leg, teams] of Object.entries(meta.previous_picks ?? {})) {
      const week = legWeek(leg);
      const team = Array.isArray(teams) ? teams[0] : null;
      if (week && team) picks[String(week)] = team.toUpperCase();
    }

    entries.push({
      name: n === 1 ? base : `${base} #${n}`,
      picks,
      // Their own flag, not ours. An entry that lost still holds a pick for
      // every week it played, so "has a pick in every week" would read every
      // eliminated entry in this pool as alive.
      eliminated: String(meta.is_eliminated).toLowerCase() === "true",
    });
  }

  return {
    entries,
    alive: entries.filter((e) => !e.eliminated).length,
    total: entries.length,
  };
}

/**
 * Read one pickem league's board.
 *
 * Falls back to whatever was last read rather than throwing: this feeds a page
 * that has to render, and a pool that briefly cannot be reached is a pool the
 * modelled field can cover for.
 */
export async function fetchPickemBoard(leagueId: string): Promise<PickemBoard | null> {
  try {
    const res = await cachedWithFallback<PickemBoard>({
      key: `survivor:pickem:${leagueId}:v1`,
      ttlSeconds: TTL,
      empty: { entries: [], alive: 0, total: 0 },
      isComplete: (board) => board.entries.length > 0,
      fetcher: async () => {
        const [rosters, users] = await Promise.all([
          fetch(`${BASE}/${leagueId}/rosters`, { cache: "no-store" }).then((r) => {
            if (!r.ok) throw new Error(`rosters: ${r.status}`);
            return r.json() as Promise<RawRoster[]>;
          }),
          fetch(`${BASE}/${leagueId}/users`, { cache: "no-store" }).then((r) => {
            if (!r.ok) throw new Error(`users: ${r.status}`);
            return r.json() as Promise<RawUser[]>;
          }),
        ]);
        return parsePickemRosters(rosters, users);
      },
    });
    return res.value.entries.length > 0 ? res.value : null;
  } catch {
    return null;
  }
}
