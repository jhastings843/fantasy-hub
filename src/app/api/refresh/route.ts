import {
  dropLeagueList,
  dropShared,
  refreshAllLeagues,
  refreshLeague,
} from "@/lib/refresh/run";

export const dynamic = "force-dynamic";

// POST /api/refresh - invalidates Upstash cache entries that mirror
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

  if (body?.all === true) {
    const result = await refreshAllLeagues();
    const payload = result.ok
      ? { ok: true, refreshed: result.refreshed }
      : result.failed.length > 0
        ? result
        : { ok: false, error: result.error };
    return Response.json(payload, { status: result.ok ? 200 : 500 });
  }

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
