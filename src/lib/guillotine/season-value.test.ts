import { describe, expect, it } from "vitest";
import { blendRates, blendedRate, PRIOR_GAMES } from "./season-value";

describe("blendedRate", () => {
  // Week 8 Likely: preseason 9.3 a week, 16.1 a game over 7 games.
  it("pulls a stale preseason rate toward what the player has done", () => {
    const r = blendedRate(9.3, { points: 16.1 * 7, games: 7 })!;
    expect(r).toBeCloseTo((7 * 16.1 + PRIOR_GAMES * 9.3) / (7 + PRIOR_GAMES), 5);
    expect(r).toBeGreaterThan(13);
  });
  it("keeps the preseason rate with no games", () => {
    expect(blendedRate(9.3, undefined)).toBe(9.3);
  });
  it("needs a few games before trusting a player with no preseason line", () => {
    expect(blendedRate(null, { points: 30, games: 2 })).toBeNull();
    expect(blendedRate(null, { points: 45, games: 3 })).toBe(15);
  });
});

describe("blendRates", () => {
  it("keeps every field and adds breakout players from the fallback", () => {
    const out = blendRates(
      { a: { name: "A", points: 10 } },
      { a: { points: 60, games: 4 }, b: { points: 60, games: 4 } },
      { b: { name: "B", points: 0 } },
    );
    expect(out.a).toEqual({ name: "A", points: 12.5 });
    expect(out.b).toEqual({ name: "B", points: 15 });
  });
});
