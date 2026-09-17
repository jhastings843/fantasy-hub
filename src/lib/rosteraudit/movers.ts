// Risers and fallers, computed from the values a league already loads.
//
// RosterAudit used to serve these from /movers. That route vanished from
// their public API on 2026-09-09 (404, rest_no_route) and the players page
// went down with it, since one rejected fetch failed the whole render. The
// rankings feed carries each player's 7-day and 30-day trend and the buy-low,
// sell-high and breakout flags, which is everything a mover row shows, so
// movers are derived here instead of fetched. A side effect worth keeping: a
// redraft league now gets movers from its own values rather than dynasty's.

import type { RAMover, RAMovers, RAValue, RAValuesBySleeperId } from "./types";

const TRACKED_POSITIONS = new Set(["QB", "RB", "WR", "TE"]);

/** The trend a row leads with: 7-day when the source has one, else 30-day. */
function primaryTrend(v: RAValue): number {
  return v.trend7Day !== 0 ? v.trend7Day : v.trend30Day;
}

function toMover(v: RAValue): RAMover {
  return {
    sleeperId: v.sleeperId,
    name: v.name,
    position: v.position,
    team: v.team,
    age: v.age,
    tier: v.tier,
    valueSf: v.value,
    trend7Day: v.trend7Day,
    trend30Day: v.trend30Day,
    buyLow: v.buyLow,
    sellHigh: v.sellHigh,
    breakout: v.breakout,
  };
}

export function moversFromValues(
  values: RAValuesBySleeperId,
  limit = 30,
): RAMovers {
  const tracked = Object.values(values).filter((v) =>
    TRACKED_POSITIONS.has(v.position),
  );
  const risers = tracked
    .filter((v) => primaryTrend(v) > 0)
    .sort((a, b) => primaryTrend(b) - primaryTrend(a))
    .slice(0, limit)
    .map(toMover);
  const fallers = tracked
    .filter((v) => primaryTrend(v) < 0)
    .sort((a, b) => primaryTrend(a) - primaryTrend(b))
    .slice(0, limit)
    .map(toMover);
  return { risers, fallers };
}
