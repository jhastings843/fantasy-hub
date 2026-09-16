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
  revalidateMovers,
  revalidatePicks,
  revalidateValues,
} from "@/lib/rosteraudit/client";
import { currentSeason } from "@/lib/league/discover";
import { profileFromSleeper } from "@/lib/league/detect";
import {
  fcFormatFromProfile,
  revalidateFCValues,
} from "@/lib/fantasycalc/client";

export const dynamic = "force-dynamic";

// POST /api/refresh — invalidates Upstash cache entries that mirror
// any data that responds to live league activity, then triggers a
// re-fetch on next page render. Covers:
//
//   Sleeper:  the account's league list, plus the league, rosters, users,
//             traded picks, all NFL players, every draft + its picks.
//   RA:       values for the league's format, picks (rolling 4-year
//             window), movers, roster grades for every league member.
//
// Player profile / stats and KTC keep their own TTLs since they
// don't depend on league state. League history likewise.
//
// The body may carry { leagueId } so the button refreshes the league you are
// actually looking at, or { all: true } to refresh every league on the
// account. Falls back to SLEEPER_LEAGUE_ID, which predates the multi-league
// layer and is now only a default.
export async function POST(request: Request) {
  const body = await request
    .json()
    .catch(() => ({}) as Record<string, unknown>);

  if (body?.all === true) return refreshAll();

  const requested =
    typeof body?.leagueId === "string" ? body.leagueId : null;
  const leagueId = requested ?? process.env.SLEEPER_LEAGUE_ID;
  if (!leagueId) {
    return Response.json(
      { ok: false, error: "No leagueId given and no SLEEPER_LEAGUE_ID set" },
      { status: 400 },
    );
  }

  try {
    // The league list is dropped first and independently: a newly joined
    // league is exactly the case where the rest of this lookup has nothing
    // cached to clear, and it should still show up.
    await Promise.all([
      dropLeagueList(),
      dropShared(),
      refreshLeague(leagueId),
    ]);
    return Response.json({ ok: true, leagueId });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

/**
 * Every Sleeper league on the account, refreshed together. The list is dropped
 * and re-read first so a league joined since the last visit is included, and
 * the account-wide caches (players, picks, movers) are busted once rather than
 * once per league.
 */
async function refreshAll(): Promise<Response> {
  const username = process.env.SLEEPER_USERNAME;
  if (!username) {
    return Response.json(
      { ok: false, error: "Missing SLEEPER_USERNAME" },
      { status: 400 },
    );
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
      return Response.json(
        {
          ok: false,
          refreshed,
          failed: failed.map((l) => l.name),
          error: `${failed.length} of ${leagues.length} leagues failed to refresh`,
        },
        { status: 500 },
      );
    }
    return Response.json({ ok: true, refreshed });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

/** The account's league list. Best effort: a missing username is not an error here. */
async function dropLeagueList(): Promise<void> {
  const username = process.env.SLEEPER_USERNAME;
  if (!username) return;
  await getUser(username)
    .then((u) => revalidateUserLeagues(u.user_id, currentSeason()))
    .catch(() => undefined);
}

/** Caches that do not belong to any one league. */
async function dropShared(): Promise<void> {
  await Promise.all([
    revalidateAllPlayers(),
    revalidatePicks(),
    revalidateMovers(),
  ]);
}

/** Everything keyed to one league: Sleeper state, drafts, grades, and values. */
async function refreshLeague(leagueId: string): Promise<void> {
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
