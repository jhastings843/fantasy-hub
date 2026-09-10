import { describe, expect, it } from "vitest";
import { perfectLineup, scoreLineup, season, verdict } from "./pure";

const SLOTS = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "BN", "BN"];

const POSITION: Record<string, string> = {
  qb1: "QB", qb2: "QB",
  rb1: "RB", rb2: "RB", rb3: "RB",
  wr1: "WR", wr2: "WR", wr3: "WR",
  te1: "TE", te2: "TE",
};
const positionOf = (id: string) => POSITION[id] ?? "";

describe("scoreLineup", () => {
  it("adds up what the starters actually scored", () => {
    const s = scoreLineup(["qb1", "rb1"], { qb1: 22.4, rb1: 8.1 });
    expect(s.points).toBe(30.5);
  });

  it("counts an empty slot as nothing rather than dropping the lineup", () => {
    const s = scoreLineup(["qb1", "", "0"], { qb1: 10 });
    expect(s.points).toBe(10);
    expect(s.perPlayer).toHaveLength(1);
  });

  it("treats a player with no stat line as zero, which is what happened", () => {
    const s = scoreLineup(["qb1", "rb1"], { qb1: 10 });
    expect(s.points).toBe(10);
  });
});

describe("perfectLineup", () => {
  const actual: Record<string, number> = {
    qb1: 25, qb2: 12,
    rb1: 4, rb2: 18, rb3: 21,
    wr1: 30, wr2: 6, wr3: 9,
    te1: 3, te2: 14,
  };
  const roster = Object.keys(POSITION);

  it("finds the best the roster could have done", () => {
    const best = perfectLineup(roster, SLOTS, positionOf, actual);
    // QB 25, best two RB 21 and 18, best two WR 30 and 9, best TE 14, flex the
    // best of what is left, which is wr2 at 6.
    expect(best).toEqual(["qb1", "rb3", "rb2", "wr1", "wr3", "te2", "wr2"]);
  });

  it("does not special-case a player who did not play, because zero is enough", () => {
    const hurt = { ...actual, wr1: 0 };
    const best = perfectLineup(roster, SLOTS, positionOf, hurt);
    expect(best).not.toContain("wr1");
  });

  it("returns one entry per starting slot, bench excluded", () => {
    const best = perfectLineup(roster, SLOTS, positionOf, actual);
    expect(best).toHaveLength(7);
  });
});

describe("verdict", () => {
  it("reads positive when the app would have helped", () => {
    const v = verdict({ advised: 120, started: 110, raw: 118, perfect: 140 });
    expect(v.vsStarted).toBe(10);
    expect(v.vsRaw).toBe(2);
  });

  it("reads negative when it would have hurt, without softening it", () => {
    const v = verdict({ advised: 100, started: 115, raw: 104, perfect: 140 });
    expect(v.vsStarted).toBe(-15);
    expect(v.vsRaw).toBe(-4);
  });

  it("measures capture from what Jack started, not from zero", () => {
    // Started 110, perfect 140, so 30 points were on the table. Advised 120
    // captured a third of it.
    const v = verdict({ advised: 120, started: 110, raw: 118, perfect: 140 });
    expect(v.captured).toBeCloseTo(0.333, 2);
  });

  it("gives no capture figure when the lineup was already perfect", () => {
    // Nothing was on the table, so a percentage of it is meaningless rather
    // than 100%.
    const v = verdict({ advised: 140, started: 140, raw: 140, perfect: 140 });
    expect(v.captured).toBeNull();
  });
});

describe("season", () => {
  it("totals the weeks and counts which way they went", () => {
    const weeks = [
      verdict({ advised: 120, started: 110, raw: 118, perfect: 140 }),
      verdict({ advised: 100, started: 115, raw: 104, perfect: 130 }),
      verdict({ advised: 130, started: 130, raw: 125, perfect: 140 }),
    ];
    const s = season(weeks);
    expect(s.weeks).toBe(3);
    expect(s.vsStarted).toBe(-5);
    expect(s.vsRaw).toBe(3);
    expect(s.weeksAhead).toBe(1);
    expect(s.weeksBehind).toBe(1);
  });

  it("is honest about an empty season rather than implying a result", () => {
    const s = season([]);
    expect(s.weeks).toBe(0);
    expect(s.vsStarted).toBe(0);
  });
});
