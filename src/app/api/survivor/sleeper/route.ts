import { NextResponse } from "next/server";
import {
  getLegPicks,
  getPoolById,
  listPools,
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

  const pools = await listPools();
  if (!pools.ok) return NextResponse.json({ ok: false, error: pools.error }, { status: 502 });
  return NextResponse.json({ ok: true, count: pools.data?.length ?? 0, pools: pools.data });
}
