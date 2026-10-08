// The protected risk envelope. Pure constants.
//
// These are the hard limits every stake has to fit inside. Nothing automatic
// may raise them: the strategy review can choose policies WITHIN them, and
// limits.test.ts pins the values so a change here is a deliberate, reviewed
// edit by a person, never a side effect of an automated cycle.
//
// Bankroll: one shared bankroll for both sports, 1u = 1% of it. Each sport
// has its own weekly budget (the Tuesday card plus any game-day additions
// that week), and everything issued and not yet settled, across both sports,
// is capped together. 30u outstanding is exactly the two weekly budgets, so
// the cross-sport cap never enlarges what the per-sport budgets allow; it
// only binds when last week's bets are still open.

/** Smallest bet. Under this the price has eaten the edge: not a bet. */
export const MIN_STAKE = 0.25;
/** Largest single bet. */
export const MAX_STAKE = 5;
/** Most risked on one game across every bet that touches it (spread, total, any slot). */
export const PER_GAME_CAP = 5;
/** Most risked per sport per week: the card plus game-day additions. */
export const WEEKLY_CAP = 15;
/** Most risked and unsettled across both sports at once. */
export const OUTSTANDING_CAP = 30;
/** Staking may never be more aggressive than a quarter Kelly... */
export const MAX_KELLY_SCALE = 0.25;
/** ...nor trust a record more than a 100-game pull toward 50%. */
export const MIN_PRIOR_GAMES = 100;
/** Parlays, if ever re-enabled by evidence, stay at or under this. */
export const PARLAY_MAX = 1;

export const ENVELOPE = {
  MIN_STAKE,
  MAX_STAKE,
  PER_GAME_CAP,
  WEEKLY_CAP,
  OUTSTANDING_CAP,
  MAX_KELLY_SCALE,
  MIN_PRIOR_GAMES,
  PARLAY_MAX,
} as const;
