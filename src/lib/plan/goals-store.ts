import "server-only";
import { z } from "zod";
import { redis } from "@/lib/redis/client";
import type { PlanGoal } from "@/lib/dynasty/trade-plan";

// Jack's own season-plan goals, one list per league. They lived in browser
// localStorage (one list for every league, one device only) until 2026-11-07,
// when the trade tools started reading them; the server cannot read a browser.
const KEY = (leagueId: string) => `plan:goals:v1:${leagueId}`;

export const GOAL_CATEGORIES = ["roster", "trade", "draft", "standings", "other"] as const;

export const goalSchema = z.object({
  id: z.string().min(1).max(40),
  text: z.string().trim().min(1).max(200),
  category: z.enum(GOAL_CATEGORIES),
  done: z.boolean(),
});
export const goalsSchema = z.array(goalSchema).max(50);

export const leagueIdSchema = z.string().regex(/^\d{6,25}$/);

export type GoalsRead = { ok: true; goals: PlanGoal[] } | { ok: false };

/** A failed read is not an empty list: saving over it would wipe the goals. */
export async function readGoals(leagueId: string): Promise<GoalsRead> {
  try {
    const raw = await redis.get<unknown>(KEY(leagueId));
    const parsed = goalsSchema.safeParse(raw ?? []);
    return { ok: true, goals: parsed.success ? parsed.data : [] };
  } catch (err) {
    console.error("plan goals read failed", leagueId, err);
    return { ok: false };
  }
}

export async function saveGoals(leagueId: string, goals: PlanGoal[]): Promise<void> {
  await redis.set(KEY(leagueId), goals);
}
