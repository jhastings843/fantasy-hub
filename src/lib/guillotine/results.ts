// What the scoreboard says, shown next to what the projections say.
//
// The first version of this file also shrank each team's projection toward
// its actual scores, and the research done to check that idea said no: a
// current weekly projection already updates on snaps, targets and injuries,
// so adding the raw score on top double counts, and a trailing average of
// several games predicts worse than a current projection does. One bad week
// is mostly a bad week. So the scoreboard is reported here, not modelled.
// Forward-looking lineup quality is the signal that does move the posture,
// and that lives in fragility.ts.

export interface WeekScore {
  rosterId: number;
  points: number;
}

export interface WeekResult {
  week: number;
  scores: WeekScore[];
}

/** One team's finish in one completed week. */
export interface LastWeek {
  week: number;
  score: number;
  /** 1 is the lowest score of the week. */
  rankFromBottom: number;
  teams: number;
  /** The week's low score, which is the score that got chopped. */
  lowest: number;
  /** Points clear of the low score. Zero means this was the chopped team. */
  margin: number;
}

/** Every completed week's score for one roster, oldest first. */
export function actualsFor(results: WeekResult[], rosterId: number): number[] {
  return [...results]
    .sort((a, b) => a.week - b.week)
    .map((r) => r.scores.find((s) => s.rosterId === rosterId)?.points)
    .filter((p): p is number => typeof p === "number");
}

/** Where a roster finished in one week. Null when it did not score that week. */
export function standingFor(result: WeekResult, rosterId: number): LastWeek | null {
  const mine = result.scores.find((s) => s.rosterId === rosterId);
  if (!mine || result.scores.length === 0) return null;

  const ascending = [...result.scores].sort((a, b) => a.points - b.points);
  const lowest = ascending[0].points;
  const rankFromBottom = ascending.findIndex((s) => s.rosterId === rosterId) + 1;

  return {
    week: result.week,
    score: mine.points,
    rankFromBottom,
    teams: result.scores.length,
    lowest,
    margin: mine.points - lowest,
  };
}

/** The most recent completed week's standing for a roster, if any. */
export function lastWeekFor(results: WeekResult[], rosterId: number): LastWeek | null {
  const latest = [...results].sort((a, b) => b.week - a.week)[0];
  return latest ? standingFor(latest, rosterId) : null;
}

function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${suffix}`;
}

/**
 * One sentence on last week, for the posture detail. Rank is counted from the
 * bottom, because that is the end of the table this format cares about.
 */
export function describeLastWeek(last: LastWeek): string {
  const where =
    last.margin <= 0
      ? "the low score of the week"
      : last.rankFromBottom <= 3
        ? `${ordinal(last.rankFromBottom)} lowest of ${last.teams}, ${last.margin.toFixed(1)} clear of the chop`
        : `${ordinal(last.teams - last.rankFromBottom + 1)} highest of ${last.teams}`;
  return `Last week you scored ${last.score.toFixed(1)}, ${where}.`;
}
