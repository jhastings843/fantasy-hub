// Standings for a guillotine league.
//
// Sleeper keeps every guillotine roster at 0-0: there are no head-to-head
// games, and each team sits in a matchup of its own. So the record the league
// page used to print was 0-0 for all sixteen teams, all season. This rebuilds
// the table from the weekly scores instead:
//
// - Who was chopped, and when: walk the weeks in order and drop the lowest
//   score among the teams still alive. A chopped team keeps a matchup row at
//   zero points, so "lowest of everyone" would keep picking the dead.
// - An all-play record for each team: every week, one win for each live team
//   it outscored and one loss for each that outscored it. It is the only
//   win-loss number this format has, and it says how a team has really played.

import type { WeekResult } from "./results";

export interface GuillotineRow {
  rosterId: number;
  /** Week the team was chopped, or null while it is alive. */
  choppedWeek: number | null;
  wins: number;
  losses: number;
  ties: number;
  /** Points scored while alive. */
  points: number;
  /** The most recent week this team played alive. */
  last: {
    week: number;
    score: number;
    /** 1 is the high score of the week. */
    rank: number;
    teams: number;
    /** Points clear of the week's low score. Zero for the chopped team. */
    margin: number;
  } | null;
}

/**
 * Every roster's guillotine standing. Alive teams first, by points scored;
 * then the chopped teams, most recently chopped first.
 */
export function guillotineStandings(
  results: WeekResult[],
  rosterIds: number[],
  /** Rosters with no players left, the mark of a chopped team. */
  emptyRosterIds: Set<number> = new Set(),
): GuillotineRow[] {
  const rows = new Map<number, GuillotineRow>(
    rosterIds.map((id) => [
      id,
      { rosterId: id, choppedWeek: null, wins: 0, losses: 0, ties: 0, points: 0, last: null },
    ]),
  );

  for (const result of [...results].sort((a, b) => a.week - b.week)) {
    const live = result.scores.filter((s) => rows.get(s.rosterId)?.choppedWeek === null);
    if (live.length === 0) continue;
    const descending = [...live].sort((a, b) => b.points - a.points);
    const lowest = descending[descending.length - 1].points;

    for (const s of live) {
      const row = rows.get(s.rosterId)!;
      for (const o of live) {
        if (o.rosterId === s.rosterId) continue;
        if (s.points > o.points) row.wins++;
        else if (s.points < o.points) row.losses++;
        else row.ties++;
      }
      row.points += s.points;
      row.last = {
        week: result.week,
        score: s.points,
        rank: descending.findIndex((d) => d.rosterId === s.rosterId) + 1,
        teams: live.length,
        margin: s.points - lowest,
      };
    }

    // One chop a week. A tie for the low score is settled by the league's own
    // tiebreak, which Sleeper does not expose; the empty roster afterwards is
    // the tell, so prefer a tied team that has no players left.
    if (live.length > 1) {
      const tied = live.filter((s) => s.points === lowest);
      const chopped = tied.find((s) => emptyRosterIds.has(s.rosterId)) ?? tied[0];
      rows.get(chopped.rosterId)!.choppedWeek = result.week;
    }
  }

  return [...rows.values()].sort((a, b) => {
    if ((a.choppedWeek === null) !== (b.choppedWeek === null)) {
      return a.choppedWeek === null ? -1 : 1;
    }
    if (a.choppedWeek !== null && b.choppedWeek !== null && a.choppedWeek !== b.choppedWeek) {
      return b.choppedWeek - a.choppedWeek;
    }
    return b.points - a.points;
  });
}

export function allPlayRecord(row: GuillotineRow): string {
  return row.ties > 0
    ? `${row.wins}-${row.losses}-${row.ties}`
    : `${row.wins}-${row.losses}`;
}
