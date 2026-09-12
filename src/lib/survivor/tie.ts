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
  tiebreak?: "safety" | "leverage",
): string | null {
  if (tied.length < 2) return null;

  const names = tied.map((c) => c.team);
  const list =
    names.length === 2
      ? `${names[0]} and ${names[1]}`
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

  // The SPREAD across the band, not tied[0] minus the last one. Those were the
  // same number only while this array was sorted by score, and breaking a tie
  // toward leverage deliberately puts a slightly lower-scoring team first. The
  // live board printed "-0.54% of equity separates them" before this.
  const scores = tied.map((c) => c.score);
  const gap = Math.max(...scores) - Math.min(...scores);
  const asPercent = (Math.exp(gap) - 1) * 100;

  const why =
    confidence === "none"
      ? "Ownership is still the national number with no weeks logged, so a gap this small is inside the error."
      : `Ownership is fitted on ${confidence} confidence, so a gap this small is inside the error.`;

  // Without a posture the honest ending is a shrug. With one, something can
  // separate them after all, and the note has to say what it was rather than
  // presenting a decision the reader cannot audit.
  const chosen = tied[0];
  const ending =
    tiebreak === "safety"
      ? `Taking ${chosen.team} as the safer of them at ${(chosen.winProb * 100).toFixed(1)}% to win, because this pool is expected to thin to one entry and surviving is what wins it.`
      : tiebreak === "leverage"
        ? `Taking ${chosen.team} as the less owned of them at ${(chosen.ownership * 100).toFixed(1)}% of the field, because this pool is expected to end with several entries splitting and fewer rivals can follow you here.`
        : "Take whichever you prefer.";

  return `${list} are effectively tied: ${asPercent.toFixed(2)}% of equity separates them. ${why} ${ending}`;
}

/**
 * Order the teams inside the tie band by what the pool is actually playing for,
 * leaving everything outside the band exactly where the equity ranking put it.
 *
 * This is the only place the pool's shape is allowed to change a pick, and the
 * reason it is allowed here is that the band is the engine's own statement that
 * these teams cannot be separated on equity. Outside the band the gap is real
 * and a posture must not overrule it: leverage would happily promote a team
 * seven percent behind on equity because it is lightly owned, which is the
 * mistake this function is shaped to make impossible.
 *
 * safety   the field is expected to thin past one entry, so surviving is
 *          winning and the higher win probability takes it.
 * leverage a crowd is expected to be left sharing the prize, so the team fewer
 *          rivals can follow you onto takes it.
 */
export function orderTieByPosture(
  candidates: Candidate[],
  confidence: Calibration["confidence"],
  tiebreak: "safety" | "leverage",
): Candidate[] {
  if (candidates.length < 2) return [...candidates];

  const band = tieBandFor(confidence);
  const best = candidates[0].score;
  const tiedCount = candidates.filter((c) => best - c.score <= band).length;
  if (tiedCount < 2) return [...candidates];

  const head = candidates.slice(0, tiedCount);
  const tail = candidates.slice(tiedCount);
  head.sort((a, b) =>
    tiebreak === "safety" ? b.winProb - a.winProb : a.ownership - b.ownership,
  );
  return [...head, ...tail];
}
