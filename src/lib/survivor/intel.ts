import "server-only";
import { cachedWithFallback, invalidate } from "@/lib/redis/cached";
import { parseInjuries, type EspnInjuryFeed } from "./intel-pure";
import type { InjuryNote } from "./types";

const ESPN_INJURIES =
  "https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries";

/**
 * League-wide injury report, cached 30 minutes. The point is not a full injury
 * feed, it is the one line that explains why a 78% favourite is really a 68%
 * favourite and the market has not caught up yet.
 */
/** Drop the cached injury notes so the next read is live. */
export async function revalidateInjuries(): Promise<void> {
  await invalidate("survivor:injuries:v2");
}

export async function getInjuries(): Promise<InjuryNote[]> {
  const res = await cachedWithFallback<InjuryNote[]>({
    key: "survivor:injuries:v2",
    ttlSeconds: 60 * 30,
    empty: [],
    // The league always has injuries. An empty list means a broken fetch.
    isComplete: (notes) => notes.length > 0,
    fetcher: async () => {
      const r = await fetch(ESPN_INJURIES, { cache: "no-store" });
      if (!r.ok) throw new Error(`ESPN injuries: ${r.status}`);
      return parseInjuries((await r.json()) as EspnInjuryFeed);
    },
  });
  return res.value;
}

export { notesForTeam, parseInjuries } from "./intel-pure";
