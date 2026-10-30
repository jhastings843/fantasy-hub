import { describe, expect, it } from "vitest";
import type { GradedPropsGame } from "@/lib/props/trends";
import { ourPropCandidates, venomLean, type VenomProps } from "./learn";

// Two 11-player boards, scores 0..100 by tens: the player scored 100 sits at
// percentile 1 (strong over), 70 at 0.7 (mild over), 50 at 0.5 (no lean),
// 30 at 0.3 (mild under), 0 at 0 (strong under).
const board = (named: [string, number][]) => new Map([...Array.from({ length: 11 }, (_, i): [string, number] => [`filler${i}`, i * 10 + 0.5]), ...named]);
const venom: VenomProps = new Map([
  [8, new Map([
    ["rush_yds", board([["joshjacobs", 100]])],
    ["rec", board([["joshjacobs", 70], ["dontayvionwicks", 0], ["tuckerkraft", 50]])],
  ])],
]);

const bet = (side: "over" | "under", net: number) => ({ side, line: 50, price: -110, book: "dk", outcome: net > 0 ? "W" : "L", net, breakEven: 0.524 });
const market = (stat: string, player: string) => ({ id: `${stat}|${player}`, stat, player, line: 50.5, gap: 0.04 });
const game = {
  week: 8,
  slug: "g1",
  kickoff: "2026-10-25T17:00:00Z",
  game: {
    markets: [
      market("rush_yds", "Josh Jacobs"),
      market("rec", "Josh Jacobs"),
      market("rec", "Dontayvion Wicks"),
      market("rec", "Tucker Kraft"),
      market("rec_yds", "Josh Jacobs"),
      market("rec_yds", "Dontayvion Wicks"),
    ],
  },
  result: {
    markets: [
      { id: "rush_yds|Josh Jacobs", actual: 90, play: bet("over", 0.91) },
      { id: "rec|Josh Jacobs", actual: 4, play: bet("over", 0.91) },
      { id: "rec|Dontayvion Wicks", actual: 1, play: bet("under", 0.91) },
      { id: "rec|Tucker Kraft", actual: 3, play: bet("over", -1) },
      { id: "rec_yds|Josh Jacobs", actual: 30, play: bet("under", -1) },
      { id: "rec_yds|Dontayvion Wicks", actual: 5, play: bet("under", 0.91) },
    ],
  },
} as unknown as GradedPropsGame;

describe("Venom on our NFL prop edges", () => {
  it("places players by percentile on their board: top fifth strong over, bottom fifth strong under, middle no lean", () => {
    expect(venomLean(venom, 8, "rush_yds", "Josh Jacobs")).toEqual({ side: "over", strong: true });
    expect(venomLean(venom, 8, "rec", "Josh Jacobs")).toEqual({ side: "over", strong: false });
    expect(venomLean(venom, 8, "rec", "Dontayvion Wicks")).toEqual({ side: "under", strong: true });
    expect(venomLean(venom, 8, "rec", "Tucker Kraft")).toBeNull();
    expect(venomLean(venom, 8, "rec", "Nobody Listed")).toBeNull();
    expect(venomLean(venom, 7, "rush_yds", "Josh Jacobs")).toBeNull();
    // Receiving yards reads the receptions board.
    expect(venomLean(venom, 8, "rec_yds", "Dontayvion Wicks")).toEqual({ side: "under", strong: true });
  });

  it("splits our edges into agree (strong and mild), against, and receiving yards apart", () => {
    const c = Object.fromEntries(ourPropCandidates([game], ["rush_yds", "rec", "rec_yds"], venom).map((x) => [x.id, x]));
    const keys = (id: string) => c[id].bets.map((b) => b.key);
    expect(keys("venom:agree")).toEqual(["8|g1|rush_yds|Josh Jacobs|over", "8|g1|rec|Josh Jacobs|over", "8|g1|rec|Dontayvion Wicks|under"]);
    expect(keys("venom:agree-strong")).toEqual(["8|g1|rush_yds|Josh Jacobs|over", "8|g1|rec|Dontayvion Wicks|under"]);
    expect(keys("venom:agree-mild")).toEqual(["8|g1|rec|Josh Jacobs|over"]);
    expect(keys("venom:against")).toEqual([]);
    expect(keys("venom:recyds-agree")).toEqual(["8|g1|rec_yds|Dontayvion Wicks|under"]);
    expect(keys("venom:recyds-against")).toEqual(["8|g1|rec_yds|Josh Jacobs|under"]);
    expect(c["venom:agree-strong"].parent).toBe("venom:agree");
    expect(c["venom:recyds-agree"].parent).toBe("edge:rec_yds");
  });

  it("adds no Venom slices without his boards", () => {
    expect(ourPropCandidates([game], ["rush_yds"]).some((x) => x.id.startsWith("venom:"))).toBe(false);
    expect(ourPropCandidates([game], ["rush_yds"], new Map()).some((x) => x.id.startsWith("venom:"))).toBe(false);
  });
});
