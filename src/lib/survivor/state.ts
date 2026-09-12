import "server-only";
import { redis } from "@/lib/redis/client";
import { DEFAULT_POOL, type PoolConfig } from "./types";
import { DEFAULT_POOL_ID, poolMeta } from "./pools";

// Single-user tool, so a pool lives at one key rather than under a user id.
// It is in Upstash rather than localStorage because the picks have to be the
// same on the phone at 12:55 on Sunday as they were on the laptop on Thursday.
const KEY = (season: number, poolId: string) =>
  `survivor:pool:${season}:${poolId}:v1`;

/**
 * Where the only pool lived before there were two of them. Read as the main
 * pool and never written again, so the logged history survives without a
 * migration step that could run twice or not at all.
 */
const LEGACY_KEY = (season: number) => `survivor:pool:${season}:v1`;

/** A store, so pool isolation can be exercised without Redis. */
export interface PoolStore {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
}

const redisStore: PoolStore = {
  async get<T>(key: string) {
    return (await redis.get<T>(key)) ?? null;
  },
  async set<T>(key: string, value: T) {
    await redis.set(key, value);
  },
};

type Stored = Partial<PoolConfig> & {
  ownershipOverride?: Record<string, Record<string, number>> | null;
};

export async function getPool(
  season: number,
  poolId: string = DEFAULT_POOL_ID,
  store: PoolStore = redisStore,
): Promise<PoolConfig> {
  const meta = poolMeta(poolId);
  const seeded: PoolConfig = { ...DEFAULT_POOL, name: meta.name, ...meta.defaults };

  try {
    let stored = await store.get<Stored>(KEY(season, poolId));
    // Only the main pool has a pre-pool-id history to inherit. Letting another
    // pool read it would strike teams off a board where they are available.
    if (!stored && poolId === DEFAULT_POOL_ID) {
      stored = await store.get<Stored>(LEGACY_KEY(season));
    }
    if (!stored) return seeded;

    const { ownershipOverride, ...rest } = stored;
    return {
      ...seeded,
      ...rest,
      // ownershipOverride was written when the tool assumed live pool picks
      // were visible. Same shape, so carry anything stored under it forward.
      weeklyPicks: { ...(ownershipOverride ?? {}), ...(rest.weeklyPicks ?? {}) },
    };
  } catch {
    return seeded;
  }
}

export async function savePool(
  season: number,
  poolId: string,
  patch: Partial<PoolConfig>,
  store: PoolStore = redisStore,
): Promise<PoolConfig> {
  const current = await getPool(season, poolId, store);
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
  await store.set(KEY(season, poolId), next);
  return next;
}
