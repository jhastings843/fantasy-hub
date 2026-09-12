import type { PoolConfig } from "./types";

/**
 * The pools Jack actually plays in.
 *
 * A code constant rather than a registry key with a create-pool UI, because
 * these change about once a year and a stored list of two things is a moving
 * part that can disagree with itself. The NAME lives in each pool's own config
 * so it can be renamed without a deploy; the id and the size it starts at live
 * here so a fresh pool cannot silently inherit the other one's settings.
 */
export interface PoolMeta {
  id: string;
  /** Default display name, overridable per pool in its stored config. */
  name: string;
  /** For the email subject and the switcher pills, where space is tight. */
  short: string;
  /** Seeded on first read. Only what differs from DEFAULT_POOL. */
  defaults: Partial<PoolConfig>;
}

export const POOLS: PoolMeta[] = [
  {
    id: "main",
    name: "500-entry pool",
    short: "500",
    defaults: {},
  },
  {
    id: "thirty",
    name: "30-entry pool",
    short: "30",
    defaults: { poolSize: 30 },
  },
];

export const DEFAULT_POOL_ID = "main";

export function poolMeta(poolId: string): PoolMeta {
  const found = POOLS.find((p) => p.id === poolId);
  if (!found) {
    throw new Error(
      `Unknown survivor pool "${poolId}". Known pools: ${POOLS.map((p) => p.id).join(", ")}`,
    );
  }
  return found;
}

export function isPoolId(value: string): boolean {
  return POOLS.some((p) => p.id === value);
}
