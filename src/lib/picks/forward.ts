// The forward check on the weekly rule and Tier 2. Pure.
//
// The rule is the best of about a dozen cuts by past record, so the winner
// can be a lucky cut. Owner's call (2026-11-02): a newly chosen cut must also
// win past break-even on games after it was first chosen, with at least 10
// of them, before it stakes. The cut that was the rule when the check went in
// is grandfathered: it keeps staking unless its forward record falls below
// break-even once it has 10+ forward games. A tier that fails is shown, but
// tracked only (tierBoard demotes its games, so nothing downstream stakes it).
//
// "Chosen" is per league and season, by week: a cut first chosen for Week W
// (in that week's frozen board) decided Week W's games, so its forward games
// are the graded games from Week W on that it bets. They are graded exactly as
// the tier's record is: the rule on every game it takes, Tier 2 only on the
// games it adds outside the rule (pickSecond).

import { BREAK_EVEN, type Cut, type GradedGame, MIN_SAMPLE, type Result, type StrategyBoard, cutResult } from "./engine";

/** When a cut was first chosen as Tier 1 or Tier 2 (chosen-store.ts). */
export interface Chosen {
  /** First week whose games it decided. */
  week: number;
  /** When that was recorded (ISO). */
  at: string;
  tier: "t1" | "t2";
  /** The rule in force when the check went in: stakes until 10+ forward games show it below break-even. */
  grandfathered?: boolean;
  /** How the date was found: a weekly freeze, an issued record, or the day of the backfill. */
  source?: "freeze" | "issued" | "today";
}

export type ChosenMap = { [cutId: string]: Chosen };

export interface ForwardCheck {
  stake: boolean;
  /** Decided forward games (pushes don't count, as with MIN_SAMPLE). */
  n: number;
  w: number;
  l: number;
  /** First week counted. */
  since: number;
  grandfathered: boolean;
  /** One short plain line for the board and the email. */
  reason: string;
}

const recOf = (w: number, l: number) => `${w}-${l}`;

/**
 * Whether a chosen cut may stake, from its record on games after it was
 * first chosen. `firstChosen` undefined means chosen now (`currentWeek`), so
 * it has no forward games yet. `games` are the games it may be graded on
 * (for Tier 2, the ones outside the rule); anything before its first week is
 * ignored. `currentWeek` caps the count at the weeks already settled.
 */
export function forwardCheck(cut: Cut, firstChosen: Pick<Chosen, "week" | "grandfathered"> | undefined, games: GradedGame[], currentWeek: number | null): ForwardCheck {
  const since = firstChosen?.week ?? currentWeek ?? Infinity;
  const results = games
    .filter((g) => g.week >= since && (currentWeek === null || g.week < currentWeek))
    .map((g) => cutResult(g, cut))
    .filter((r): r is Result => r !== undefined);
  const w = results.filter((r) => r === "W").length;
  const l = results.filter((r) => r === "L").length;
  const n = w + l;
  const pct = n ? w / n : 0;
  const grandfathered = !!firstChosen?.grandfathered;
  const wk = Number.isFinite(since) ? ` since Week ${since}` : "";
  if (grandfathered) {
    if (n < MIN_SAMPLE) return { stake: true, n, w, l, since, grandfathered, reason: `Forward check: ${n} of ${MIN_SAMPLE} games${wk} (${recOf(w, l)}), kept staking while it builds.` };
    if (pct >= BREAK_EVEN) return { stake: true, n, w, l, since, grandfathered, reason: `Forward check passed: ${recOf(w, l)}${wk}.` };
    return { stake: false, n, w, l, since, grandfathered, reason: `Forward record below break-even (${recOf(w, l)}${wk}): tracked.` };
  }
  if (n < MIN_SAMPLE) return { stake: false, n, w, l, since, grandfathered, reason: `Forward check: ${n} of ${MIN_SAMPLE} games since chosen${n ? ` (${recOf(w, l)})` : ""}, tracked until then.` };
  if (pct > BREAK_EVEN) return { stake: true, n, w, l, since, grandfathered, reason: `Forward check passed: ${recOf(w, l)}${wk}.` };
  return { stake: false, n, w, l, since, grandfathered, reason: `Forward record below break-even (${recOf(w, l)}${wk}): tracked.` };
}

/**
 * The board with each tier's forward check attached. `chosen` null means the
 * dates couldn't be read: both tiers are tracked (fail closed, real money).
 */
export function applyForward(s: StrategyBoard, games: GradedGame[], chosen: ChosenMap | null, currentWeek: number | null): StrategyBoard {
  const unread: ForwardCheck = { stake: false, n: 0, w: 0, l: 0, since: currentWeek ?? 0, grandfathered: false, reason: "Could not read when this cut was chosen: tracked." };
  const rule = s.rule ? { ...s.rule, forward: chosen ? forwardCheck(s.rule, chosen[s.rule.id], games, currentWeek) : unread } : null;
  const outside = s.rule ? games.filter((g) => cutResult(g, s.rule!) === undefined) : games;
  const second = s.second ? { ...s.second, forward: chosen ? forwardCheck(s.second, chosen[s.second.id], outside, currentWeek) : unread } : null;
  return { ...s, rule, second };
}

/** One short plain line on both tiers' forward checks, or "" when neither has one. */
export function forwardNote(s: Pick<StrategyBoard, "rule" | "second">): string {
  return [s.rule?.forward ? `Tier 1: ${s.rule.forward.reason}` : "", s.second?.forward ? `Tier 2: ${s.second.forward.reason}` : ""].filter(Boolean).join(" ");
}

/** Board wording for a game whose tier failed its forward check. */
export const holdText = (t: "t1" | "t2") => `fits ${t === "t1" ? "Tier 1" : "Tier 2"}, tracked: its forward check hasn't passed`;

/** Pure: the backfill entries from the season's freezes and issued records. */
export function backfillEntries(
  freezes: { week: number; board: Pick<StrategyBoard, "rule" | "second"> }[],
  issued: { week: number; rule?: { id: string } | null; second?: { id: string } | null }[],
  current: { week: number | null; ruleId: string | null; grandfather: boolean },
  at: string,
): ChosenMap {
  const seen: { id: string; week: number; tier: "t1" | "t2"; source: "freeze" | "issued" }[] = [
    ...freezes.flatMap((f) => [
      ...(f.board.rule ? [{ id: f.board.rule.id, week: f.week, tier: "t1" as const, source: "freeze" as const }] : []),
      ...(f.board.second ? [{ id: f.board.second.id, week: f.week, tier: "t2" as const, source: "freeze" as const }] : []),
    ]),
    ...issued.flatMap((r) => [
      ...(r.rule ? [{ id: r.rule.id, week: r.week, tier: "t1" as const, source: "issued" as const }] : []),
      ...(r.second ? [{ id: r.second.id, week: r.week, tier: "t2" as const, source: "issued" as const }] : []),
    ]),
  ].sort((a, b) => a.week - b.week || (a.tier === "t1" ? -1 : 1));
  const out: ChosenMap = {};
  for (const x of seen) out[x.id] ??= { week: x.week, at, tier: x.tier, source: x.source };
  if (current.ruleId && current.grandfather) {
    const asRule = seen.find((x) => x.id === current.ruleId && x.tier === "t1");
    out[current.ruleId] = asRule
      ? { week: asRule.week, at, tier: "t1", grandfathered: true, source: asRule.source }
      : { week: current.week ?? 0, at, tier: "t1", grandfathered: true, source: "today" };
  }
  return out;
}
