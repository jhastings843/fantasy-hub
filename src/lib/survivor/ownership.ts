import "server-only";
import { cachedWithFallback, invalidate } from "@/lib/redis/cached";
import { redis } from "@/lib/redis/client";
import { archiveNeedsWrite, mergePublicPicks, parseYahoo } from "./yahoo";
import type { Ownership, OwnershipSnapshot } from "./types";

// Yahoo's Survival Football pick distribution is public and unauthenticated,
// and carries every team for every week of the season in one response.
//
// Yahoo's millions of free entries are not this pool's 500, but a 500-entry
// field tracks public behaviour closely enough to be the best available prior,
// and it is the only free source that publishes real submitted picks rather
// than a model's forecast of them. Override it on the page when the pool shows
// its own distribution.
const YAHOO_URL =
  "https://football.fantasysports.yahoo.com/survival/pickdistribution/";

async function fetchYahoo(): Promise<Record<string, Ownership>> {
  const res = await fetch(YAHOO_URL, {
    cache: "no-store",
    headers: {
      // Yahoo serves a stub to unrecognised clients.
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
    },
  });
  if (!res.ok) throw new Error(`Yahoo pick distribution: ${res.status}`);
  const byWeek = parseYahoo(await res.text());
  return Object.fromEntries([...byWeek].map(([w, p]) => [String(w), p]));
}

export interface PublicPicks {
  /** week number as a string -> abbr -> fraction of the field. */
  byWeek: Record<string, Ownership>;
  pulledAt: string;
  /** True when serving a last-known-good copy. */
  stale: boolean;
}

/**
 * Yahoo answering 200 with a login stub or a trimmed page would parse to a
 * thin object rather than an error, so require at least one week carrying most
 * of the league before treating a fetch as usable.
 */
export function publicPicksAreComplete(
  byWeek: Record<string, Ownership>,
): boolean {
  return Object.values(byWeek).some((w) => Object.keys(w).length >= 24);
}

/**
 * Public pick percentages for EVERY week, not just this one. Cached 15 minutes:
 * the distribution moves all week as entries lock in, and the last read before
 * kickoff is the one that matters.
 *
 * Past weeks are kept because they are the baseline the pool's own logged picks
 * get compared against. Without them there is nothing to calibrate to.
 */
/**
 * Our own record of what the public did each week, since Yahoo does not keep
 * one. Written only when a week's numbers actually move, and never expired.
 */
const ARCHIVE_KEY = (season: number) => `survivor:public-archive:${season}:v1`;

async function readArchive(season: number): Promise<Record<string, Ownership>> {
  try {
    return (await redis.get<Record<string, Ownership>>(ARCHIVE_KEY(season))) ?? {};
  } catch {
    return {};
  }
}

/** Drop the cached Yahoo pull so the next read is live. */
export async function revalidatePublicPicks(season: number): Promise<void> {
  await invalidate(`survivor:yahoo:${season}:v3`);
}

export async function getPublicPicks(
  season = 2026,
): Promise<PublicPicks> {
  const res = await cachedWithFallback<Record<string, Ownership>>({
    key: `survivor:yahoo:${season}:v3`,
    ttlSeconds: 60 * 15,
    empty: {},
    isComplete: publicPicksAreComplete,
    // Runs only on a real fetch, so the archive read and write happen about
    // four times an hour rather than on every page load.
    fetcher: async () => {
      const live = await fetchYahoo();
      const archive = await readArchive(season);
      const merged = mergePublicPicks(archive, live);
      if (archiveNeedsWrite(archive, merged)) {
        try {
          await redis.set(ARCHIVE_KEY(season), merged);
        } catch {
          // A failed archive write must not cost us this week's numbers.
        }
      }
      return merged;
    },
  });
  return { byWeek: res.value, pulledAt: res.at, stale: res.stale };
}

/** Just this week's slice, for callers that do not need the history. */
export async function getOwnership(week: number): Promise<OwnershipSnapshot> {
  const { byWeek, pulledAt } = await getPublicPicks();
  return { week, source: "yahoo", picks: byWeek[String(week)] ?? {}, pulledAt };
}

export { normalizeOwnership, ownershipCoverage, canonYahoo, parseYahoo } from "./yahoo";
