// The season plan, not just this week's ceiling.
//
// budget.ts already paces the whole year: the hold curve, the single-bid cap,
// the weekly ceilings, the flip at six teams. None of that is visible on the
// page, so the advice reads as "bid 20" with no way to tell whether that is a
// tight week or a rich one. This turns the same curve into the next three
// weeks and the week the format inverts, which is the part worth planning
// around.
//
// It calls planBudget rather than reimplementing the curve, so a change to the
// pacing rules cannot leave the projection describing the old ones.

import { INVERSION_TEAMS, planBudget, type Phase } from "./budget";

/** Fantasy weeks run to 18; a guillotine league is usually over well before. */
const LAST_WEEK = 18;

/** Below this the league has a winner and there is nothing left to project. */
const MIN_TEAMS = 2;

/** planBudget stops pacing here: duel and endgame, not consolidation. */
const PACING_OFF_TEAMS = 4;

/** How far ahead to project. Three weeks is two waiver runs and one bye. */
const HORIZON = 3;

export interface SeasonWeek {
  week: number;
  /** Projected, at one chop a week. */
  teamsAlive: number;
  phase: Phase;
  /** What the curve says you should still be holding that week. */
  holdFloor: number;
  /** The ceiling a clear week would carry, if you spend nothing until then. */
  weeklyCap: number;
}

export interface SeasonOutlook {
  spent: number;
  remaining: number;
  /** The hold floor for the week you are actually in. */
  holdFloor: number;
  onPace: boolean;
  /** Remaining minus the floor. Negative means you are ahead of the curve. */
  aheadBy: number;
  next: SeasonWeek[];
  /**
   * Projected week the field reaches six, where the format inverts from
   * "do not finish last" to "outscore the survivors".
   */
  inversionWeek: number | null;
  /**
   * Projected week pacing actually switches off, which is NOT the same week.
   *
   * budget.ts stops pacing at the endgame, four teams, and consolidation at
   * five and six is still paced. Saying "pacing switches off at six" would be
   * wrong by two weeks and in the expensive direction: it would read as
   * permission to empty the wallet while the curve is still holding it back.
   */
  pacingOffWeek: number | null;
}

export interface OutlookInput {
  budget: number;
  remaining: number;
  teamsAlive: number;
  totalTeams: number;
  week: number;
}

/**
 * A week's numbers under the pacing rules, with no rivals and a clear posture.
 *
 * Posture is deliberately green for every projected week. A future week's
 * danger is not knowable, and the honest projection is the one that says what
 * pacing allows when nothing has gone wrong. A red week overrides pacing
 * anyway, so the number here is a floor on your freedom, never a cap on it.
 */
function weekPlan(input: OutlookInput, teamsAlive: number) {
  return planBudget({
    budget: input.budget,
    remaining: input.remaining,
    teamsAlive,
    totalTeams: input.totalTeams,
    posture: "green",
    rivalRemaining: [],
  });
}

export function seasonOutlook(input: OutlookInput): SeasonOutlook {
  const now = weekPlan(input, input.teamsAlive);

  const next: SeasonWeek[] = [];
  for (let i = 1; i <= HORIZON; i++) {
    const week = input.week + i;
    if (week > LAST_WEEK) break;
    const teamsAlive = input.teamsAlive - i;
    // One team left is a finished league, and three more weeks of advice for
    // a league that has already been won is advice about nothing.
    if (teamsAlive < MIN_TEAMS) break;
    const plan = weekPlan(input, teamsAlive);
    next.push({
      week,
      teamsAlive,
      phase: plan.phase,
      holdFloor: plan.holdFloor,
      weeklyCap: plan.weeklyCap,
    });
  }

  // One chop a week is the only projection a guillotine league supports, and
  // it is exactly right until a tie or a double chop says otherwise.
  const weekTheFieldReaches = (teams: number): number | null => {
    const weeks = input.teamsAlive - teams;
    if (weeks <= 0) return null;
    const week = input.week + weeks;
    return week <= LAST_WEEK ? week : null;
  };

  const inversionWeek = weekTheFieldReaches(INVERSION_TEAMS);
  const pacingOffWeek = weekTheFieldReaches(PACING_OFF_TEAMS);

  return {
    spent: input.budget - input.remaining,
    remaining: input.remaining,
    holdFloor: now.holdFloor,
    onPace: input.remaining >= now.holdFloor,
    aheadBy: input.remaining - now.holdFloor,
    next,
    inversionWeek,
    pacingOffWeek,
  };
}
