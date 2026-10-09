import { describe, expect, it } from "vitest";
import { allPlayRecord, guillotineStandings } from "./standings";
import type { WeekResult } from "./results";

// Four teams, three weeks. A chopped team keeps a zero-point row afterwards,
// which is what Sleeper returns.
const results: WeekResult[] = [
  { week: 1, scores: [{ rosterId: 1, points: 100 }, { rosterId: 2, points: 90 }, { rosterId: 3, points: 80 }, { rosterId: 4, points: 50 }] },
  { week: 2, scores: [{ rosterId: 1, points: 70 }, { rosterId: 2, points: 95 }, { rosterId: 3, points: 85 }, { rosterId: 4, points: 0 }] },
  { week: 3, scores: [{ rosterId: 1, points: 0 }, { rosterId: 2, points: 60 }, { rosterId: 3, points: 61 }, { rosterId: 4, points: 0 }] },
];

describe("guillotineStandings", () => {
  const rows = guillotineStandings(results, [1, 2, 3, 4]);
  const by = (id: number) => rows.find((r) => r.rosterId === id)!;

  it("chops the low score among live teams, not the dead zeros", () => {
    expect(by(4).choppedWeek).toBe(1);
    expect(by(1).choppedWeek).toBe(2);
    expect(by(2).choppedWeek).toBe(3);
    expect(by(3).choppedWeek).toBeNull();
  });

  it("builds an all-play record against live teams only", () => {
    // wk1 beat 1 of 3, wk2 beat 1 of 2, wk3 beat 1 of 1
    expect(allPlayRecord(by(3))).toBe("3-3");
    // wk1 beat all 3, wk2 beat none
    expect(allPlayRecord(by(1))).toBe("3-2");
    expect(by(1).points).toBe(170);
  });

  it("orders alive first, then most recently chopped", () => {
    expect(rows.map((r) => r.rosterId)).toEqual([3, 2, 1, 4]);
  });

  it("reports the last live week with rank and margin over the chop", () => {
    expect(by(3).last).toEqual({ week: 3, score: 61, rank: 1, teams: 2, margin: 1 });
    expect(by(4).last).toEqual({ week: 1, score: 50, rank: 4, teams: 4, margin: 0 });
  });

  it("settles a tied low score toward the empty roster", () => {
    const tie: WeekResult[] = [
      { week: 1, scores: [{ rosterId: 1, points: 50 }, { rosterId: 2, points: 50 }, { rosterId: 3, points: 90 }] },
    ];
    const r = guillotineStandings(tie, [1, 2, 3], new Set([2]));
    expect(r.find((x) => x.rosterId === 2)!.choppedWeek).toBe(1);
    expect(r.find((x) => x.rosterId === 1)!.choppedWeek).toBeNull();
  });
});
