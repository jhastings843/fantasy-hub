import type { Ownership } from "./types";

/**
 * Your pool's pick distribution is not visible until the week is over, so it
 * can never be an input to this week's decision. What it CAN do is tell you how
 * your pool differs from the public, and that difference is stable enough to
 * carry forward.
 *
 * The model is one parameter. Take the public distribution and raise every
 * team's share to the power alpha, then renormalise:
 *
 *   q_pool(i)  proportional to  q_public(i) ^ alpha
 *
 * alpha = 1 means your pool behaves exactly like the public. Above 1 it piles
 * onto the chalk harder than the public does (the favourite's share grows, the
 * long tail shrinks). Below 1 it is flatter and more contrarian. One parameter
 * is the right amount of model for the handful of weeks of data you will ever
 * have: anything richer would fit noise.
 */

export interface Observation {
  week: number;
  /** Public distribution that week, 0-1. */
  publicPicks: Ownership;
  /** What your pool actually did that week, 0-1. */
  poolPicks: Ownership;
}

export interface Calibration {
  /** The factor actually applied, after shrinking toward 1. */
  alpha: number;
  /** The unshrunk best fit, for display. */
  rawAlpha: number;
  /** Completed weeks the fit is based on. */
  weeks: number;
  confidence: "none" | "low" | "medium" | "good";
  /** Plain-language read of what alpha means. */
  summary: string;
}

const MIN_ALPHA = 0.25;
const MAX_ALPHA = 4;

/** Raise each share to a power and renormalise over the teams supplied. */
export function projectOwnership(
  publicPicks: Ownership,
  alpha: number,
  teams?: string[],
): Ownership {
  const keys = teams ?? Object.keys(publicPicks);
  const raised: Ownership = {};
  let total = 0;
  for (const t of keys) {
    const p = publicPicks[t] ?? 0;
    const v = p <= 0 ? 0 : Math.pow(p, alpha);
    raised[t] = v;
    total += v;
  }
  if (total <= 0) {
    const even = keys.length > 0 ? 1 / keys.length : 0;
    for (const t of keys) raised[t] = even;
    return raised;
  }
  for (const t of keys) raised[t] /= total;
  return raised;
}

/** Squared error between the projection at this alpha and what the pool did. */
function errorAt(obs: Observation[], alpha: number): number {
  let err = 0;
  for (const o of obs) {
    // Compare only over the teams the pool observation actually covers, with
    // the public side renormalised to the same support.
    const teams = Object.keys(o.poolPicks).filter((t) => t in o.publicPicks);
    if (teams.length < 2) continue;
    const projected = projectOwnership(o.publicPicks, alpha, teams);
    let poolTotal = 0;
    for (const t of teams) poolTotal += o.poolPicks[t] ?? 0;
    if (poolTotal <= 0) continue;
    for (const t of teams) {
      const actual = (o.poolPicks[t] ?? 0) / poolTotal;
      const d = projected[t] - actual;
      err += d * d;
    }
  }
  return err;
}

/**
 * Golden-section search over alpha. The objective is smooth and one
 * dimensional, so this converges in about forty evaluations and does not need
 * a dependency.
 */
export function fitAlpha(obs: Observation[]): number {
  const usable = obs.filter(
    (o) => Object.keys(o.poolPicks).filter((t) => t in o.publicPicks).length >= 2,
  );
  if (usable.length === 0) return 1;

  const phi = (Math.sqrt(5) - 1) / 2;
  let lo = MIN_ALPHA;
  let hi = MAX_ALPHA;
  let c = hi - phi * (hi - lo);
  let d = lo + phi * (hi - lo);
  let fc = errorAt(usable, c);
  let fd = errorAt(usable, d);

  for (let i = 0; i < 60 && hi - lo > 1e-4; i++) {
    if (fc < fd) {
      hi = d;
      d = c;
      fd = fc;
      c = hi - phi * (hi - lo);
      fc = errorAt(usable, c);
    } else {
      lo = c;
      c = d;
      fc = fd;
      d = lo + phi * (hi - lo);
      fd = errorAt(usable, d);
    }
  }
  return (lo + hi) / 2;
}

