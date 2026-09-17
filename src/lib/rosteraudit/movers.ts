// Risers and fallers, computed from the values a league already loads.
//
// RosterAudit used to serve these from /movers. That route vanished from
// their public API on 2026-09-09 (404, rest_no_route) and the players page
// went down with it, since one rejected fetch failed the whole render. The
// rankings feed carries each player's 7-day and 30-day trend and the buy-low,
// sell-high and breakout flags, which is everything a mover row shows, so
// movers are derived here instead of fetched. A side effect worth keeping: a
// redraft league now gets movers from its own values rather than dynasty's.
//
// The two sources disagree on what a trend is. FantasyCalc's trend30Day is a
// change in value points (A.J. Brown at 3,005 with -2,750 fell from 5,755).
// RosterAudit's trend_7d and trend_30d are the change as a share of the
// player's own value, in basis points (Bijan Robinson at 9,985 with 584 rose
// 5.84%). Ranked raw, RosterAudit's figure puts a 37-point player who climbed
// from 10 (+27000) above every star in the league, which is what the first
// cut of this page showed. Every trend is converted to points here so both
// sources rank, and display, the same way.

import type { RAMover, RAMovers, RAValue, RAValuesBySleeperId } from "./types";

export type TrendSource = "rosteraudit" | "fantasycalc";

const TRACKED_POSITIONS = new Set(["QB", "RB", "WR", "TE"]);

/** Points gained or lost over the window, from a basis-point share of value. */
function pointsFromBasisPoints(value: number, bp: number): number {
  if (bp === 0 || value <= 0) return 0;
  // RosterAudit floors a collapsed player at -100%, which says nothing about
  // where he fell from. Count the whole of what is left as the loss; at the
  // values involved (single and double digits) that keeps him off the top.
  if (bp <= -10_000) return -Math.round(value);
  const before = value / (1 + bp / 10_000);
  return Math.round(value - before);
}

function toMover(v: RAValue, source: TrendSource): RAMover {
  const inPoints = (t: number) =>
    source === "rosteraudit" ? pointsFromBasisPoints(v.value, t) : Math.round(t);
  return {
    sleeperId: v.sleeperId,
    name: v.name,
    position: v.position,
    team: v.team,
    age: v.age,
    tier: v.tier,
    valueSf: v.value,
    trend7Day: inPoints(v.trend7Day),
    trend30Day: inPoints(v.trend30Day),
    buyLow: v.buyLow,
    sellHigh: v.sellHigh,
    breakout: v.breakout,
  };
}

/** The trend a row leads with: 7-day when the source has one, else 30-day. */
function primaryTrend(m: RAMover): number {
  return m.trend7Day !== 0 ? m.trend7Day : m.trend30Day;
}

export function moversFromValues(
  values: RAValuesBySleeperId,
  source: TrendSource,
  limit = 30,
): RAMovers {
  const movers = Object.values(values)
    .filter((v) => TRACKED_POSITIONS.has(v.position))
    .map((v) => toMover(v, source));
  const risers = movers
    .filter((m) => primaryTrend(m) > 0)
    .sort((a, b) => primaryTrend(b) - primaryTrend(a))
    .slice(0, limit);
  const fallers = movers
    .filter((m) => primaryTrend(m) < 0)
    .sort((a, b) => primaryTrend(a) - primaryTrend(b))
    .slice(0, limit);
  return { risers, fallers };
}
