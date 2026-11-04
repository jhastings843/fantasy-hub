import { describe, expect, it } from "vitest";
import { crossChance, forecast, type ForecastInput } from "./forecast";

const now = new Date("2026-11-03T12:00:00Z");
const need = { games: 30, weeks: 3, t: 2.33 };
const base: ForecastInput = { id: "x", label: "X", sport: "nba", status: "collecting", games: 20, weeks: 2, t: 0, days: 14, need };

describe("go-live forecast", () => {
  it("a slice with no edge so far is a long shot or worse", () => {
    const f = forecast(base, now);
    expect(f.sampleBy).not.toBeNull();
    expect(f.chance!).toBeLessThan(0.2);
  });

  it("a strong slice is likely and beats a flat one", () => {
    const hot = forecast({ ...base, t: 2.2 }, now);
    expect(hot.chance!).toBeGreaterThan(forecast(base, now).chance!);
    expect(hot.chance!).toBeGreaterThan(0.5);
  });

  it("a losing slice is unlikely", () => {
    expect(forecast({ ...base, t: -1.8 }, now).outlook).toBe("unlikely");
  });

  it("is out of time when the pace can't reach the sample", () => {
    const f = forecast({ ...base, sport: "nfl", games: 3, days: 30, need: { ...need, games: 200 } }, now);
    expect(f.outlook).toBe("out of time");
    expect(f.chance).toBe(0);
  });

  it("winner bars stretch the sample date", () => {
    const plain = forecast({ ...base, need: { ...need, wins: 0 }, wins: 2 }, now);
    const wins = forecast({ ...base, need: { ...need, wins: 12 }, wins: 2 }, now);
    expect(wins.sampleBy! > plain.sampleBy!).toBe(true);
  });

  it("a refinement that doesn't beat its parent is held to the lower chance", () => {
    const solo = forecast({ ...base, t: 2.2 }, now);
    const ref = forecast({ ...base, t: 2.2, paired: { t: -0.5, need: 1.645 } }, now);
    expect(ref.chance!).toBeLessThan(solo.chance!);
  });

  it("live and retired slices skip the simulation", () => {
    expect(forecast({ ...base, status: "active" }, now).outlook).toBe("live");
    expect(forecast({ ...base, status: "retired" }, now).outlook).toBe("retired");
    expect(forecast({ ...base, games: 0 }, now).outlook).toBe("no games");
  });

  it("a fresh slice with a true zero prior clears by luck rarely", () => {
    const c = crossChance("seed", 0, 0, 30, 300, 2.33);
    expect(c).toBeGreaterThan(0.02);
    expect(c).toBeLessThan(0.3);
  });
});
