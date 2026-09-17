import "server-only";
import {
  getLeague,
  getLeagueDrafts,
  getLeagueRosters,
  getLeagueUsers,
  getUser,
  getUserLeagues,
  revalidateAllPlayers,
  revalidateDraft,
  revalidateLeague,
  revalidateUserLeagues,
} from "@/lib/sleeper/client";
import {
  formatKeyFromLeague,
  revalidateGrades,
  revalidatePicks,
  revalidateValues,
} from "@/lib/rosteraudit/client";
import { currentSeason } from "@/lib/league/discover";
import { profileFromSleeper } from "@/lib/league/detect";
import {
  fcFormatFromProfile,
  revalidateFCValues,
} from "@/lib/fantasycalc/client";

/**
 * Every Sleeper league on the account, refreshed together. The list is dropped
 * and re-read first so a league joined since the last visit is included, and
 * the account-wide caches (players, picks, movers) are busted once rather than
 * once per league.
 */
export async function refreshAllLeagues(): Promise<{
  ok: boolean;
  refreshed: number;
  failed: string[];
  error?: string;
}> {
  const username = process.env.SLEEPER_USERNAME;
  if (!username) {
    return { ok: false, refreshed: 0, failed: [], error: "Missing SLEEPER_USERNAME" };
  }

  try {
    const user = await getUser(username);
    const season = currentSeason();
    await revalidateUserLeagues(user.user_id, season);
    const leagues = await getUserLeagues(user.user_id, season);

    const results = await Promise.allSettled([
      dropShared(),
      ...leagues.map((l) => refreshLeague(l.league_id)),
    ]);

    const failed = leagues.filter(
      (_, i) => results[i + 1].status === "rejected",
    );
    const refreshed = leagues.length - failed.length;

    if (failed.length > 0) {
      return {
        ok: false,
        refreshed,
        failed: failed.map((l) => l.name),
        error: `${failed.length} of ${leagues.length} leagues failed to refresh`,
      };
    }
    return { ok: true, refreshed, failed: [] };
  } catch (e) {
    return {
      ok: false,
      refreshed: 0,
      failed: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** The account's league list. Best effort: a missing username is not an error here. */
export async function dropLeagueList(): Promise<void> {
  const username = process.env.SLEEPER_USERNAME;
  if (!username) return;
  await getUser(username)
    .then((u) => revalidateUserLeagues(u.user_id, currentSeason()))
    .catch(() => undefined);
}

/** Caches that do not belong to any one league. */
export async function dropShared(): Promise<void> {
  await Promise.all([
    revalidateAllPlayers(),
    revalidatePicks(),
  ]);
}

/** Everything keyed to one league: Sleeper state, drafts, grades, and values. */
export async function refreshLeague(leagueId: string): Promise<void> {
  const [league, drafts, rosters, users] = await Promise.all([
    getLeague(leagueId).catch(() => null),
    getLeagueDrafts(leagueId).catch(() => []),
    getLeagueRosters(leagueId).catch(() => []),
    getLeagueUsers(leagueId).catch(() => []),
  ]);

  const userIds = new Set<string>();
  for (const r of rosters) {
    if (r.owner_id) userIds.add(r.owner_id);
  }
  for (const u of users) {
    if (u.user_id) userIds.add(u.user_id);
  }

  const tasks: Promise<unknown>[] = [
    revalidateLeague(leagueId),
    revalidateGrades(leagueId, [...userIds]),
  ];
  if (league) {
    // Values come from whichever source the format reads: RosterAudit for
    // dynasty, FantasyCalc for everything else. Busting only the dynasty one
    // left a redraft board serving stale values for the whole 6-hour TTL.
    const profile = profileFromSleeper(league);
    if (profile.type === "dynasty") {
      tasks.push(revalidateValues(formatKeyFromLeague(league)));
    } else {
      tasks.push(revalidateFCValues(fcFormatFromProfile(profile)));
    }
  }
  for (const d of drafts) {
    tasks.push(revalidateDraft(d.draft_id));
  }

  await Promise.all(tasks);
}
