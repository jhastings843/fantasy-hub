import "server-only";
import { cached } from "@/lib/redis/cached";
import { winningBidsFrom, type WinningBid } from "@/lib/guillotine/roster-diff";

// Every winning FAAB bid in a league is public in Sleeper's transaction feed.
// The guillotine advisor was the first to read it; the waiver pricing for the
// other leagues reads the same feed through here, under a league-neutral
// cache key, so the two do not fight over one.

const TRANSACTIONS_TTL = 30 * 60;

interface RawTransaction {
  type?: string;
  status?: string;
  leg?: number;
  adds?: Record<string, number> | null;
  settings?: { waiver_bid?: number } | null;
}

export function getWeekTransactions(
  leagueId: string,
  week: number,
): Promise<RawTransaction[]> {
  return cached(`sleeper:v1:league:${leagueId}:tx:w${week}`, TRANSACTIONS_TTL, async () => {
    const res = await fetch(
      `https://api.sleeper.app/v1/league/${leagueId}/transactions/${week}`,
      { cache: "no-store" },
    );
    if (!res.ok) return [] as RawTransaction[];
    return (await res.json()) as RawTransaction[];
  });
}

/** Every winning bid so far this season, one call per week, oldest first. */
export async function seasonWinningBids(
  leagueId: string,
  throughWeek: number,
): Promise<WinningBid[]> {
  const weeks = Array.from({ length: Math.max(0, throughWeek) }, (_, i) => i + 1);
  const perWeek = await Promise.all(
    weeks.map(async (week) =>
      winningBidsFrom(await getWeekTransactions(leagueId, week).catch(() => []), week),
    ),
  );
  return perWeek.flat();
}
