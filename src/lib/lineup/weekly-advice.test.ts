import { describe, expect, it } from "vitest";
import {
  adjustedFlexRanks,
  adviseLineup,
  cannotPlay,
  scoreOf,
  type AdvicePlayer,
} from "./weekly-advice";

function player(over: Partial<AdvicePlayer> & { playerId: string; position: string }): AdvicePlayer {
  return {
    name: over.playerId,
    team: "XXX",
    positionalRank: null,
    flexRank: null,
    adjustedFlexRank: null,
    opponent: "YYY",
    home: true,
    injuryStatus: null,
    onBye: false,
    unranked: false,
    ...over,
  } as AdvicePlayer;
}

/** The four real slot configurations, read off Sleeper on 2026-09-09. */
const SLOTS = {
  chopped: ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "FLEX", "BN", "BN"],
  halfPpr: ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "FLEX", "DEF", "BN"],
  dynasty: [
    "QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "FLEX", "FLEX", "SUPER_FLEX", "BN",
  ],
};

describe("scoreOf", () => {
  it("puts a flex-ranked player above one he only ranked in a position list", () => {
    const flexed = player({ playerId: "a", position: "RB", flexRank: 150, positionalRank: 60 });
    const positional = player({ playerId: "b", position: "RB", positionalRank: 1 });
    expect(scoreOf(flexed)).toBeGreaterThan(scoreOf(positional));
  });

  it("puts anyone he ranked above anyone he did not", () => {
    const ranked = player({ playerId: "a", position: "WR", positionalRank: 80 });
    const not = player({ playerId: "b", position: "WR", unranked: true });
    expect(scoreOf(ranked)).toBeGreaterThan(scoreOf(not));
  });

  it("prefers the adjusted rank when one exists", () => {
    const p = player({ playerId: "a", position: "WR", flexRank: 50, adjustedFlexRank: 10 });
    const q = player({ playerId: "b", position: "WR", flexRank: 20 });
    expect(scoreOf(p)).toBeGreaterThan(scoreOf(q));
  });
});

describe("cannotPlay", () => {
  it("rules out a bye", () => {
    expect(cannotPlay(player({ playerId: "a", position: "RB", onBye: true }))).toBe(true);
  });

  it("rules out Out and Doubtful, not Questionable", () => {
    expect(cannotPlay(player({ playerId: "a", position: "RB", injuryStatus: "Out" }))).toBe(true);
    expect(cannotPlay(player({ playerId: "b", position: "RB", injuryStatus: "Doubtful" }))).toBe(true);
    expect(cannotPlay(player({ playerId: "c", position: "RB", injuryStatus: "Questionable" }))).toBe(false);
  });
});

