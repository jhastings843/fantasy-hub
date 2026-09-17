import { describe, expect, it } from "vitest";
import { claimGain } from "./gain";

const points = {
  fa: { points: 12.4 },
  starter: { points: 9.1 },
};

const fa = { playerId: "fa", name: "Jauan Jennings", adjustedFlexRank: 70, flexRank: 72, positionalRank: null };
const starter = { playerId: "starter", name: "Denzel Boston", adjustedFlexRank: 80, flexRank: 81, positionalRank: null };

describe("claimGain", () => {
  it("measures the gain in projected points when both players are projected", () => {
    const g = claimGain({ player: fa, displaces: starter, slot: "FLEX" }, points);
    expect(g.weekGain).toBe(3.3);
    expect(g.startsThisWeek).toBe(true);
    expect(g.weekSlot).toEqual({ slot: "FLEX", over: "Denzel Boston", from: 80, to: 70 });
  });

  it("counts the whole projection when the slot he fills was empty", () => {
    const g = claimGain({ player: fa, displaces: null, slot: "FLEX" }, points);
    expect(g.weekGain).toBe(12.4);
    expect(g.weekSlot?.over).toBeNull();
  });

  it("refuses to invent points when a projection is missing", () => {
    // The old code subtracted two rank scores and called the difference
    // points. A rank gap of ten is not ten points, and unranked against
    // FLEX 150 came out as 998,850.
    const g = claimGain({ player: fa, displaces: starter, slot: "FLEX" }, { fa: { points: 12.4 } });
    expect(g.weekGain).toBeNull();
    expect(g.startsThisWeek).toBe(true);
    expect(g.weekSlot).toEqual({ slot: "FLEX", over: "Denzel Boston", from: 80, to: 70 });
  });

  it("never reports a negative gain", () => {
    const g = claimGain({ player: fa, displaces: starter, slot: "FLEX" }, { fa: { points: 5 }, starter: { points: 9 } });
    expect(g.weekGain).toBe(0);
  });

  it("describes a player who does not start as not starting", () => {
    const g = claimGain(null, points);
    expect(g).toEqual({ weekGain: null, startsThisWeek: false, weekSlot: null });
  });

  it("falls back to the raw FLEX rank, then the positional rank, for the explanation", () => {
    const g = claimGain(
      {
        player: { ...fa, adjustedFlexRank: null, flexRank: null, positionalRank: 12 },
        displaces: { ...starter, adjustedFlexRank: null },
        slot: "WR2",
      },
      points,
    );
    expect(g.weekSlot).toEqual({ slot: "WR2", over: "Denzel Boston", from: 81, to: 12 });
  });
});
