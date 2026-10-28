import { describe, expect, it } from "vitest";
import { PointsRatings } from "@/lib/models/cfb/model";
import { nflPoints, nflProjection, nflTotal, type NflTotalsParams } from "./totals";
import type { SpreadGame } from "./spread";
import PARAMS from "./totals-params.json";

const P: NflTotalsParams = { points: { hfa: 1, k: 0.1, cap: 28, carry: 0.5 }, start: 21, sigma: 13 };
const g = (o: Partial<SpreadGame>): SpreadGame => ({
  id: "1", season: 2026, week: 1, type: "REG", gameday: "2026-09-13", home: "KC", away: "BUF", homeScore: 31, awayScore: 28,
  line: 2.5, homeRest: 7, awayRest: 7, homeQb: "", awayQb: "", neutral: false, ...o,
});

describe("NFL totals", () => {
  it("starts the league average where the params say (college keeps 28)", () => {
    expect(new PointsRatings(P.points, 21).avg).toBe(21);
    expect(new PointsRatings(P.points).avg).toBe(28);
  });

  it("projects twice the league average plus nothing for unrated teams", () => {
    const r = nflPoints([], P);
    expect(nflTotal(r, { season: 2026, home: "KC", away: "BUF", neutral: false })).toBeCloseTo(42, 6);
  });

  it("a high-scoring game raises both teams' next total; unfinished games are skipped", () => {
    const r = nflPoints([g({}), g({ id: "2", gameday: "2026-09-20", homeScore: null, awayScore: null })], P);
    expect(nflTotal(r, { season: 2026, home: "KC", away: "BUF", neutral: false })).toBeGreaterThan(42);
  });

  it("projected score uses our spread for the margin (negative spread = home favored)", () => {
    const p = nflProjection(-3, 47, P);
    expect(p.homePts).toBe(25);
    expect(p.awayPts).toBe(22);
    expect(p.homeWin).toBeGreaterThan(0.5);
  });

  it("the fitted params have every setting the model reads", () => {
    expect(Object.keys(PARAMS.points).sort()).toEqual(["cap", "carry", "hfa", "k"]);
    expect(PARAMS.sigma).toBeGreaterThan(10);
  });
});
