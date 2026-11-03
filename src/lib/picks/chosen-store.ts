import "server-only";
import { redis } from "@/lib/redis/client";
import type { StrategyBoard } from "./engine";
import { type Chosen, type ChosenMap, backfillEntries, totalsBackfillEntries } from "./forward";
import type { IssuedRecord } from "./issued";
import type { League } from "./parse";
import { loadRuleFreeze } from "./rule-freeze";

// When each cut was FIRST chosen as Tier 1 or Tier 2, per league and season
// (forward.ts). One hash per league and season, field = cut id, write-once
// (HSETNX): a later week never moves a cut's first date.
//
// Backfill, once per league and season, the first time this runs: each cut's
// first week is the earliest week it was Tier 1 or Tier 2 in a saved weekly
// freeze (picks:v2:<league>:<season>:rule:w<N>) or an issued record's rule /
// second. The Tier 1 rule in force when the check went in (2026-11-02, read
// from the live freezes: NFL Week 8 and college Week 9) is grandfathered
// (owner's call) and dated from the earliest week it was Tier 1. It is pinned
// by id here, so a backfill that first runs after a later review can't
// grandfather a newer rule. Only 2026 has one; a later season starts fresh.

const KEY = (league: League, season: number) => `picks:v2:${league}:${season}:chosen`;
const DONE = "_backfilled";
export const GRANDFATHERED: { [season: number]: { [L in League]?: string } } = { 2026: { nfl: "road-dog", cfb: "near-vegas" } };

/** Every recorded cut, or null when Redis can't be read (the tiers then fail closed). */
export async function loadChosen(league: League, season: number): Promise<ChosenMap | null> {
  try {
    const h = ((await redis.hgetall<{ [id: string]: Chosen | string }>(KEY(league, season))) ?? {}) as { [id: string]: Chosen | string };
    return Object.fromEntries(Object.entries(h).filter(([k, v]) => k !== DONE && !k.startsWith(T) && typeof v === "object")) as ChosenMap;
  } catch {
    return null;
  }
}

// The totals rule (forward.ts, totals section): same hash, fields
// "totals:<id>", its own one-time backfill from the issued records'
// totalsRule. No totals rule was in force when the check went in
// (2026-11-02, read from the live cores: NFL and college both had none; the
// only one ever sent was college "t-agree" in Week 8, which lost its place
// after), so nothing is grandfathered: any totals rule needs 10+ forward
// games past break-even before it stakes.
const T = "totals:";
const T_DONE = `${T}_backfilled`;
export const GRANDFATHERED_TOTALS: { [season: number]: { [L in League]?: string } } = { 2026: {} };

/** Every recorded totals cut (ids without the prefix), or null when Redis can't be read (the rule then stays tracked). */
export async function loadTotalsChosen(league: League, season: number): Promise<ChosenMap | null> {
  try {
    const h = ((await redis.hgetall<{ [id: string]: Chosen | string }>(KEY(league, season))) ?? {}) as { [id: string]: Chosen | string };
    return Object.fromEntries(Object.entries(h).filter(([k, v]) => k.startsWith(T) && k !== T_DONE && typeof v === "object").map(([k, v]) => [k.slice(T.length), v])) as ChosenMap;
  } catch {
    return null;
  }
}

/**
 * Records this build's totals rule as chosen this week (first time only),
 * after the one-time backfill, and returns the totals map. Null when Redis
 * fails, which keeps the totals rule tracked.
 */
export async function noteTotalsChosen(league: League, season: number, week: number | null, ruleId: string | null, issued: IssuedRecord[]): Promise<ChosenMap | null> {
  try {
    const k = KEY(league, season);
    if (!(await redis.hexists(k, T_DONE))) {
      const entries = totalsBackfillEntries(issued, { week, pinned: GRANDFATHERED_TOTALS[season]?.[league] ?? null }, new Date().toISOString());
      await Promise.all(Object.entries(entries).map(([id, c]) => redis.hsetnx(k, `${T}${id}`, c)));
      await redis.hset(k, { [T_DONE]: new Date().toISOString() });
    }
    if (ruleId && week) await redis.hsetnx(k, `${T}${ruleId}`, { week, at: new Date().toISOString(), tier: "t1", source: "board" } satisfies Chosen);
  } catch {
    return null;
  }
  return loadTotalsChosen(league, season);
}

async function backfill(league: League, season: number, week: number | null, issued: IssuedRecord[]): Promise<void> {
  const weeks = week ? [...Array(week)].map((_, i) => i + 1) : [];
  const freezes = (await Promise.all(weeks.map((w) => loadRuleFreeze(league, season, w)))).flatMap((f) => (f ? [f] : []));
  const pinned = GRANDFATHERED[season]?.[league] ?? null;
  const entries = backfillEntries(freezes, issued, { week, ruleId: pinned, grandfather: !!pinned }, new Date().toISOString());
  const k = KEY(league, season);
  await Promise.all(Object.entries(entries).map(([id, c]) => redis.hsetnx(k, id, c)));
  await redis.hset(k, { [DONE]: new Date().toISOString() });
}

/**
 * Records the week's Tier 1 and Tier 2 as chosen (first time only) once the
 * week's rule is frozen, after a one-time backfill, and returns the map. Null
 * when Redis fails, which keeps both tiers tracked.
 */
export async function noteChosen(
  league: League,
  season: number,
  week: number | null,
  board: StrategyBoard,
  frozen: boolean,
  issued: IssuedRecord[],
): Promise<ChosenMap | null> {
  try {
    const k = KEY(league, season);
    if (!(await redis.hexists(k, DONE))) await backfill(league, season, week, issued);
    if (frozen && week) {
      const at = new Date().toISOString();
      await Promise.all([
        board.rule ? redis.hsetnx(k, board.rule.id, { week, at, tier: "t1", source: "freeze" } satisfies Chosen) : null,
        board.second ? redis.hsetnx(k, board.second.id, { week, at, tier: "t2", source: "freeze" } satisfies Chosen) : null,
      ]);
    }
  } catch {
    return null;
  }
  return loadChosen(league, season);
}