function describe(alpha: number, weeks: number): string {
  if (weeks === 0) {
    return "No completed weeks logged yet, so the public distribution is being used as-is. Log what your pool did once a week ends and this starts correcting for it.";
  }
  const pool = weeks === 1 ? "1 week" : `${weeks} weeks`;
  if (alpha > 1.15) {
    return `Across ${pool}, your pool piles onto the chalk harder than the public does. Popular teams are being marked up and the long tail marked down, which makes the leverage plays look better than Yahoo alone would say.`;
  }
  if (alpha < 0.85) {
    return `Across ${pool}, your pool spreads out more than the public does. The chalk is being marked down, which makes fading it less valuable than Yahoo alone would say.`;
  }
  return `Across ${pool}, your pool has tracked the public closely, so the projection is close to Yahoo's raw numbers.`;
}

function confidenceFor(weeks: number): Calibration["confidence"] {
  if (weeks === 0) return "none";
  if (weeks <= 2) return "low";
  if (weeks <= 5) return "medium";
  return "good";
}

/**
 * The pool this shrinkage was originally tuned against, and the reason the
 * formula below reduces to the old one. With 500 entries a week,
 * T/(T+SHRINK_ENTRIES) is exactly weeks/(weeks+2), so the deliberate "one week
 * moves it a third of the way" choice is preserved rather than re-tuned.
 */
const REFERENCE_ENTRIES = 500;
const SHRINK_ENTRIES = 1000;

/**
 * Confidence from how much of the pool has actually been observed, which is not
 * the same question as how many weeks have gone by.
 *
 * A logged week measures the pool's distribution with sampling error that goes
 * as 1/sqrt(entries): at 500 entries a 30% share is measured to about 2 points,
 * at 30 entries to about 8.4, and one person is 3.3 points all by themselves.
 * Information goes as the entry count, so a small pool's chalk factor is a
 * genuinely weaker estimate no matter how patient you are. Twelve logged weeks
 * of a 30-entry pool carry less information than one week of a 500-entry one.
 */
function confidenceFromEntries(weight: number): Calibration["confidence"] {
  if (weight >= 0.3) return "good";
  if (weight >= 0.15) return "medium";
  return "low";
}

const RANK: Calibration["confidence"][] = ["none", "low", "medium", "good"];

/** The weaker of two confidence readings. */
function weaker(
  a: Calibration["confidence"],
  b: Calibration["confidence"],
): Calibration["confidence"] {
  return RANK.indexOf(a) <= RANK.indexOf(b) ? a : b;
}

/**
 * Fit alpha and shrink it toward 1 by the number of weeks observed. One week of
 * data is a coincidence, not a tendency, so a single observation only moves the
 * factor a third of the way toward its own best fit.
 */
export function calibrate(
  obs: Observation[],
  entriesPerWeek: number = REFERENCE_ENTRIES,
): Calibration {
  const usable = obs.filter(
    (o) => Object.keys(o.poolPicks).filter((t) => t in o.publicPicks).length >= 2,
  );
  const weeks = usable.length;
  if (weeks === 0) {
    return {
      alpha: 1,
      rawAlpha: 1,
      weeks: 0,
      confidence: "none",
      summary: describe(1, 0),
    };
  }
  const rawAlpha = fitAlpha(usable);
  // Shrink on entries observed, not weeks. See REFERENCE_ENTRIES: at 500 this is
  // identical to weeks/(weeks+2), and below it a week simply counts for less.
  const observed = Math.max(1, entriesPerWeek) * weeks;
  const weight = observed / (observed + SHRINK_ENTRIES);
  const shrunk = 1 + (rawAlpha - 1) * weight;
  const alpha = Math.min(MAX_ALPHA, Math.max(MIN_ALPHA, shrunk));

  const byWeeks = confidenceFor(weeks);
  const byEntries = confidenceFromEntries(weight);
  const confidence = weaker(byWeeks, byEntries);

  return {
    alpha,
    rawAlpha,
    weeks,
    confidence,
    summary:
      RANK.indexOf(byEntries) < RANK.indexOf(byWeeks)
        ? `${describe(alpha, weeks)} Confidence is capped by pool size rather than by patience: at ${Math.round(entriesPerWeek)} entries a week, one person is ${((1 / Math.max(1, entriesPerWeek)) * 100).toFixed(1)} points of the distribution, so the fit stays a weak estimate however many weeks are logged.`
        : describe(alpha, weeks),
  };
}
