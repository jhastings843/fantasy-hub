// How much you are allowed to spend this week.
//
// The published pacing advice is written in months: hold 90% after September,
// 75% after October, 25% after November. That is a proxy for the thing that
// actually matters, which is how many teams are left to eliminate, and the
// proxy breaks as soon as the league is not the 18-team, runs-to-December
// standard it was written for. Dah Chopped is 16 teams from Week 1, so five
// teams remain around Week 11 and a December-shaped rule would have you
// hoarding through the endgame.
//
// So the same curve is re-anchored to the share of eliminations completed,
// which transfers to any league size. The source numbers are unchanged; only
// the axis is honest now.

import type { Posture } from "./chop-line";

/**
 * Fantasy Life's monthly pacing for an 18-team, $1000 league, restated as
 * "after this share of the season's eliminations, still hold this share of the
 * budget". September is about 4 of 17 chops, October about 8, November about 12.
 */
const HOLD_CURVE: { done: number; hold: number }[] = [
  // Not 1.0. A curve that says "hold everything" before the first chop makes
  // week one unbiddable, and week one has a waiver run like every other week:
  // an injury in the opener is exactly the cheap fix worth making. Five percent
  // is inside the sources' own "0 to 10% in weeks 1 to 4" band.
  { done: 0, hold: 0.95 },
  { done: 4 / 17, hold: 0.9 },
  { done: 8 / 17, hold: 0.75 },
  { done: 12 / 17, hold: 0.25 },
  { done: 1, hold: 0 },
];

/** RotoWire: no more than a quarter of the budget on one player in the first half. */
export const MAX_SINGLE_BID_EARLY = 0.25;

/** Fantasy Life: even a dire September should not spend past 30% of budget. */
const RED_WEEK_CEILING = 0.3;

/** Price enforcement only. Small enough to lose gracefully every week. */
const GREEN_WEEK_CEILING = 0.02;

/** One real fix, not a shopping spree. */
const YELLOW_WEEK_CEILING = 0.08;

// Fantasy Index recommends holding ~5% back for bye and injury emergencies.
// There is deliberately no such clause here: while the field is large the hold
// curve already keeps 47% or more of the budget in reserve, so a 5% floor can
// never bind, and once the field is small enough for it to bind the endgame has
// switched pacing off on purpose. It would be a branch that never runs.

/**
 * Teams remaining at which the format inverts from "do not finish last" to
 * "outscore the survivors". The sources put it at five or six.
 */
export const INVERSION_TEAMS = 6;

export type Phase = "field" | "consolidation" | "endgame" | "duel";

export interface BudgetInput {
  budget: number;
  remaining: number;
  teamsAlive: number;
  totalTeams: number;
  posture: Posture;
  /** Every other surviving team's remaining FAAB. */
  rivalRemaining: number[];
}

export interface BudgetPlan {
  phase: Phase;
  phaseNote: string;
  eliminationsRemaining: number;
  /** remaining / eliminations remaining. A reference point, not a target. */
  neutralAllowance: number;
  /** What the pacing curve says you should still be holding, in dollars. */
  holdFloor: number;
  /** The most you should commit across every claim this week. */
  weeklyCap: number;
  /** The most you should put on any single player. */
  maxSingleBid: number;
  /** The budget this league started with, which is what every rule of thumb is a share of. */
  originalBudget: number;
  /** Your share of all FAAB still held by living teams. */
  purchasingPowerShare: number;
  /** The largest bid any one rival could make. */
  maxRivalBid: number;
  notes: string[];
}

function interpolateHold(done: number): number {
  const x = Math.min(1, Math.max(0, done));
  for (let i = 1; i < HOLD_CURVE.length; i++) {
    const a = HOLD_CURVE[i - 1];
    const b = HOLD_CURVE[i];
    if (x <= b.done) {
      const span = b.done - a.done;
      const t = span === 0 ? 0 : (x - a.done) / span;
      return a.hold + t * (b.hold - a.hold);
    }
  }
  return 0;
}

