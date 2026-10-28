// The picks policy: the choices the strategy review may change, inside the
// protected envelope (limits.ts). Pure.
//
// A policy is frozen once written: a new choice is a new version, never an
// edit, and every issued card records the version it was made under, so a
// card can always be re-graded and re-explained exactly as it was sent.

import { MAX_KELLY_SCALE, MIN_PRIOR_GAMES } from "./limits";

export interface StakingPolicy {
  /** "kelly": fractional Kelly on the tier record shrunk toward 50%. "flat": the same units on every bet. */
  kind: "kelly" | "flat";
  kellyScale: number;
  priorGames: number;
  flatUnits: number;
}

export interface PicksPolicy {
  id: string;
  /** Human summary of what differs from the baseline. */
  summary: string;
  createdAt: string;
  staking: StakingPolicy;
  /**
   * Parlays stay off: a product of uncalibrated leg estimates is not a
   * demonstrated edge, and DraftKings' actual parlay price is not quoted to
   * us. A parlay policy runs in shadow until single-bet calibration holds.
   */
  parlays: { enabled: false };
  /** Research cuts the review has activated as ATS rule candidates, league-scoped ("nfl:dog-band-a"). */
  atsCandidates: string[];
  /** Totals refinements the review has activated as rule candidates, league-scoped ("nfl:t-under"). "t-agree" is always one. */
  totalsCandidates?: string[];
  /** The straight-up method the review switched to, per league; absent = SU_DEFAULT. */
  suMethod?: { nfl?: string; cfb?: string };
  /** Outside sources (college): how each is used, as the review last set it; absent = SOURCE_DEFAULT. */
  sources?: { pem?: SourceState; harris?: SourceState };
  /** When the review last switched each source: its value test restarts then. */
  sourcesChangedAt?: { pem?: string; harris?: string };
  /**
   * Splits signals the review made live, per league (learning/model.ts
   * MarketFilter ids). A sent bet one of them flags gets a "skip" alert about
   * 45 minutes before kickoff (splits-alert.ts); the 9am email is unchanged.
   */
  marketSkips?: { nfl?: string[]; cfb?: string[] };
}

/**
 * How an outside source feeds the college rule.
 *   out    ignored: none of its cuts can be the rule, it vetoes nothing.
 *   cuts   its agreement cuts compete for the rule (PEM's "All three agree"...); no veto.
 *   veto   as cuts, and a rule bet it disagrees with is skipped.
 * The strategy review moves a source between these on forward evidence only
 * (learning/model.ts "source"): a clear gain from skipping its disagreements
 * adds the veto; a clear loss drops it to out.
 */
export type SourceState = "out" | "cuts" | "veto";
export type Source = "pem" | "harris";
/** As of 2026-10-20: PEM's cuts compete (no veto), Harris is tracked only. */
export const SOURCE_DEFAULT: { [s in Source]: SourceState } = { pem: "cuts", harris: "out" };
export const sourceState = (p: PicksPolicy, s: Source): SourceState => p.sources?.[s] ?? SOURCE_DEFAULT[s];

/**
 * The straight-up method in force when straight up joined the learning loop
 * (2026-10-20): each league's best season record then (NFL the models'
 * average, college the Vegas favorite). From here a method changes only when a
 * challenger beats it on games after registration.
 */
export const SU_DEFAULT = { nfl: "avg", cfb: "vegas" } as const;
export const suInForce = (p: PicksPolicy, league: "nfl" | "cfb"): string => p.suMethod?.[league] ?? SU_DEFAULT[league];
/** Totals cuts allowed to be the rule: the built-in agreement cut plus activated refinements. */
export const totalsAllowed = (p: PicksPolicy, league: "nfl" | "cfb"): Set<string> =>
  new Set(["t-agree", ...(p.totalsCandidates ?? []).filter((x) => x.startsWith(`${league}:`)).map((x) => x.slice(league.length + 1))]);

export const BASELINE_POLICY: PicksPolicy = {
  id: "p1",
  summary: "Quarter Kelly on tier records shrunk toward 50% over 100 games; parlays off; built-in cuts only.",
  createdAt: "2026-10-09T00:00:00Z",
  staking: { kind: "kelly", kellyScale: 0.25, priorGames: 100, flatUnits: 1 },
  parlays: { enabled: false },
  atsCandidates: [],
};

/**
 * Live sizing from 2026-10-10 (Jack's call): flat 1u on every eligible pick.
 * Which picks are eligible is still the p1 quarter-Kelly price gate
 * (staking.ts ELIGIBILITY), so this changes stake sizes only, never which
 * picks are bets. The tier records behind Kelly's sizes are not shown
 * calibrated, so p1's larger stakes run in shadow (learning: the quarter-Kelly
 * challenger) and come back only through the review's calibration gate.
 * p1 stays frozen as the gate and as a version a card may have been sent under.
 */
export const FLAT_POLICY: PicksPolicy = {
  id: "p2",
  summary: "Flat 1u on every pick that passes the quarter-Kelly price gate; quarter Kelly runs in shadow; parlays off; built-in cuts only.",
  createdAt: "2026-10-10T17:00:00Z",
  staking: { kind: "flat", kellyScale: 0.25, priorGames: 100, flatUnits: 1 },
  parlays: { enabled: false },
  atsCandidates: [],
};

/** The policy in force when the review has not activated another. */
export const DEFAULT_POLICY: PicksPolicy = FLAT_POLICY;

/** Policies defined in code, by id, so a stored pointer or a rollback can always find them. */
export const CODE_POLICIES: { [id: string]: PicksPolicy } = { [BASELINE_POLICY.id]: BASELINE_POLICY, [FLAT_POLICY.id]: FLAT_POLICY };

/** What a policy may not do, however good its evidence. */
export function envelopeViolations(p: PicksPolicy): string[] {
  const out: string[] = [];
  if (p.staking.kellyScale > MAX_KELLY_SCALE) out.push(`Kelly scale ${p.staking.kellyScale} exceeds ${MAX_KELLY_SCALE}`);
  if (p.staking.priorGames < MIN_PRIOR_GAMES) out.push(`prior ${p.staking.priorGames} games is under ${MIN_PRIOR_GAMES}`);
  if (p.staking.kellyScale <= 0 && p.staking.kind === "kelly") out.push("Kelly scale must be positive");
  if (p.staking.flatUnits <= 0 || p.staking.flatUnits > 2) out.push("flat stake must be in (0, 2] units");
  if ((p.parlays as { enabled: boolean }).enabled) out.push("parlays cannot be enabled by policy");
  return out;
}
