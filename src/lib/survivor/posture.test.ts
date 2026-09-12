import { describe, expect, it } from "vitest";
import { fieldWeeklySurvival, poolPosture } from "./posture";
import type { Game } from "./types";

function game(home: string, away: string, p: number): Game {
  return {
    week: 1,
    home,
    away,
    kickoff: "2026-09-13T17:00:00Z",
    homeSpread: null,
    homeMoneyline: null,
    awayMoneyline: null,
    overUnder: null,
    homeWinProb: p,
    probSource: "moneyline",
    completed: false,
    homeScore: null,
    awayScore: null,
  };
}

describe("fieldWeeklySurvival", () => {
  it("is the field's ownership weighted by the teams' win probabilities", () => {
    const games = [game("KC", "DEN", 0.8), game("BUF", "NYJ", 0.6)];
    const owned = { KC: 0.5, BUF: 0.4, NYJ: 0.1 };
    // 0.5*0.8 + 0.4*0.6 + 0.1*0.4 = 0.40 + 0.24 + 0.04
    expect(fieldWeeklySurvival(games, owned)).toBeCloseTo(0.68, 10);
  });

  it("ignores ownership on teams that are not playing", () => {
    const games = [game("KC", "DEN", 0.8)];
    expect(fieldWeeklySurvival(games, { KC: 0.5, PHI: 0.5 })).toBeCloseTo(0.4, 10);
  });

  it("is 1 when nobody can lose", () => {
    expect(fieldWeeklySurvival([game("KC", "DEN", 1)], { KC: 1 })).toBeCloseTo(1, 10);
  });
});

describe("poolPosture", () => {
  const base = { week: 1, lastWeek: 18, weeklySurvival: 0.8 };

  it("expects a 30-entry pool to thin to a single entry inside the season", () => {
    // 30 * 0.8^18 = 0.54, so surviving is very likely winning outright.
    const p = poolPosture({ ...base, entriesAlive: 30 });
    expect(p.expectedSurvivors).toBeCloseTo(0.54, 2);
    expect(p.mode).toBe("outright");
    expect(p.tiebreak).toBe("safety");
  });

  it("expects a 500-entry pool to still have a crowd at the end", () => {
    // 500 * 0.8^18 = 9.0, so the realistic outcome is a split and thinning the
    // field is what turns surviving into winning.
    const p = poolPosture({ ...base, entriesAlive: 500 });
    expect(p.expectedSurvivors).toBeCloseTo(9.0, 1);
    expect(p.mode).toBe("shared");
    expect(p.tiebreak).toBe("leverage");
  });

  it("turns a big pool outright once it has been thinned late", () => {
    // 2 * 0.8^3 = 1.02 expected survivors with three weeks to play.
    const p = poolPosture({ entriesAlive: 2, week: 16, lastWeek: 18, weeklySurvival: 0.8 });
    expect(p.mode).toBe("outright");
  });

  it("treats three entries with three weeks left as still shared", () => {
    // 3 * 0.8^3 = 1.54, just over the 1.5 threshold. Kept as a test because it
    // is the borderline case and intuition gets it wrong: three entries feels
    // like a race to win outright, and the maths says one of them is expected to
    // be sharing it.
    const p = poolPosture({ entriesAlive: 3, week: 16, lastWeek: 18, weeklySurvival: 0.8 });
    expect(p.expectedSurvivors).toBeCloseTo(1.54, 2);
    expect(p.mode).toBe("shared");
  });

  it("stays shared when a small pool is still crowded at the death", () => {
    const p = poolPosture({ entriesAlive: 12, week: 17, lastWeek: 18, weeklySurvival: 0.9 });
    expect(p.expectedSurvivors).toBeCloseTo(9.72, 2);
    expect(p.mode).toBe("shared");
  });

  it("is outright when you are the only entry left", () => {
    const p = poolPosture({ ...base, entriesAlive: 1 });
    expect(p.mode).toBe("outright");
    expect(p.tiebreak).toBe("safety");
  });

  it("does not divide by zero when every entry is already gone", () => {
    const p = poolPosture({ ...base, entriesAlive: 0 });
    expect(Number.isFinite(p.expectedSurvivors)).toBe(true);
    expect(p.mode).toBe("outright");
  });

  it("says which way it breaks a tie and why", () => {
    expect(poolPosture({ ...base, entriesAlive: 500 }).summary).toMatch(/split|shar/i);
    expect(poolPosture({ ...base, entriesAlive: 30 }).summary).toMatch(/outright/i);
  });
});
