import { describe, expect, it } from "vitest";
import { positionRankOf } from "./ingest";

// Week 3, 2026, full PPR, off the FantasyPros board: the waiver email said
// "He has him WR118 this week" about Rashod Bateman, who was WR43. 118 was his
// superflex spot, which the board stores as `rank` on every positional row.
describe("positionRankOf", () => {
  it("reads the position rank off a board row, not its superflex spot", () => {
    expect(positionRankOf({ rank: 118, positionRank: 43 })).toBe(43);
  });

  it("falls back to rank for a week read off his Substack post, where rank is positional", () => {
    expect(positionRankOf({ rank: 12 })).toBe(12);
  });
});
