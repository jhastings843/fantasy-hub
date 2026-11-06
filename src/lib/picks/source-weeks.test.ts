import { describe, expect, it } from "vitest";
import { usableWeeks } from "./source-weeks";

describe("usableWeeks", () => {
  it("counts verified weeks out of weeks on file", () => {
    const weeks = [6, 7, 8, 9, 10].map((week) => ({ week, verified: week < 8 }));
    expect(usableWeeks(weeks)).toEqual({ usable: 2, total: 5, missing: [8, 9, 10] });
  });
  it("is 0 of 0 with nothing on file", () => {
    expect(usableWeeks([])).toEqual({ usable: 0, total: 0, missing: [] });
  });
});
