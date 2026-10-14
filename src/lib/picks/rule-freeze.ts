import "server-only";
import { redis } from "@/lib/redis/client";
import type { StrategyBoard } from "./engine";
import type { League } from "./parse";

// The rule and Tier 2 are set once a week, at the Tuesday morning strategy
// review, and hold until the next one. Finals that land mid-week are graded
// and shown right away, but they only move the rule at the next review.

export interface RuleFreeze {
  league: League;
  season: number;
  week: number;
  /** When the freeze was saved (the first core build after the review). */
  at: string;
  /** The review it follows. */
  reviewAt: string;
  policyId: string;
  /** Last week the rule was chosen on. */
  throughWeek: number | null;
  board: StrategyBoard;
}

const KEY = (league: League, season: number, week: number) => `picks:v2:${league}:${season}:rule:w${week}`;

export async function loadRuleFreeze(league: League, season: number, week: number): Promise<RuleFreeze | null> {
  return (await redis.get<RuleFreeze>(KEY(league, season, week)).catch(() => null)) ?? null;
}

/**
 * Write-once: the first freeze for a week stands. Returns the one in force,
 * or null when nothing could be stored (the rule stays provisional and the
 * next build tries again, rather than showing a rule nothing holds).
 */
export async function saveRuleFreeze(f: RuleFreeze): Promise<RuleFreeze | null> {
  const k = KEY(f.league, f.season, f.week);
  const res = await redis.set(k, f, { nx: true, ex: 200 * 24 * 3600 }).then(
    (x) => (x === "OK" ? "saved" : "taken"),
    () => "failed" as const,
  );
  if (res === "saved") return f;
  if (res === "failed") return null;
  return loadRuleFreeze(f.league, f.season, f.week);
}
