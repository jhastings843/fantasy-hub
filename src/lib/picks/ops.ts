import "server-only";
import { redis } from "@/lib/redis/client";

// Health of each scheduled picks operation, written by the pulse itself, so
// "did it run" never depends on someone opening the page.

export interface OpStatus {
  lastRun?: string;
  lastSuccess?: string;
  lastFailure?: string;
  lastError?: string;
  detail?: string;
  /** When the schedule next expects it (a hint; the pulse decides). */
  nextExpected?: string;
}

const KEY = "picks:v2:ops";

export async function recordOp(name: string, ok: boolean, detail: string, nextExpected?: string): Promise<void> {
  const now = new Date().toISOString();
  const cur = ((await redis.hget<OpStatus>(KEY, name).catch(() => null)) ?? {}) as OpStatus;
  const next: OpStatus = ok
    ? { ...cur, lastRun: now, lastSuccess: now, detail, nextExpected }
    : { ...cur, lastRun: now, lastFailure: now, lastError: detail, nextExpected };
  await redis.hset(KEY, { [name]: next }).catch(() => {});
}

export async function loadOps(): Promise<{ [name: string]: OpStatus }> {
  return ((await redis.hgetall<{ [name: string]: OpStatus }>(KEY).catch(() => null)) ?? {}) as { [name: string]: OpStatus };
}

/** Runs an op and records how it went; rethrows so the pulse receipt shows failures too. */
export async function tracked(name: string, everyMinutes: number, work: () => Promise<string>): Promise<string> {
  const next = new Date(Date.now() + everyMinutes * 60000).toISOString();
  try {
    const out = await work();
    await recordOp(name, true, out, next);
    return out;
  } catch (e) {
    await recordOp(name, false, e instanceof Error ? e.message : String(e), next);
    throw e;
  }
}
