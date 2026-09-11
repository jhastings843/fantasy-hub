import { normalizeTeam } from "@/lib/jingles/resolve";

// Facts about this week's fixtures, read off the schedule rather than off his
// post.
//
// Pure on purpose, and separate from any fetching, because the whole value of
// this is being able to test "it is Friday morning and Thursday night has been
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

export interface Fixture {
  opponent: string;
  /** True when this team is at home. */
  home: boolean;
}

/**
 * Who each team plays this week, and where.
 *
 * The schedule is the authority on this and his post is not, which took a real
 * disagreement to establish. In week 1 he wrote the 49ers as "vs LAR" in his
 * quarterback, back, tight end and kicker sections and "@ LAR" in his receiver
 * section, and the Rams as "vs SF" everywhere. Four of his five sections had
 * the wrong half of one game. An audit of all 257 ranked players found no other
 * team contradicting itself, so this is a typo rather than a pattern, but it is
 * a typo the app had no way to notice.
 *
 * Worth being precise about why this does not contradict the bye rule, which
 * says his list beats team codes. That rule is about WHETHER a player has a
 * game, where his ranking somebody is strong evidence and an abbreviation
 * mismatch is not. This is about WHICH game and at whose ground, where a
 * fixture list cannot be wrong and prose can.
 */
export function fixtureMap(games: LockGame[]): Map<string, Fixture> {
  const out = new Map<string, Fixture>();
  for (const g of games) {
    const home = normalizeTeam(g.home);
    const away = normalizeTeam(g.away);
    if (!home || !away) continue;
    out.set(home, { opponent: away, home: true });
    out.set(away, { opponent: home, home: false });
  }
  return out;
}

/**
 * How many stat rows a team needs before the feed alone may lock it.
 *
 * Measured, not chosen. On Sleeper's week 1 feed the four teams that had
 * actually played carried 79, 73, 72 and 71 rows, and the one team that had
 * not carried exactly one: Bryce Cabeldue, a Las Vegas offensive tackle, with
 * gp 1 for a game two days in the future. Anything between 2 and 70 separates
 * those cleanly, so this sits near the bottom of that range, where it stays
 * right even for a feed that fills in gradually.
 */
const MIN_STAT_ROWS = 5;

/**
 * Teams the stat feed says have played, corroborated by more than one row.
 *
 * This is the backstop behind the schedule, not the primary signal, and the
 * corroboration is what makes it safe to keep. The schedule locks on kickoff,
 * which is exact; this catches the case where the schedule cannot be read at
 * all, since a player only appears in the stat feed once he has been on the
 * field.
 *
 * The asymmetry is the whole reason for the threshold. A lock that arrives
 * late costs Jack advice he cannot act on, which is annoying. A lock that
 * arrives early HIDES advice he could have acted on, and shows him a score for
 * a game that has not happened. The second is worse, so the backstop is
 * required to be sure.
 *
 * Takes team codes, one per row of the feed, nulls included.
 */
export function teamsWithStats(teams: (string | null)[]): Set<string> {
  const counts = new Map<string, number>();
  for (const raw of teams) {
    const team = normalizeTeam(raw);
    if (!team) continue;
    counts.set(team, (counts.get(team) ?? 0) + 1);
  }
  const out = new Set<string>();
  for (const [team, n] of counts) if (n >= MIN_STAT_ROWS) out.add(team);
  return out;
}
