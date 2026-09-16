import { describe, expect, it } from "vitest";
import { assessFragility, submittedLineupNote, type FragilityPlayer } from "./fragility";

const POSITIONS = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "FLEX", "BN", "BN", "BN"];

function p(
  id: string,
  position: string,
  points: number,
  extra: Partial<FragilityPlayer> = {},
): FragilityPlayer {
  return { playerId: id, position, points, name: `P${id}`, injuryStatus: null, ...extra };
}

/** Eight solid starters and three usable bench players. Projects 100. */
const deep: FragilityPlayer[] = [
  p("qb", "QB", 20),
  p("rb1", "RB", 15),
  p("rb2", "RB", 12),
  p("wr1", "WR", 14),
  p("wr2", "WR", 12),
  p("te", "TE", 9),
  p("rb3", "RB", 10),
  p("wr3", "WR", 8),
  p("bn1", "RB", 8),
  p("bn2", "WR", 7),
  p("bn3", "TE", 6),
];

/** The same starters, with an empty bench. */
const thin: FragilityPlayer[] = deep.slice(0, 8);

const bestIds = ["qb", "rb1", "rb2", "wr1", "wr2", "te", "rb3", "wr3"];

describe("assessFragility", () => {
  it("is sound with depth and a comfortable line", () => {
    const f = assessFragility({
      players: deep,
      submittedStarters: bestIds,
      rosterPositions: POSITIONS,
      chopLineRange: [55, 70],
    });
    expect(f.bestTotal).toBe(100);
    expect(f.fragile).toBe(false);
    expect(f.submittedGap).toBe(0);
    expect(f.submittedHoles).toEqual([]);
    expect(f.worstOneOut?.name).toBe("Pqb");
  });

  it("marks a thin roster fragile when one absence reaches the chop range", () => {
    const f = assessFragility({
      players: thin,
      submittedStarters: bestIds,
      rosterPositions: POSITIONS,
      chopLineRange: [70, 85],
    });
    // Losing the QB with no backup drops the lineup to 80, inside the range.
    expect(f.worstOneOut).toMatchObject({ name: "Pqb", total: 80, loss: 20 });
    expect(f.fragile).toBe(true);
    expect(f.reasons[0]).toContain("Lose Pqb");
    expect(f.thinSlots.length).toBeGreaterThan(0);
  });

  it("does not call the same absence fragile when the line is far below", () => {
    const f = assessFragility({
      players: thin,
      submittedStarters: bestIds,
      rosterPositions: POSITIONS,
      chopLineRange: [50, 65],
    });
    expect(f.fragile).toBe(false);
  });

  it("worries about two questionable starters", () => {
    const shaky = deep.map((x) =>
      x.playerId === "rb1" || x.playerId === "wr1" ? { ...x, injuryStatus: "Questionable" } : x,
    );
    const f = assessFragility({
      players: shaky,
      submittedStarters: bestIds,
      rosterPositions: POSITIONS,
      chopLineRange: [50, 65],
    });
    expect(f.shakyStarters).toHaveLength(2);
    expect(f.fragile).toBe(true);
  });

  it("finds holes in the lineup as set and measures the gap", () => {
    // Submitted lineup starts a zero-projected TE and leaves the 9-point TE benched.
    const withOut = [...deep, p("hurt", "TE", 0, { injuryStatus: "Out" })];
    const submitted = ["qb", "rb1", "rb2", "wr1", "wr2", "hurt", "rb3", "wr3"];
    const f = assessFragility({
      players: withOut,
      submittedStarters: submitted,
      rosterPositions: POSITIONS,
      chopLineRange: [50, 65],
    });
    expect(f.submittedTotal).toBe(91);
    expect(f.submittedGap).toBe(9);
    expect(f.submittedHoles).toEqual(["TE Phurt (Out)"]);
    expect(submittedLineupNote(f)).toContain("9.0 under your best lineup");
    expect(submittedLineupNote(f)).toContain("TE Phurt (Out)");
  });

  it("treats Sleeper's empty-slot marker as a hole", () => {
    const f = assessFragility({
      players: deep,
      submittedStarters: ["qb", "rb1", "rb2", "wr1", "wr2", "0", "rb3", "wr3"],
      rosterPositions: POSITIONS,
      chopLineRange: [50, 65],
    });
    expect(f.submittedHoles).toEqual(["TE empty"]);
  });

  it("says nothing about the set lineup when it matches the best one", () => {
    const f = assessFragility({
      players: deep,
      submittedStarters: bestIds,
      rosterPositions: POSITIONS,
      chopLineRange: [50, 65],
    });
    expect(submittedLineupNote(f)).toBeNull();
  });

  it("has no submitted read when no lineup is set", () => {
    const f = assessFragility({
      players: deep,
      submittedStarters: [],
      rosterPositions: POSITIONS,
      chopLineRange: [50, 65],
    });
    expect(f.submittedTotal).toBeNull();
    expect(submittedLineupNote(f)).toBeNull();
  });
});
