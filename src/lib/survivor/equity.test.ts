import { describe, expect, it } from "vitest";
import { equityMultiplier, fieldSurvival, isOverOwned } from "./equity";
import type { Game, Ownership } from "./types";

function game(
  week: number,
  home: string,
  away: string,
  homeWinProb: number,
): Game {
  return {
    week,
    home,
    away,
    kickoff: "2026-09-13T17:00Z",
    homeSpread: null,
    homeMoneyline: null,
    awayMoneyline: null,
    overUnder: null,
    homeWinProb,
    probSource: "moneyline",
    completed: false,
    homeScore: null,
    awayScore: null,
  };
}

describe("fieldSurvival", () => {
  it("counts entries on your own team as certain survivors", () => {
    const games = [game(1, "KC", "DEN", 0.8)];
    const own: Ownership = { KC: 0.9, DEN: 0.1 };
    // Only one game, so if KC wins, exactly the 90% on KC survive.
    expect(fieldSurvival("KC", games, own)).toBeCloseTo(0.9, 10);
  });

  it("wipes out entries on the team you beat", () => {
    const games = [game(1, "KC", "DEN", 0.8)];
    const own: Ownership = { KC: 0.9, DEN: 0.1 };
    expect(fieldSurvival("DEN", games, own)).toBeCloseTo(0.1, 10);
  });

  it("includes survivors from other games, which the p/q shortcut misses", () => {
    const games = [game(1, "KC", "DEN", 0.8), game(1, "PHI", "NYG", 0.75)];
    const own: Ownership = { KC: 0.5, DEN: 0.0, PHI: 0.4, NYG: 0.1 };
    // 0.5 on KC + 0.4 * 0.75 on PHI + 0.1 * 0.25 on NYG
    expect(fieldSurvival("KC", games, own)).toBeCloseTo(0.5 + 0.3 + 0.025, 10);
  });

  it("is never above one or below zero", () => {
    const games = [game(1, "KC", "DEN", 0.8)];
    expect(fieldSurvival("KC", games, { KC: 5, DEN: 0 })).toBe(1);
    expect(fieldSurvival("KC", games, {})).toBe(0);
  });

  it("returns one for a team that is not playing, so it can never look good", () => {
    expect(fieldSurvival("BUF", [game(1, "KC", "DEN", 0.8)], {})).toBe(1);
  });
});

describe("equityMultiplier", () => {
  it("is one when your pick is exactly as safe as the field", () => {
    expect(equityMultiplier(0.7, 0.7, 500)).toBeCloseTo(1, 2);
  });

  it("rewards being right when the field is wrong", () => {
    // 70% to win while only 30% of the field survives is worth ~2.3x.
    expect(equityMultiplier(0.7, 0.3, 500)).toBeGreaterThan(2.2);
  });

  it("punishes over-owned chalk", () => {
    // 90% to win but 95% of the field also survives.
    expect(equityMultiplier(0.9, 0.95, 500)).toBeLessThan(1);
  });

  it("collapses to p/r in a large pool", () => {
    expect(equityMultiplier(0.75, 0.5, 5000)).toBeCloseTo(1.5, 4);
  });

  it("applies the finite-pool correction when the field nearly wipes", () => {
    // With r tiny the 1/(K+1) term matters and p/r would overstate the win.
    const approx = 0.6 / 0.001;
    expect(equityMultiplier(0.6, 0.001, 20)).toBeLessThan(approx);
    expect(equityMultiplier(0.6, 0.001, 20)).toBeGreaterThan(0.6);
  });

  it("caps at N when nobody else survives", () => {
    expect(equityMultiplier(1, 0, 500)).toBeCloseTo(500, 6);
  });

  it("ranks the underdog ahead in the two-sided leverage example", () => {
    // 70% favourite on 85% of entries vs 30% dog on 15%.
    const fav = equityMultiplier(0.7, 0.85, 100);
    const dog = equityMultiplier(0.3, 0.15, 100);
    expect(fav).toBeCloseTo(0.824, 2);
    expect(dog).toBeGreaterThan(fav);
    // And the finite-pool term keeps it under the naive 2.00.
    expect(dog).toBeLessThan(2);
  });
});

describe("isOverOwned", () => {
  it("is the q > p threshold", () => {
    expect(isOverOwned(0.75, 0.8)).toBe(true);
    expect(isOverOwned(0.75, 0.7)).toBe(false);
  });
});

describe("pool size", () => {
  // Measured against the real week 1 2026 slate while adding the second pool.
  // A 30-entry board and a 500-entry board came back IDENTICAL to five decimals,
  // and the reason is here rather than in a comment on the page: the finite-pool
  // term (1-(1-r)^N)/r is indistinguishable from 1/r once (1-r)^N vanishes, and
  // at r = 0.80 that happens long before N reaches 30. These two tests pin where
  // entry count does and does not matter, so nobody has to re-derive it.
  it("does not separate 30 entries from 500 when most of the field survives", () => {
    const small = equityMultiplier(0.8, 0.8, 30);
    const big = equityMultiplier(0.8, 0.8, 500);
    expect(small).toBeCloseTo(big, 9);
  });

  it("does separate them when almost none of the field survives", () => {
    // r = 0.09, so (1-r)^30 is 0.06 and (1-r)^500 is nothing. This is the week
    // where the entry count earns its place in the formula: heavily burned late
    // season, field piled onto teams that lose.
    const small = equityMultiplier(0.6, 0.09, 30);
    const big = equityMultiplier(0.6, 0.09, 500);
    expect(big).toBeGreaterThan(small);
    expect(big - small).toBeGreaterThan(0.3);
  });
});
