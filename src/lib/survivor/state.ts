import "server-only";
import { redis } from "@/lib/redis/client";
import { DEFAULT_POOL, type PoolConfig } from "./types";

// Single-user tool, so the pool lives at one key rather than under a user id.
// It is in Upstash rather than localStorage because the picks have to be the
// same on the phone at 12:55 on Sunday as they were on the laptop on Thursday.
const KEY = (season: number) => `survivor:pool:${season}:v1`;

export async function getPool(season: number): Promise<PoolConfig> {
  try {
    const stored = await redis.get<
      Partial<PoolConfig> & {
        ownershipOverride?: Record<string, Record<string, number>> | null;
      }
    >(KEY(season));
    if (!stored) return { ...DEFAULT_POOL };
    const { ownershipOverride, ...rest } = stored;
    return {
      ...DEFAULT_POOL,
      ...rest,
      // ownershipOverride was written when the tool assumed live pool picks
      // were visible. Same shape, so carry anything stored under it forward.
      weeklyPicks: { ...(ownershipOverride ?? {}), ...(rest.weeklyPicks ?? {}) },
    };
  } catch {
    return { ...DEFAULT_POOL };
  }
}

export async function savePool(
  season: number,
  patch: Partial<PoolConfig>,
): Promise<PoolConfig> {
  const current = await getPool(season);
  const next: PoolConfig = { ...current, ...patch };
  next.usedTeams = [...new Set(next.usedTeams)];
  next.weeklyPicks = next.weeklyPicks ?? {};
  // Upper-cased and de-blanked, so clearing a pick is sending "" rather than
  // needing a second endpoint.
  next.myPicks = Object.fromEntries(
    Object.entries(next.myPicks ?? {})
      .map(([w, team]) => [w, String(team ?? "").trim().toUpperCase()])
      .filter(([, team]) => team.length > 0),
  );
  next.poolSize = Math.max(1, Math.round(next.poolSize));
  next.horizon = Math.min(12, Math.max(1, Math.round(next.horizon)));
  if (next.entriesAlive !== null) {
    next.entriesAlive = Math.max(1, Math.round(next.entriesAlive));
  }
  await redis.set(KEY(season), next);
  return next;
}
