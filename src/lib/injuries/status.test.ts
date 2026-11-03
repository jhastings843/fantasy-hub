import { describe, expect, it } from "vitest";
import { isOut } from "./status";
describe("isOut", () => {
  it("Out, IR, Doubtful and suspended are out; Questionable and Day-To-Day play", () => {
    expect(["Out", "Injured Reserve", "Doubtful", "Suspension"].map(isOut)).toEqual([true, true, true, true]);
    expect(["Questionable", "Day-To-Day", undefined].map(isOut)).toEqual([false, false, false]);
  });
});
