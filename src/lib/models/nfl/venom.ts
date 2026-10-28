import "server-only";
import { redis } from "@/lib/redis/client";
import { nameKey } from "@/lib/props/grade";

// Venom Analytics' NFL Anytime TD top 5 per game, read weekly in Jack's
// Chrome (~/.claude/skills/venom) and uploaded by scripts/venom-upload.mjs.
// Members-only: kept in Redis for the learner, never shown pick by pick (the
// repo and the site are public). Judged like PEM (Jack, 2026-10-27): as
// Anytime TD slices, our edges Venom also picks and our edges he doesn't.

export const VENOM_KEY = (season: number, week: number) => `venom:v1:nfl:attd:${season}:w${week}`;
export const VENOM_WEEKS = (season: number) => `venom:v1:nfl:attd:${season}:weeks`;

/** Week -> the name keys of Venom's picks that week. Weeks never uploaded are absent (no information, not "no picks"). */
export async function loadVenomPicks(season: number): Promise<Map<number, Set<string>>> {
  const weeks = ((await redis.smembers(VENOM_WEEKS(season)).catch(() => [])) ?? []).map(Number);
  const out = new Map<number, Set<string>>();
  await Promise.all(
    weeks.map(async (w) => {
      const rows = (await redis.get<{ name: string }[]>(VENOM_KEY(season, w)).catch(() => null)) ?? [];
      if (rows.length) out.set(w, new Set(rows.map((r) => nameKey(r.name))));
    }),
  );
  return out;
}
