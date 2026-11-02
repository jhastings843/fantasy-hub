import "server-only";
import { redis } from "@/lib/redis/client";

// When each sport's scores and results were last read in by its tracking run
// (the 15-minute pulse), so a board can say how fresh its finals are.
export type ScoresSport = "nba" | "cbb";
const KEY = (s: ScoresSport) => `scores:v1:at:${s}`;

export async function markScoresAt(sport: ScoresSport, at = new Date()): Promise<void> {
  await redis.set(KEY(sport), at.toISOString()).catch(() => null);
}

export async function scoresAt(sport: ScoresSport): Promise<string | null> {
  return (await redis.get<string>(KEY(sport)).catch(() => null)) ?? null;
}
