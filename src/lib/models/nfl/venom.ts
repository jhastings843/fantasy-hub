import "server-only";
import { redis } from "@/lib/redis/client";
import { nameKey } from "@/lib/props/grade";
import type { VenomProps } from "../learn";

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

export const VENOM_PROPS_KEY = (season: number, week: number) => `venom:v1:nfl:props:${season}:w${week}`;
export const VENOM_PROPS_WEEKS = (season: number) => `venom:v1:nfl:props:${season}:weeks`;

/**
 * Venom's pass yards, rush yards and receptions boards (Jack, 2026-10-30): week ->
 * stat -> player name key -> his 0-100 score. A stat present for a week means he
 * posted that board, so a player missing from it is one he left off.
 */
export async function loadVenomProps(season: number): Promise<VenomProps> {
  const weeks = ((await redis.smembers(VENOM_PROPS_WEEKS(season)).catch(() => [])) ?? []).map(Number);
  const out: VenomProps = new Map();
  await Promise.all(
    weeks.map(async (w) => {
      const h = (await redis.hgetall<{ [stat: string]: { name: string; score: number }[] }>(VENOM_PROPS_KEY(season, w)).catch(() => null)) ?? {};
      const byStat = new Map(Object.entries(h).map(([stat, rows]) => [stat, new Map(rows.map((r) => [nameKey(r.name), r.score]))]));
      if (byStat.size) out.set(w, byStat);
    }),
  );
  return out;
}
