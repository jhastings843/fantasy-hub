import { describe, expect, it } from "vitest";
import { calibratedOver, calibratedSide } from "./calibrate";

describe("props calibration", () => {
  it("pulls confident chances toward the middle", () => {
    expect(calibratedOver("nfl", 0.779)).toBeCloseTo(0.584, 2);
    expect(calibratedOver("nba", 0.63)).toBeGreaterThan(0.5);
    expect(calibratedOver("nba", 0.63)).toBeLessThan(0.55);
  });
  it("under is the complement of the calibrated over", () => {
    expect(calibratedSide("nba", 0.3, "under")).toBeCloseTo(1 - calibratedOver("nba", 0.3), 10);
  });
  it("keeps order", () => {
    expect(calibratedOver("nfl", 0.7)).toBeGreaterThan(calibratedOver("nfl", 0.6));
  });
});
