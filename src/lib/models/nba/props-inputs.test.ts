import { describe, expect, it } from "vitest";
import { oppFactor, projectRates, recencyWeights, type Allowed, type LeagueBase, type NbaParams, type PlayerInput } from "./props";

const row = (n: number, pts: number) => ({ n, pts, reb: 0, ast: 0, threes: 0 });
const table = (games: number, gPts: number): Allowed => ({ games, byPos: { G: row(100, gPts), F: row(100, 10), C: row(100, 10) } });

describe("recencyWeights", () => {
  it("is all ones with no half-life", () => {
    expect(recencyWeights(3)).toEqual([1, 1, 1]);
    expect(recencyWeights(3, 0)).toEqual([1, 1, 1]);
  });
  it("halves every h games and averages 1", () => {
    const w = recencyWeights(3, 1);
    expect(w[2] / w[1]).toBeCloseTo(2);
    expect(w[1] / w[0]).toBeCloseTo(2);
    expect(w.reduce((a, x) => a + x, 0)).toBeCloseTo(3);
  });
});

describe("oppFactor", () => {
  const league = table(100, 50);
  it("is 1 without data or k", () => {
    expect(oppFactor(undefined, league, "G", "pts", 10)).toBe(1);
    expect(oppFactor(table(10, 60), league, "G", "pts", undefined)).toBe(1);
    expect(oppFactor(table(0, 0), league, "G", "pts", 10)).toBe(1);
  });
  it("shrinks the allowed-over-league ratio toward 1 by k pseudo-games", () => {
    // Allows 0.6 per minute to guards against the league's 0.5: ratio 1.2, 10 games, k 10.
    expect(oppFactor(table(10, 60), league, "G", "pts", 10)).toBeCloseTo((10 * 1.2 + 10) / 20);
    expect(oppFactor(table(10, 60), league, "G", "pts", 0)).toBeCloseTo(1.2);
  });
});

describe("projectRates with rateHalfLife", () => {
  const base = { rate: { G: { pts: 0.5, reb: 0.1, ast: 0.1, threes: 0.05 }, F: { pts: 0.5, reb: 0.2, ast: 0.1, threes: 0.05 }, C: { pts: 0.5, reb: 0.3, ast: 0.1, threes: 0.01 } } } as LeagueBase;
  const g = (pts: number) => ({ date: "", team: "X", min: 30, starter: true, pts, reb: 0, ast: 0, threes: 0 });
  const pl: PlayerInput = { id: "1", team: "X", pos: "G", games: [g(10), g(10), g(30)] };
  const p = { k: { pts: 0, reb: 0, ast: 0, threes: 0 }, kPrior: 0 } as unknown as NbaParams;
  it("is the season rate when off, and leans to recent games when on", () => {
    expect(projectRates(pl, base, p).pts).toBeCloseTo(50 / 90);
    expect(projectRates(pl, base, { ...p, rateHalfLife: { pts: 1 } }).pts).toBeCloseTo((10 + 20 + 120) / 210);
  });
});
