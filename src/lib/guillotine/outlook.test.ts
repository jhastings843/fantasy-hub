import { describe, expect, it } from "vitest";
import { seasonOutlook } from "./outlook";

// A 16-team, $1000 league, which is Dah Chopped.
const base = {
  budget: 1000,
  totalTeams: 16,
  week: 2,
  teamsAlive: 15,
  remaining: 1000,
};

describe("seasonOutlook", () => {
  it("calls an unspent budget ahead of the curve", () => {
    const out = seasonOutlook(base);
    expect(out.spent).toBe(0);
    expect(out.onPace).toBe(true);
    expect(out.aheadBy).toBeGreaterThan(0);
  });

  it("calls an overspent budget behind it", () => {
    const out = seasonOutlook({ ...base, remaining: 100 });
    expect(out.spent).toBe(900);
    expect(out.onPace).toBe(false);
    expect(out.aheadBy).toBeLessThan(0);
  });

  it("loosens the hold floor as the field empties", () => {
    const floors = seasonOutlook(base).next.map((w) => w.holdFloor);
    expect(floors).toHaveLength(3);
    expect(floors[0]).toBeGreaterThan(floors[2]);
  });

  it("projects the weeks it is describing", () => {
    const weeks = seasonOutlook(base).next.map((w) => w.week);
    expect(weeks).toEqual([3, 4, 5]);
  });

  it("finds the week the format inverts", () => {
    // 15 alive in week 2, one chop a week: six left in week 11, which is where
    // the strategy notes say this league turns.
    expect(seasonOutlook(base).inversionWeek).toBe(11);
  });

  it("says the inversion has happened rather than naming a past week", () => {
    expect(seasonOutlook({ ...base, teamsAlive: 5, week: 12 }).inversionWeek).toBeNull();
  });

  it("separates the format inverting from pacing switching off", () => {
    // Six teams is where the strategy flips. budget.ts keeps pacing on until
    // four, so the two are two weeks apart and must not be reported as one.
    const out = seasonOutlook(base);
    expect(out.inversionWeek).toBe(11);
    expect(out.pacingOffWeek).toBe(13);
  });

  it("stops projecting once the league has a winner", () => {
    // Two alive: next week there is one, and a one-team league has no waivers.
    expect(seasonOutlook({ ...base, teamsAlive: 2, week: 15 }).next).toEqual([]);
  });

  it("stops projecting past the last week of the season", () => {
    const out = seasonOutlook({ ...base, week: 17, teamsAlive: 3 });
    expect(out.next.every((w) => w.week <= 18)).toBe(true);
  });

  it("switches pacing off in the endgame", () => {
    // Four alive: no later run worth saving for, so the ceiling is everything.
    const out = seasonOutlook({ ...base, teamsAlive: 4, week: 13, remaining: 400 });
    expect(out.next[0].weeklyCap).toBe(400);
    expect(out.next[0].phase).toBe("endgame");
  });
});
