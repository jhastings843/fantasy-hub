import { describe, expect, it } from "vitest";
import { bestLineup, marginalValue, startingSlots, weakestSlots } from "./solve";
import type { LineupPlayer } from "./solve";

// Dah Chopped's real roster shape: eight starters, two flexes, no K, no DST.
const CHOPPED_ROSTER = [
  "QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "FLEX",
  "BN", "BN", "BN", "BN", "BN", "BN",
];

const p = (playerId: string, position: string, points: number): LineupPlayer => ({
  playerId,
  position,
  points,
});

describe("startingSlots", () => {
  it("drops bench and reserve slots", () => {
    expect(startingSlots(CHOPPED_ROSTER)).toEqual([
      "QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "FLEX",
    ]);
  });

  it("drops IR and taxi too", () => {
    expect(startingSlots(["QB", "IR", "TAXI", "BN"])).toEqual(["QB"]);
  });
});

describe("bestLineup", () => {
  it("fills every slot with the best eligible player", () => {
    const roster = [
      p("qb1", "QB", 20),
      p("rb1", "RB", 18), p("rb2", "RB", 12), p("rb3", "RB", 8),
      p("wr1", "WR", 16), p("wr2", "WR", 14), p("wr3", "WR", 10),
      p("te1", "TE", 9),
    ];
    const lineup = bestLineup(roster, CHOPPED_ROSTER);
    // QB 20 + RB 18,12 + WR 16,14 + TE 9 + FLEX rb3 8 and wr3 10
    expect(lineup.total).toBeCloseTo(20 + 18 + 12 + 16 + 14 + 9 + 10 + 8, 5);
    expect(lineup.bench).toHaveLength(0);
  });

  it("does not put a flex-eligible player in a flex when a dedicated slot needs him", () => {
    // Only two RBs. Neither may be spent on FLEX while an RB slot sits empty.
    const roster = [
      p("rb1", "RB", 15), p("rb2", "RB", 14),
      p("wr1", "WR", 20), p("wr2", "WR", 19), p("wr3", "WR", 18), p("wr4", "WR", 17),
      p("qb1", "QB", 22), p("te1", "TE", 10),
    ];
    const lineup = bestLineup(roster, CHOPPED_ROSTER);
    const rbSlots = lineup.slots.filter((s) => s.slot === "RB");
    expect(rbSlots.every((s) => s.player !== null)).toBe(true);
    expect(lineup.total).toBeCloseTo(22 + 15 + 14 + 20 + 19 + 10 + 18 + 17, 5);
  });

  it("leaves a slot empty and says so when nothing is eligible", () => {
    const roster = [p("wr1", "WR", 12), p("wr2", "WR", 11)];
    const lineup = bestLineup(roster, CHOPPED_ROSTER);
    const qb = lineup.slots.find((s) => s.slot === "QB");
    expect(qb?.player).toBeNull();
    expect(qb?.emptyReason).toBe("no eligible player");
    expect(lineup.total).toBeCloseTo(23, 5);
  });

  it("keeps the surplus on the bench", () => {
    const roster = Array.from({ length: 12 }, (_, i) => p(`wr${i}`, "WR", 20 - i));
    const lineup = bestLineup(roster, CHOPPED_ROSTER);
    // WR, WR, FLEX, FLEX = four receivers start, eight sit.
    expect(lineup.bench).toHaveLength(8);
  });

  it("keeps a QB out of a standard flex", () => {
    const roster = [p("qb1", "QB", 25), p("qb2", "QB", 24), p("rb1", "RB", 5)];
    const lineup = bestLineup(roster, CHOPPED_ROSTER);
    const flexes = lineup.slots.filter((s) => s.slot === "FLEX");
    expect(flexes.some((s) => s.player?.playerId === "qb2")).toBe(false);
  });

  it("lets a QB into a superflex", () => {
    const lineup = bestLineup(
      [p("qb1", "QB", 25), p("qb2", "QB", 24), p("rb1", "RB", 5)],
      ["QB", "SUPER_FLEX", "BN"],
    );
    expect(lineup.total).toBeCloseTo(49, 5);
  });
});

describe("marginalValue", () => {
  const roster = [
    p("qb1", "QB", 18),
    p("rb1", "RB", 16), p("rb2", "RB", 11),
    p("wr1", "WR", 15), p("wr2", "WR", 13),
    p("te1", "TE", 7),
    p("rb3", "RB", 9), p("wr3", "WR", 8),
  ];

  it("values a player at what he adds to the lineup, not his projection", () => {
    // 20-point RB replaces the 8-point WR in the weaker flex: gain 12, not 20.
    const { gain, displaces } = marginalValue(roster, p("new", "RB", 20), CHOPPED_ROSTER);
    expect(gain).toBeCloseTo(12, 5);
    expect(displaces?.playerId).toBe("wr3");
  });

  it("is zero for a player who would not start", () => {
    const { gain, displaces, slot } = marginalValue(roster, p("new", "WR", 4), CHOPPED_ROSTER);
    expect(gain).toBe(0);
    expect(displaces).toBeNull();
    expect(slot).toBeNull();
  });

  it("values a player into an empty slot at his full projection", () => {
    const noQb = roster.filter((x) => x.position !== "QB");
    const { gain } = marginalValue(noQb, p("newqb", "QB", 17), CHOPPED_ROSTER);
    expect(gain).toBeCloseTo(17, 5);
  });

  it("names the slot the player would occupy", () => {
    const { slot } = marginalValue(roster, p("newte", "TE", 14), CHOPPED_ROSTER);
    expect(slot).toBe("TE");
  });

  it("prices the same player differently for a team that is already deep", () => {
    const deep = [
      p("qb1", "QB", 22),
      p("rb1", "RB", 21), p("rb2", "RB", 20),
      p("wr1", "WR", 19), p("wr2", "WR", 18),
      p("te1", "TE", 17),
      p("rb3", "RB", 16), p("wr3", "WR", 15),
    ];
    // Worth 6 to the thin roster (replaces its 8-point flex) and nothing to the
    // deep one, whose worst starter already scores 15.
    const candidate = p("new", "RB", 14);
    expect(marginalValue(roster, candidate, CHOPPED_ROSTER).gain).toBeCloseTo(6, 5);
    expect(marginalValue(deep, candidate, CHOPPED_ROSTER).gain).toBe(0);
  });
});

describe("weakestSlots", () => {
  it("ranks empty slots as the worst of all", () => {
    const lineup = bestLineup([p("wr1", "WR", 12)], CHOPPED_ROSTER);
    expect(weakestSlots(lineup, 1)[0].player).toBeNull();
  });

  it("returns the lowest-scoring filled slots in order", () => {
    const roster = [
      p("qb1", "QB", 18),
      p("rb1", "RB", 16), p("rb2", "RB", 11),
      p("wr1", "WR", 15), p("wr2", "WR", 13),
      p("te1", "TE", 3),
      p("rb3", "RB", 9), p("wr3", "WR", 5),
    ];
    const weak = weakestSlots(bestLineup(roster, CHOPPED_ROSTER), 2);
    expect(weak.map((s) => s.player?.points)).toEqual([3, 5]);
  });
});