export function phaseFor(teamsAlive: number): Phase {
  if (teamsAlive <= 2) return "duel";
  if (teamsAlive <= 4) return "endgame";
  if (teamsAlive <= INVERSION_TEAMS) return "consolidation";
  return "field";
}

const PHASE_NOTE: Record<Phase, string> = {
  field:
    "Still avoiding last place. Floor and health beat ceiling, and there are more chopped rosters coming, so missing this week's star is not fatal.",
  consolidation:
    "The format is inverting. Being hole-free is no longer enough: start trading depth for players who would start in the final four.",
  endgame:
    "Outscore the survivors. Ceiling and touchdown equity now matter more than floor, and denying a rival an upgrade is a legitimate reason to bid.",
  duel:
    "Head to head. Leftover FAAB is worth exactly zero, so the only question is which combination of players beats them.",
};

export function planBudget(input: BudgetInput): BudgetPlan {
  const { budget, remaining, teamsAlive, totalTeams, posture, rivalRemaining } = input;

  const phase = phaseFor(teamsAlive);
  const eliminationsRemaining = Math.max(0, teamsAlive - 1);
  const totalEliminations = Math.max(1, totalTeams - 1);
  const done = (totalEliminations - eliminationsRemaining) / totalEliminations;

  const holdFloor = budget * interpolateHold(done);
  const paceCap = Math.max(0, remaining - holdFloor);

  const notes: string[] = [];
  let weeklyCap: number;

  if (phase === "duel" || phase === "endgame") {
    weeklyCap = remaining;
    notes.push(
      "Pacing is switched off. There may be no later run worth saving for, so unspent money is a wasted asset.",
    );
  } else if (posture === "red") {
    // Survival overrides pacing. Money you save this week is money you lose.
    weeklyCap = Math.max(paceCap, Math.min(remaining, budget * RED_WEEK_CEILING));
    notes.push(
      `Pacing is overridden because you are in danger. The ceiling is ${Math.round(RED_WEEK_CEILING * 100)}% of budget, which is what the sources allow even in a dire week.`,
    );
  } else if (posture === "yellow") {
    weeklyCap = Math.min(paceCap, budget * YELLOW_WEEK_CEILING);
  } else {
    weeklyCap = Math.min(paceCap, budget * GREEN_WEEK_CEILING);
    notes.push(
      "You are clear, so this is a price-enforcing week. Bid small on good players, expect to lose, and let a desperate team pay the premium.",
    );
  }

  weeklyCap = Math.max(0, Math.min(weeklyCap, remaining));

  const maxSingleBid =
    phase === "field"
      ? Math.min(weeklyCap, budget * MAX_SINGLE_BID_EARLY)
      : weeklyCap;

  const rivalTotal = rivalRemaining.reduce((s, r) => s + r, 0);
  const pool = rivalTotal + remaining;

  const plan: BudgetPlan = {
    phase,
    phaseNote: PHASE_NOTE[phase],
    eliminationsRemaining,
    neutralAllowance: eliminationsRemaining > 0 ? remaining / eliminationsRemaining : remaining,
    holdFloor,
    weeklyCap,
    maxSingleBid,
    originalBudget: budget,
    purchasingPowerShare: pool > 0 ? remaining / pool : 0,
    maxRivalBid: rivalRemaining.length > 0 ? Math.max(...rivalRemaining) : 0,
    notes,
  };

  if (plan.purchasingPowerShare > 1.5 / Math.max(1, teamsAlive)) {
    notes.push(
      `You hold ${(plan.purchasingPowerShare * 100).toFixed(1)}% of the FAAB still alive in this league against an even share of ${((1 / Math.max(1, teamsAlive)) * 100).toFixed(1)}%. That is a real weapon later; do not spend it on a bench player now.`,
    );
  }

  if (plan.maxRivalBid > remaining && phase !== "field") {
    notes.push(
      `A rival can outbid you on any single player (their max is ${Math.round(plan.maxRivalBid)} against your ${Math.round(remaining)}). Win the players they cannot afford to chase, not the one they will.`,
    );
  }

  return plan;
}
