import { describe, expect, it } from "vitest";
import { openPicks, pickChanges } from "./pool-watch";

const g = (key: string, home: string, away: string, pick: "home" | "away", kickoff: string) => ({ key, home, away, pick, kickoff, pHome: 0.5, publicHome: 0.5 });

describe("pick'em entry watch", () => {
  it("only open games, and only picks that changed", () => {
    const now = new Date("2026-11-01T20:00:00Z");
    const before = openPicks({ games: [g("CHI@SEA", "SEA", "CHI", "home", "2026-11-03T01:15Z"), g("KC@DEN", "DEN", "KC", "away", "2026-11-01T21:25Z"), g("BAL@BUF", "BUF", "BAL", "home", "2026-11-01T18:00Z")] }, now);
    expect(before).toEqual({ "CHI@SEA": "SEA", "KC@DEN": "KC" }); // BUF already kicked off
    const after = { "CHI@SEA": "CHI", "KC@DEN": "KC", "NE@MIA": "NE" };
    expect(pickChanges(before, after)).toEqual([{ game: "CHI@SEA", from: "SEA", to: "CHI" }]); // NE@MIA new, not a change
  });
});

describe("Sunday push window", () => {
  it("Sunday 11:00 to 12:59 Eastern only", async () => {
    const { inSundayWindow } = await import("./pool-watch");
    expect(inSundayWindow(new Date("2026-11-08T16:00:00Z"))).toBe(true); // Sun 11:00 EST
    expect(inSundayWindow(new Date("2026-11-08T15:59:00Z"))).toBe(false); // Sun 10:59
    expect(inSundayWindow(new Date("2026-11-08T18:00:00Z"))).toBe(false); // Sun 1:00pm
    expect(inSundayWindow(new Date("2026-11-07T16:30:00Z"))).toBe(false); // Saturday
  });
});
