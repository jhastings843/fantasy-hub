import { describe, expect, it } from "vitest";
import {
  actualsFor,
  describeLastWeek,
  lastWeekFor,
  standingFor,
  type WeekResult,
} from "./results";

const week1: WeekResult = {
  week: 1,
  scores: [
    { rosterId: 1, points: 52 },
    { rosterId: 2, points: 59.7 },
    { rosterId: 3, points: 80.9 },
    { rosterId: 4, points: 171.7 },
  ],
};

const week2: WeekResult = {
  week: 2,
  scores: [
    { rosterId: 2, points: 120 },
    { rosterId: 3, points: 70 },
    { rosterId: 4, points: 90 },
  ],
};

describe("actualsFor", () => {
  it("lists a roster's scores oldest first", () => {
    expect(actualsFor([week2, week1], 2)).toEqual([59.7, 120]);
  });

  it("skips weeks the roster did not score in", () => {
    expect(actualsFor([week1, week2], 1)).toEqual([52]);
  });
});

describe("standingFor", () => {
  it("ranks from the bottom and measures the gap to the low score", () => {
    const s = standingFor(week1, 2);
    expect(s).toEqual({
      week: 1,
      score: 59.7,
      rankFromBottom: 2,
      teams: 4,
      lowest: 52,
      margin: expect.closeTo(7.7, 5),
    });
  });

  it("gives the chopped team a zero margin", () => {
    expect(standingFor(week1, 1)?.margin).toBe(0);
  });

  it("returns null for a roster that did not play", () => {
    expect(standingFor(week2, 1)).toBeNull();
  });
});

describe("lastWeekFor", () => {
  it("uses the most recent completed week", () => {
    expect(lastWeekFor([week1, week2], 2)?.week).toBe(2);
  });

  it("is null with no results", () => {
    expect(lastWeekFor([], 2)).toBeNull();
  });
});

describe("describeLastWeek", () => {
  it("names the danger when the finish was near the bottom", () => {
    const text = describeLastWeek(standingFor(week1, 2)!);
    expect(text).toContain("59.7");
    expect(text).toContain("2nd lowest of 4");
    expect(text).toContain("7.7 clear of the chop");
  });

  it("counts from the top when the finish was comfortable", () => {
    expect(describeLastWeek(standingFor(week1, 4)!)).toContain("1st highest of 4");
  });

  it("says so when this was the chopped score", () => {
    expect(describeLastWeek(standingFor(week1, 1)!)).toContain("the low score of the week");
  });
});
