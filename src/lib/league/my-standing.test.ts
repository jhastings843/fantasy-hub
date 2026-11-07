import { describe, expect, it } from "vitest";
import type { SleeperRoster } from "@/lib/sleeper/types";
import { myStanding, standingText } from "./my-standing";

const r = (id: number, owner: string, wins: number, losses: number, fpts: number, players = ["x"]): SleeperRoster =>
  ({ roster_id: id, owner_id: owner, players, settings: { wins, losses, ties: 0, fpts } }) as unknown as SleeperRoster;

describe("myStanding", () => {
  it("ranks by wins then points for", () => {
    const rosters = [r(1, "a", 5, 3, 900), r(2, "me", 5, 3, 950), r(3, "c", 6, 2, 800)];
    const s = myStanding(rosters, "me", false)!;
    expect(standingText(s)).toBe("5-3, 2nd of 3");
  });
  it("uses 11th-13th suffixes", () => {
    const rosters = Array.from({ length: 12 }, (_, i) => r(i + 1, i === 10 ? "me" : `u${i}`, 12 - i, i, 100));
    expect(standingText(myStanding(rosters, "me", false)!)).toBe("2-10, 11th of 12");
  });
  it("guillotine says alive or chopped", () => {
    const rosters = [r(1, "me", 0, 0, 0), r(2, "b", 0, 0, 0, []), r(3, "c", 0, 0, 0)];
    expect(standingText(myStanding(rosters, "me", true)!)).toBe("Alive, 2 of 3 left");
    expect(standingText(myStanding([r(1, "me", 0, 0, 0, [])], "me", true)!)).toBe("Chopped");
  });
  it("null when I have no roster", () => {
    expect(myStanding([r(1, "a", 1, 0, 1)], "me", false)).toBeNull();
  });
});
