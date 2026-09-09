import type { Calibration } from "./calibration";
import type { Candidate } from "./types";

// When the top of the board is a coin flip, say so.
//
// The engine ranks candidates by log(equity) minus future cost and reports
// candidates[0] as the pick. That is the right ordering, and reporting it as
// though it were a decision is wrong whenever the gap is smaller than the error
// in the inputs.
//
// The real case: week 1 of 2026 came back LAC at 1.00530 equity and JAX at
// 1.00471, a gap of 0.0006, and the email named LAC with no hint that JAX was
// indistinguishable. Jack asked why LAC, which is exactly the question a reader
// should not have to ask.
//
// The dominant uncertainty is ownership. It is Yahoo's national distribution
// bent toward the pool by a factor fitted from completed weeks, and until weeks
// have been logged it is the national figure unmodified. So the band is sized
// off the calibration's own confidence rather than picked out of the air.

/**
 * How far apart two scores have to be before the difference means anything,
 * in the log-equity units the engine ranks by.
 *
 * The anchor is the "none" case, and it is derived rather than guessed. A pool
 * whose ownership differs from the national number by about five points moves
 * field survival by roughly a point, which moves equity by about one percent,
 * which is 0.01 in log terms. Every tighter band is that number shrinking as
 * real weeks are logged and the fit stops being a guess.
 */
export function tieBandFor(confidence: Calibration["confidence"]): number {
  switch (confidence) {
    case "none":
      return 0.01;
    case "low":
      return 0.007;
    case "medium":
      return 0.004;
    case "good":
      return 0.002;
    default:
      return 0.01;
  }
}

/**
 * The candidates that cannot honestly be separated from the best one.
 *
 * Always includes the pick itself, so a caller can render the list without
 * checking whether it is empty. A length of 1 means the pick is genuinely ahead.
 */
export function tiedWithBest(
  candidates: Candidate[],
  confidence: Calibration["confidence"],
): Candidate[] {
  if (candidates.length === 0) return [];
  const band = tieBandFor(confidence);
  const best = candidates[0].score;
  return candidates.filter((c) => best - c.score <= band);
}

/**
 * The sentence explaining a tie, or null when there is a clear best.
 *
 * Names them all rather than hedging about the leader, because "take any of
 * these" is the actual advice and burying it in a caveat about the leader is
 * how a reader ends up thinking the first one is better anyway.
 */
export function tieNote(
  tied: Candidate[],
  confidence: Calibration["confidence"],
): string | null {
  if (tied.length < 2) return null;

  const names = tied.map((c) => c.team);
  const list =
    names.length === 2
      ? `${names[0]} and ${names[1]}`
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

  const gap = tied[0].score - tied[tied.length - 1].score;
  const asPercent = (Math.exp(gap) - 1) * 100;

  const why =
    confidence === "none"
      ? "Ownership is still the national number with no weeks logged, so a gap this small is inside the error."
      : `Ownership is fitted on ${confidence} confidence, so a gap this small is inside the error.`;

  return `${list} are effectively tied: ${asPercent.toFixed(2)}% of equity separates them. ${why} Take whichever you prefer.`;
}
