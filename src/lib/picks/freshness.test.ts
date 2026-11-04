import { describe, expect, it } from "vitest";
import { freshnessProblems } from "./freshness";

const now = new Date("2026-11-07T15:00:00Z");
const game = (h: number, basis = "reference") => ({ basis, ref: { kickoff: new Date(now.getTime() + h * 3_600_000).toISOString() } });

describe("freshnessProblems", () => {
  it("flags stale quotes when a game kicks off within 6 hours", () => {
    expect(freshnessProblems("cfb", { reference: { stale: true, priced: 40 }, board: [game(2)] }, now)).toEqual(["cfb: quotes are stale, so nothing is offered; next kickoff in 2.0h"]);
  });
  it("flags a failed quote pull ahead of the stale flag", () => {
    expect(freshnessProblems("nfl", { reference: { stale: true, problem: "ESPN 503", priced: 10 }, board: [game(1)] }, now)[0]).toMatch(/quotes failed \(ESPN 503\)/);
  });
  it("is quiet with no game soon, fresh quotes, or only started games", () => {
    expect(freshnessProblems("cfb", { reference: { stale: true, priced: 40 }, board: [game(30)] }, now)).toEqual([]);
    expect(freshnessProblems("cfb", { reference: { stale: false, priced: 40 }, board: [game(2)] }, now)).toEqual([]);
    expect(freshnessProblems("cfb", { reference: { stale: true, priced: 40 }, board: [game(-1, "started"), game(2, "started")] }, now)).toEqual([]);
  });
});