describe("adviseLineup", () => {
  // Deep enough that the flex slots are a real choice. An earlier version of
  // this fixture had exactly as many players as slots, so every "recommendation"
  // was the only legal option and the tests proved nothing.
  const roster = [
    player({ playerId: "qb1", position: "QB", positionalRank: 3 }),
    player({ playerId: "qb2", position: "QB", positionalRank: 14 }),
    player({ playerId: "rb1", position: "RB", positionalRank: 2, flexRank: 2 }),
    player({ playerId: "rb2", position: "RB", positionalRank: 20, flexRank: 40 }),
    player({ playerId: "rb4", position: "RB", positionalRank: 30, flexRank: 75 }),
    player({ playerId: "rb3", position: "RB", positionalRank: 45, flexRank: 120 }),
    player({ playerId: "wr1", position: "WR", positionalRank: 5, flexRank: 8 }),
    player({ playerId: "wr2", position: "WR", positionalRank: 30, flexRank: 60 }),
    player({ playerId: "wr4", position: "WR", positionalRank: 45, flexRank: 100 }),
    player({ playerId: "wr3", position: "WR", positionalRank: 70, flexRank: 140 }),
    player({ playerId: "te1", position: "TE", positionalRank: 4, flexRank: 30 }),
    player({ playerId: "te2", position: "TE", positionalRank: 20, flexRank: 135 }),
    player({ playerId: "def1", position: "DEF", positionalRank: 6 }),
  ];

  /** The lineup the advisor recommends for Dah Chopped's slots. */
  const OPTIMAL_CHOPPED = ["qb1", "rb1", "rb2", "wr1", "wr2", "te1", "rb4", "wr4"];

  it("fills every starting slot and ignores the bench slots", () => {
    const a = adviseLineup({
      rosterPositions: SLOTS.chopped,
      roster,
      currentStarters: [],
    });
    expect(a.slots.map((s) => s.slot)).toEqual([
      "QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "FLEX",
    ]);
    expect(a.slots.every((s) => s.recommended !== null)).toBe(true);
  });

  it("puts his best flex-ranked players in the flex slots", () => {
    const a = adviseLineup({
      rosterPositions: SLOTS.chopped,
      roster,
      currentStarters: [],
    });
    const flexed = a.slots.filter((s) => s.slot === "FLEX").map((s) => s.recommended?.playerId);
    // The dedicated slots go first and take his best at each position: rb1 and
    // rb2, wr1 and wr2, te1. The flex slots then take the best of what is left
    // by FLEX rank, which is rb4 at 75 and wr4 at 100, ahead of rb3 at 120 and
    // te2 at 135.
    expect(flexed).toEqual(["rb4", "wr4"]);
  });

  it("reports only the slots that differ from what is set now", () => {
    // Correct everywhere except the two flex slots, which are holding his two
    // deepest players while rb4 and wr4 sit on the bench.
    const current = ["qb1", "rb1", "rb2", "wr1", "wr2", "te1", "rb3", "wr3"];
    const a = adviseLineup({
      rosterPositions: SLOTS.chopped,
      roster,
      currentStarters: current,
    });
    expect(a.changes.map((c) => c.slot)).toEqual(["FLEX", "FLEX"]);
    expect(a.changes.map((c) => c.recommended?.playerId)).toEqual(["rb4", "wr4"]);
    expect(a.changes[0].reason).toContain("Start rb4");
    expect(a.changes[0].reason).toContain("over rb3");
  });

  it("does not call a slot swap a change", () => {
    // The same players, with the two backs in each other's slots. Nobody has to
    // do anything. Reported as five changes before 2026-09-09.
    const swapped = ["qb1", "rb2", "rb1", "wr2", "wr1", "te1", "wr4", "rb4"];
    const a = adviseLineup({
      rosterPositions: SLOTS.chopped,
      roster,
      currentStarters: swapped,
    });
    expect(a.changes).toHaveLength(0);
  });

  it("names the player actually being dropped, not the slot's occupant", () => {
    // rb3 is starting in a flex slot and is not in the recommended lineup, so
    // he is the one leaving even though the slot he vacates gets filled by
    // somebody who was already starting elsewhere.
    const current = ["qb1", "rb1", "rb2", "wr1", "wr2", "te1", "rb3", "wr4"];
    const a = adviseLineup({
      rosterPositions: SLOTS.chopped,
      roster,
      currentStarters: current,
    });
    expect(a.changes).toHaveLength(1);
    expect(a.changes[0].recommended?.playerId).toBe("rb4");
    expect(a.changes[0].reason).toContain("over rb3");
  });

  it("says nothing when the lineup is already right", () => {
    const a = adviseLineup({
      rosterPositions: SLOTS.chopped,
      roster,
      currentStarters: OPTIMAL_CHOPPED,
    });
    expect(a.changes).toHaveLength(0);
  });

  it("never starts a player on bye or ruled out", () => {
    const hurt = roster.map((p) =>
      p.playerId === "rb1" ? { ...p, injuryStatus: "Out" } : p,
    );
    const a = adviseLineup({
      rosterPositions: SLOTS.chopped,
      roster: hurt,
      currentStarters: [],
    });
    const starters = a.slots.map((s) => s.recommended?.playerId);
    expect(starters).not.toContain("rb1");
  });

  it("flags a current starter who is on bye, ruled out, or unranked", () => {
    const withProblems = [
      ...roster,
      player({ playerId: "rbUnranked", position: "RB", unranked: true }),
      player({ playerId: "wrOnBye", position: "WR", positionalRank: 40, flexRank: 90, onBye: true }),
    ];
    const a = adviseLineup({
      rosterPositions: SLOTS.chopped,
      roster: withProblems,
      currentStarters: ["qb1", "rbUnranked", "rb1", "wrOnBye", "wr1", "te1", "rb2", "wr2"],
    });
    const flagged = a.problems.map((p) => [p.player.playerId, p.why]);
    expect(flagged).toContainEqual(["rbUnranked", "not in his list this week"]);
    expect(flagged).toContainEqual(["wrOnBye", "on bye this week"]);

    // And neither of them is recommended anywhere.
    const starters = a.slots.map((s) => s.recommended?.playerId);
    expect(starters).not.toContain("wrOnBye");
  });

  it("names the alternative, so the call can be argued with", () => {
    const a = adviseLineup({
      rosterPositions: SLOTS.chopped,
      roster,
      currentStarters: OPTIMAL_CHOPPED,
    });
    const flex = a.slots.filter((s) => s.slot === "FLEX");
    // Everyone better is already starting, so the best bench option is rb3.
    expect(flex[1].alternative?.playerId).toBe("rb3");
    expect(flex[1].reason).toContain("Next best is");
  });

  it("fills a DEF slot from his D/ST list", () => {
    const a = adviseLineup({
      rosterPositions: SLOTS.halfPpr,
      roster,
      currentStarters: [],
    });
    expect(a.slots.find((s) => s.slot === "DEF")?.recommended?.playerId).toBe("def1");
  });

  describe("superflex", () => {
    it("takes the second quarterback, not the best running back", () => {
      const a = adviseLineup({
        rosterPositions: SLOTS.dynasty,
        roster,
        currentStarters: [],
      });
      const sf = a.slots.find((s) => s.slot === "SUPER_FLEX");
      expect(sf?.recommended?.playerId).toBe("qb2");
      expect(a.superflexFellThrough).toBe(false);
    });

    it("still puts the better quarterback in the QB slot", () => {
      const a = adviseLineup({
        rosterPositions: SLOTS.dynasty,
        roster,
        currentStarters: [],
      });
      expect(a.slots.find((s) => s.slot === "QB")?.recommended?.playerId).toBe("qb1");
    });

    it("falls through to a flex player when the second quarterback cannot play", () => {
      const hurt = roster.map((p) =>
        p.playerId === "qb2" ? { ...p, injuryStatus: "Out" } : p,
      );
      const a = adviseLineup({
        rosterPositions: SLOTS.dynasty,
        roster: hurt,
        currentStarters: [],
      });
      const sf = a.slots.find((s) => s.slot === "SUPER_FLEX");
      expect(a.superflexFellThrough).toBe(true);
      expect(sf?.recommended).not.toBeNull();
      expect(sf?.recommended?.position).not.toBe("QB");
    });
  });
});

