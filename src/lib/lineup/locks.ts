import { normalizeTeam } from "@/lib/jingles/resolve";

// Which teams are past the point where Jack can do anything about them.
//
// Pure on purpose, and separate from build.ts, because the whole value of this
// is being able to test "it is Friday morning and Thursday night has been
// played" without a network and without waiting for a Thursday.

export interface LockGame {
  home: string;
  away: string;
  /** ISO kickoff. */
  kickoff: string;
  completed: boolean;
}

/**
 * Teams whose game this week has already started.
 *
 * Sleeper locks a starting slot the moment that player's game kicks off, so a
 * team past kickoff is a team whose players are frozen wherever they sit. That
 * is the fact the lineup advice was missing entirely: on 2026-09-11, with the
 * 49ers already played, the app was still telling Jack to bench De'Zhaun
 * Stribling for a Jets receiver, which Sleeper would not have let him do.
 *
 * `completed` is honoured as well as the clock because a game that finished is
 * locked whatever a stale kickoff string says, and because it costs nothing.
 *
 * Team codes come back normalised, so the caller can compare them against
 * Sleeper's without repeating the JAC/JAX lesson.
 */
export function lockedTeams(games: LockGame[], now: Date): Set<string> {
  const out = new Set<string>();
  const t = now.getTime();
  for (const g of games) {
    const kicked = Date.parse(g.kickoff);
    const locked = g.completed || (Number.isFinite(kicked) && kicked <= t);
    if (!locked) continue;
    for (const team of [g.home, g.away]) {
      const n = normalizeTeam(team);
      if (n) out.add(n);
    }
  }
  return out;
}
