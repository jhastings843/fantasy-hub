import "server-only";
import { redis } from "@/lib/redis/client";

// What the pick was worth when Jack last read about it.
//
// The Sunday alarm's whole job is to say "this changed since you decided", and
// a change needs a before. The before is the Thursday email: that is the last
// time the app put a number in front of him, so it is the number he is
// carrying around. Recorded when Thursday sends, read at 11:45 on Sunday, and
// absent means no line-move alarm rather than a guess.

const TTL = 60 * 60 * 24 * 7;

const key = (season: number | string, week: number) =>
  `survivor:baseline:${season}:w${week}`;

export interface PickBaseline {
  pick: string | null;
  winProb: number | null;
}

export type Baselines = Record<string, PickBaseline>;

export async function recordBaseline(
  season: number | string,
  week: number,
  baselines: Baselines,
): Promise<void> {
  try {
    await redis.set(key(season, week), baselines, { ex: TTL });
  } catch {
    /* The email still went. A missing baseline only softens Sunday. */
  }
}

export async function readBaseline(
  season: number | string,
  week: number,
): Promise<Baselines> {
  try {
    return (await redis.get<Baselines>(key(season, week))) ?? {};
  } catch {
    return {};
  }
}