describe("adjustedFlexRanks", () => {
  const flex = [
    { playerId: "a", rank: 1 },
    { playerId: "b", rank: 2 },
    { playerId: "c", rank: 3 },
  ];

  it("leaves his order alone when the scoring matches", () => {
    const list = new Map([["a", 20], ["b", 18], ["c", 16]]);
    const out = adjustedFlexRanks(flex, list, list);
    expect(out.get("a")).toBe(1);
    expect(out.get("b")).toBe(2);
    expect(out.get("c")).toBe(3);
  });

  it("lifts a high-reception player in a full-PPR league", () => {
    const list = new Map([["a", 20], ["b", 18], ["c", 16]]);
    // c catches eight passes a week, so full PPR pays him four more.
    const league = new Map([["a", 20.5], ["b", 18.5], ["c", 20]]);
    const out = adjustedFlexRanks(flex, list, league);
    expect(out.get("c")).toBeLessThan(out.get("b")!);
  });

  it("does not move a touchdown-dependent back", () => {
    const list = new Map([["a", 20], ["b", 18], ["c", 16]]);
    const league = new Map([["a", 20.5], ["b", 18.5], ["c", 16.5]]);
    const out = adjustedFlexRanks(flex, list, league);
    expect(out.get("a")).toBe(1);
    expect(out.get("c")).toBe(3);
  });

  it("keeps the rank of a player with no projection rather than guessing one", () => {
    const list = new Map([["a", 20], ["b", 18]]);
    const league = new Map([["a", 20], ["b", 18]]);
    const out = adjustedFlexRanks(flex, list, league);
    // c has no projection on either side, so its delta is zero and the curve
    // keeps it where he put it.
    expect(out.get("c")).toBe(3);
  });

  it("ignores rows that never resolved to a Sleeper id", () => {
    const out = adjustedFlexRanks(
      [{ playerId: null, rank: 1 }, { playerId: "b", rank: 2 }],
      new Map([["b", 10]]),
      new Map([["b", 10]]),
    );
    expect(out.size).toBe(1);
    expect(out.get("b")).toBe(1);
  });
});
