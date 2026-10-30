import { describe, expect, it } from "vitest";
import type { GradedPropsGame } from "@/lib/props/trends";
import { ourPropCandidates, venomLean, type VenomProps } from "./learn";

// One game, four edges: over on a player Venom rates 90, under on him too,
// under on one he left off, and over on a receiving-yards prop (no Venom board).
const bet = (side: "over" | "under", net: number) => ({ side, line: 50, price: -110, book: "dk", outcome: net > 0 ? "W" : "L", net, breakEven: 0.524 });
const game = {
  week: 8,
  slug: "g1",
  kickoff: "2026-10-25T17:00:00Z",
  game: {
    markets: [
      { id: "rush_yds|Josh Jacobs", stat: "rush_yds", player: "Josh Jacobs", line: 70.5, gap: 0.04 },
      { id: "rec|Josh Jacobs", stat: "rec", player: "Josh Jacobs", line: 2.5, gap: 0.04 },
      { id: "rec|Dontayvion Wicks", stat: "rec", player: "Dontayvion Wicks", line: 2.5, gap: 0.05 },
      { id: "rec_yds|Josh Jacobs", stat: "rec_yds", player: "Josh Jacobs", line: 20.5, gap: 0.04 },
    ],
  },
  result: {
    markets: [
      { id: "rush_yds|Josh Jacobs", actual: 90, play: bet("over", 0.91) },
      { id: "rec|Josh Jacobs", actual: 4, play: bet("under", -1) },
      { id: "rec|Dontayvion Wicks", actual: 1, play: bet("under", 0.91) },
      { id: "rec_yds|Josh Jacobs", actual: 30, play: bet("over", 0.91) },
    ],
  },
} as unknown as GradedPropsGame;

const venom: VenomProps = new Map([[8, new Map([["rush_yds", new Map([["joshjacobs", 87.8]])], ["rec", new Map([["joshjacobs", 90]])]])]]);

describe("Venom on our NFL prop edges", () => {
  it("leans over at 70+, under below 50 or off his board, none in between or without a board", () => {
    expect(venomLean(venom, 8, "rush_yds", "Josh Jacobs")).toBe("over");
    expect(venomLean(venom, 8, "rec", "Dontayvion Wicks")).toBe("under");
    expect(venomLean(new Map([[8, new Map([["rec", new Map([["x", 60]])]])]]), 8, "rec", "X")).toBeNull();
    expect(venomLean(venom, 8, "rec_yds", "Josh Jacobs")).toBeNull();
    expect(venomLean(venom, 7, "rush_yds", "Josh Jacobs")).toBeNull();
  });

  it("splits our edges into agree and against under edge:all, skipping props he has no lean on", () => {
    const c = Object.fromEntries(ourPropCandidates([game], ["rush_yds", "rec", "rec_yds"], venom).map((x) => [x.id, x]));
    expect(c["venom:agree"].bets.map((b) => b.key)).toEqual(["8|g1|rush_yds|Josh Jacobs|over", "8|g1|rec|Dontayvion Wicks|under"]);
    expect(c["venom:against"].bets.map((b) => b.key)).toEqual(["8|g1|rec|Josh Jacobs|under"]);
    expect(c["venom:agree"].parent).toBe("edge:all");
  });

  it("adds no Venom slices without his boards", () => {
    expect(ourPropCandidates([game], ["rush_yds"]).some((x) => x.id.startsWith("venom:"))).toBe(false);
    expect(ourPropCandidates([game], ["rush_yds"], new Map()).some((x) => x.id.startsWith("venom:"))).toBe(false);
  });
});
