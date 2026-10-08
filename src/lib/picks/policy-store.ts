import "server-only";
import { redis } from "@/lib/redis/client";
import { BASELINE_POLICY, envelopeViolations, type PicksPolicy } from "./policy";

// The active policy, written only by the strategy review (learning/) after
// its validation passes. Anything that fails the envelope check on load is
// ignored in favour of the baseline, so a bad write can never loosen limits.

export const ACTIVE_POLICY_KEY = "picks:v2:policy:active";

export async function loadActivePolicy(): Promise<PicksPolicy> {
  try {
    const p = await redis.get<PicksPolicy>(ACTIVE_POLICY_KEY);
    if (p && envelopeViolations(p).length === 0) return p;
  } catch {
    /* fall through */
  }
  return BASELINE_POLICY;
}
