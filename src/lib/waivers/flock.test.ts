import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { flockNote, flockTier, parseFlock } from "./flock";

const fx = (w: number) => readFileSync(path.resolve(__dirname, `../../../test/fixtures/flock/week${w}.html`), "utf8");

describe("parseFlock", () => {
  it("reads the Week 6 email: three adds, deeper, don't chase, QB streams, defenses", () => {
    const { week, rows } = parseFlock(fx(6), "Week 6 Waiver Wire Targets");
    expect(week).toBe(6);
    const adds = rows.filter((r) => r.section === "add");
    expect(adds.map((r) => [r.rank, r.name, r.position, r.team, r.verdict])).toEqual([
      [1, "Woody Marks", "RB", "HOU", "MUST ADD"],
      [2, "Germie Bernard", "WR", "PIT", "FLEX PLAY"],
      [3, "Pat Freiermuth", "TE", "PIT", "SPOT START"],
    ]);
    expect(adds[0].note).toMatch(/^Marks is the most obvious add/);
    expect(rows.filter((r) => r.section === "deeper").map((r) => r.name)).toEqual(["Dameon Pierce", "Xavier Worthy", "Quentin Johnston"]);
    expect(rows.filter((r) => r.section === "dont-chase").map((r) => r.name)).toEqual([
      "Raheim Sanders", "MarShawn Lloyd", "Samaje Perine", "Kendrick Bourne",
    ]);
    expect(rows.filter((r) => r.section === "qb-stream").map((r) => r.name)).toEqual(["Jordan Love", "Tyler Shough"]);
    const dst = rows.filter((r) => r.section === "dst");
    expect(dst.map((r) => [r.team, r.verdict])).toEqual([
      ["KC", "MY PICK"], ["BAL", "ALSO IN PLAY"], ["IND", "ALSO IN PLAY"], ["NE", "ALSO IN PLAY"], ["PIT", "ALSO IN PLAY"],
    ]);
  });

  it("reads the high-roster block and every week's adds", () => {
    const w5 = parseFlock(fx(5), "Week 5 Waiver Wire Targets").rows;
    expect(w5.filter((r) => r.section === "high-roster").map((r) => r.name)).toEqual(["Tyler Allgeier", "Jordyn Tyson"]);
    expect(w5.find((r) => r.section === "add" && r.rank === 1)).toMatchObject({ name: "Will Shipley", team: "PHI", verdict: "PREMIUM HANDCUFF" });
    for (const w of [2, 3, 4, 5, 6]) {
      const rows = parseFlock(fx(w), `Week ${w} Waiver Wire Targets`).rows;
      const adds = rows.filter((r) => r.section === "add");
      expect(adds.length, `week ${w}`).toBeGreaterThanOrEqual(3);
      expect(adds.every((r) => r.note.length > 40), `week ${w} notes`).toBe(true);
      expect(rows.filter((r) => r.section === "dst" && r.verdict === "MY PICK").length, `week ${w} dst`).toBeLessThanOrEqual(1);
    }
  });

  it("maps verdicts to a low tier floor and writes a short note", () => {
    const rows = parseFlock(fx(6), "Week 6 Waiver Wire Targets").rows;
    expect(rows.slice(0, 3).map(flockTier)).toEqual(["multiweek", "filler", "filler"]);
    expect(flockTier(rows.find((r) => r.section === "dont-chase")!)).toBeNull();
    expect(flockNote(rows[0])).toBe("Flock Fantasy (Add #1, must add): Marks is the most obvious add on the wire.");
  });
});
