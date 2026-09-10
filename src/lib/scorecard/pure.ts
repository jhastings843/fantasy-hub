import { bestLineup, type LineupPlayer } from "@/lib/lineup/solve";
import type { AdvicePlayer } from "@/lib/lineup/weekly-advice";

// Was any of it right?
//
// Everything above this file reasons about accuracy without measuring it. The
// app recommends a lineup, applies a scoring adjustment that reorders his
// rankings, and has never once been told what actually happened. A season of
// that is the only thing that can answer whether the advice beats what Jack
// would have done anyway, and whether the adjustment earns its place.
//
// Four lineups are scored on the same real points:
//
//   started   what Jack actually had in on Sunday morning
//   advised   what the app recommended, adjustment included
//   raw       what Jingles' unmodified ranking would have set
//   perfect   the best the roster could have done, known only afterwards
//
// started vs advised answers "is this worth reading". advised vs raw answers
// "does the adjustment help", in points rather than in argument. perfect is the
// ceiling, so a small gap between the first three can be read as the week being
// undecidable rather than as the app being clever.
//
// Pure. The fetching is in run.ts.

/** A player's actual points, scored under the league's own settings. */
export type ActualPoints = Record<string, number>;

export interface LineupScore {
  /** Player ids in slot order. Empty string for a slot nobody filled. */
  players: string[];
  points: number;
  /** Per player, so a bad week can be pointed at rather than argued about. */
  perPlayer: { playerId: string; points: number }[];
}

export function scoreLineup(players: string[], actual: ActualPoints): LineupScore {
  const perPlayer = players
    .filter((id) => id && id !== "0")
    .map((id) => ({ playerId: id, points: actual[id] ?? 0 }));
  return {
    players,
    points: Number(perPlayer.reduce((sum, p) => sum + p.points, 0).toFixed(2)),
    perPlayer,
  };
}

/**
 * The best the roster could have done, known only after the fact.
 *
 * Deliberately solved with the SAME solver the advice uses, fed actual points
 * instead of ranks. If the ceiling were computed a different way, a gap between
 * it and the advice could be the solver rather than the advice, and the whole
 * comparison would prove nothing.
 *
 * Injuries and byes are not filtered here: a player who did not play scored
 * zero, and the solver will not choose him over somebody who did. Filtering
 * would additionally require knowing who was active, which is a second source
 * that can disagree with the first.
 */
export function perfectLineup(
  roster: string[],
  rosterPositions: string[],
  positionOf: (playerId: string) => string,
  actual: ActualPoints,
): string[] {
  const players: LineupPlayer[] = roster.map((id) => ({
    playerId: id,
    position: positionOf(id),
    points: actual[id] ?? 0,
  }));
  return bestLineup(players, rosterPositions).slots.map((s) => s.player?.playerId ?? "");
}

/**
 * The lineup his ranking would have set with no scoring adjustment applied.
 *
 * Takes the advice function rather than duplicating it, so the two can never
 * drift into answering slightly different questions.
 */
export function rawRankedLineup(
  roster: AdvicePlayer[],
  rosterPositions: string[],
  advise: (input: {
    rosterPositions: string[];
    roster: AdvicePlayer[];
    currentStarters: string[];
  }) => { slots: { recommended: { playerId: string } | null }[] },
): string[] {
  const stripped = roster.map((p) => ({ ...p, adjustedFlexRank: null }));
  return advise({ rosterPositions, roster: stripped, currentStarters: [] }).slots.map(
    (s) => s.recommended?.playerId ?? "",
  );
}

export interface WeekVerdict {
  /** Points the app's recommendation would have scored. */
  advised: number;
  /** Points Jack's own lineup scored. */
  started: number;
  /** Points his unadjusted ranking would have scored. */
  raw: number;
  /** The ceiling. */
  perfect: number;
  /** advised - started. Positive means reading the app would have helped. */
  vsStarted: number;
  /** advised - raw. Positive means the scoring adjustment helped. */
  vsRaw: number;
  /** How much of the available ceiling the advice captured, 0-1. */
  captured: number | null;
}

export function verdict(scores: {
  advised: number;
  started: number;
  raw: number;
  perfect: number;
}): WeekVerdict {
  const round = (n: number) => Number(n.toFixed(2));
  // Against the worst the roster could do, not against zero: capturing "80% of
  // perfect" is meaningless when the floor is already 70% of perfect. Measured
  // from what Jack actually started, so it reads as "how much of the gap
  // between me and perfect did the app close".
  const gap = scores.perfect - scores.started;
  return {
    advised: round(scores.advised),
    started: round(scores.started),
    raw: round(scores.raw),
    perfect: round(scores.perfect),
    vsStarted: round(scores.advised - scores.started),
    vsRaw: round(scores.advised - scores.raw),
    captured: gap > 0 ? Number(((scores.advised - scores.started) / gap).toFixed(3)) : null,
  };
}

/** Totals across every settled week, which is the only number that means much. */
export function season(verdicts: WeekVerdict[]): {
  weeks: number;
  vsStarted: number;
  vsRaw: number;
  weeksAhead: number;
  weeksBehind: number;
} {
  const round = (n: number) => Number(n.toFixed(2));
  return {
    weeks: verdicts.length,
    vsStarted: round(verdicts.reduce((s, v) => s + v.vsStarted, 0)),
    vsRaw: round(verdicts.reduce((s, v) => s + v.vsRaw, 0)),
    weeksAhead: verdicts.filter((v) => v.vsStarted > 0).length,
    weeksBehind: verdicts.filter((v) => v.vsStarted < 0).length,
  };
}
