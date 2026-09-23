import { NextResponse } from "next/server";
import {
  getLegPicks,
  getPoolById,
  inProgressPools,
  listPools,
  picksInit,
  sleeperGraphQl,
  sleeperTokenConfigured,
} from "@/lib/survivor/sleeper-pool";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/survivor/sleeper - what Sleeper will tell us about the pools.
//
// A probe rather than a feature. The pool half of Sleeper's GraphQL schema is
// undocumented, so the shape of a pool, of a leg and of a picks map has to be
// looked at before anything can be written against it. Everything here is read
// only and returns Jack's own pools.
//
//   ?pool=<id>          one pool's record
//   ?league=<id>&leg=N  every entry's picks for that week
export async function GET(request: Request) {
  if (!sleeperTokenConfigured()) {
    return NextResponse.json(
      { ok: false, error: "SLEEPER_TOKEN is not set on this deployment." },
      { status: 503 },
    );
  }

  const params = new URL(request.url).searchParams;
  const poolId = params.get("pool");
  const leagueId = params.get("league");
  const leg = params.get("leg");

  if (leagueId && leg) {
    const picks = await getLegPicks(leagueId, leg);
    if (!picks.ok) return NextResponse.json({ ok: false, error: picks.error }, { status: 502 });
    const map = picks.data ?? {};
    return NextResponse.json({
      ok: true,
      leagueId,
      leg,
      entries: Object.keys(map).length,
      // A sample rather than the whole map, because the point of the probe is
      // the shape and the whole thing can be thousands of rows.
      sample: Object.fromEntries(Object.entries(map).slice(0, 3)),
    });
  }

  if (poolId) {
    const pool = await getPoolById(poolId);
    if (!pool.ok) return NextResponse.json({ ok: false, error: pool.error }, { status: 502 });
    return NextResponse.json({ ok: true, pool: pool.data });
  }

  // A matrix, because every pool query has come back empty and the cause could
  // be the token, the argument shape, or pools not being pools at all. One
  // deploy, every combination, and the counts say which.
  if (params.get("matrix") === "1") {
    const me = "733460435126353920";
    const probes: Record<string, string> = {
      me: `{ me { user_id display_name } }`,
      // A survivor pool may not be a "pool" at all. Every pool query comes back
      // empty while the token authenticates, so the next candidate is that it
      // is a league of a kind the public leagues endpoint does not return.
      rosters_regular: `{ rosters_by_user(user_id: "${me}", season: "2026", season_type: "regular", sport: "nfl") { league_id roster_id } }`,
      rosters_pickem: `{ rosters_by_user(user_id: "${me}", season: "2026", season_type: "pickem", sport: "nfl") { league_id roster_id } }`,
      rosters_survivor: `{ rosters_by_user(user_id: "${me}", season: "2026", season_type: "survivor", sport: "nfl") { league_id roster_id } }`,
      owned_regular: `{ owned_leagues(user_id: "${me}", season: "2026", season_type: "regular", sport: "nfl") { league_id name } }`,
      pools_bare: `{ get_user_pools { pool_id pool_type status sport } }`,
      pools_nfl: `{ get_user_pools(sport: "nfl") { pool_id pool_type status sport } }`,
      pools_in_season: `{ get_user_pools(status: ["in_season"]) { pool_id pool_type status sport } }`,
      pools_active: `{ get_user_pools(status: ["active"]) { pool_id pool_type status sport } }`,
      pools_complete: `{ get_user_pools(status: ["complete"]) { pool_id pool_type status sport } }`,
      pools_pending: `{ get_user_pools(status: ["pending"]) { pool_id pool_type status sport } }`,
      pools_survivor: `{ get_user_pools(pool_type: "survivor") { pool_id pool_type status sport } }`,
      pools_pickem: `{ get_user_pools(pool_type: "pickem") { pool_id pool_type status sport } }`,
      in_progress: `{ get_in_progress_user_pools { pool_id pool_type status sport } }`,
    };

    const out: Record<string, unknown> = {};
    for (const [name, query] of Object.entries(probes)) {
      const r = await sleeperGraphQl<Record<string, unknown>>(query);
      if (!r.ok) {
        out[name] = { error: r.error };
        continue;
      }
      const value = Object.values(r.data ?? {})[0];
      out[name] = Array.isArray(value) ? { rows: value.length, sample: value.slice(0, 3) } : value;
    }
    return NextResponse.json({ ok: true, probes: out });
  }

  if (params.get("init") === "1") {
    const init = await picksInit();
    if (!init.ok) return NextResponse.json({ ok: false, error: init.error }, { status: 502 });
    return NextResponse.json({ ok: true, init: init.data });
  }

  const running = await inProgressPools();
  const pools = await listPools();
  if (!pools.ok) return NextResponse.json({ ok: false, error: pools.error }, { status: 502 });
  return NextResponse.json({
    ok: true,
    inProgress: running.data ?? [],
    inProgressError: running.ok ? undefined : running.error,
    count: pools.data?.length ?? 0,
    pools: pools.data,
  });
}
