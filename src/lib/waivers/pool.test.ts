import { describe, expect, it } from "vitest";
import { startablePositions } from "@/lib/redraft/draft-board";
import { isStartableIn } from "./pool";

const dynasty = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "FLEX", "FLEX", "SUPER_FLEX", "BN"];
const halfPpr = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "FLEX", "DEF", "BN"];

describe("isStartableIn", () => {
  it.each([
    { league: "dynasty", slots: dynasty },
    { league: "halfPpr", slots: halfPpr },
  ])("excludes K from $league without a kicker slot", ({ slots }) => {
    expect(isStartableIn("K", startablePositions(slots))).toBe(false);
  });

  it("excludes DEF from dynasty without a defense slot", () => {
    expect(isStartableIn("DEF", startablePositions(dynasty))).toBe(false);
  });

  it("keeps Sleeper DEF in halfPpr with a defense slot", () => {
    expect(isStartableIn("DEF", startablePositions(halfPpr))).toBe(true);
  });

  it.each(["QB", "RB", "WR", "TE"])("keeps %s in both leagues", (position) => {
    expect(isStartableIn(position, startablePositions(dynasty))).toBe(true);
    expect(isStartableIn(position, startablePositions(halfPpr))).toBe(true);
  });

  it("keeps K when the league starts a kicker", () => {
    expect(isStartableIn("K", startablePositions([...halfPpr, "K"]))).toBe(true);
  });

  it.each([null, undefined, ""])("excludes a missing position (%s)", (position) => {
    expect(isStartableIn(position, startablePositions(halfPpr))).toBe(false);
  });
});
