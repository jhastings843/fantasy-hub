import { describe, expect, it } from "vitest";
import { fromSummary } from "./odds";

describe("unpriced game fallback from ESPN's game page", () => {
  it("prefers a moneyline, then a spread, then ESPN's predictor", () => {
    expect(fromSummary({ pickcenter: [{ spread: 7, homeTeamOdds: { moneyLine: 250 }, awayTeamOdds: { moneyLine: -300 } }] })!.probSource).toBe("moneyline");
    const sp = fromSummary({ pickcenter: [{ spread: 7 }] })!;
    expect(sp.probSource).toBe("spread");
    expect(sp.homeWinProb).toBeLessThan(0.35); // home 7-point dog
    // Week 8 2026 Patriots at Dolphins: no line anywhere, predictor 20.2% Miami.
    const pr = fromSummary({ pickcenter: [], predictor: { homeTeam: { gameProjection: "20.2" } } })!;
    expect(pr.probSource).toBe("predictor");
    expect(pr.homeWinProb).toBeCloseTo(0.202, 6);
    expect(fromSummary({})).toBeNull();
  });
});
