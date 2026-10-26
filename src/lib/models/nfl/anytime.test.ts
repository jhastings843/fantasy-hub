import { describe, expect, it } from "vitest";
import { anytimeChances, attdEdges, attdTeam, boxTds, gradeAttd, summarizeAttd, type AttdParams, type AttdRow } from "./anytime";
import { readTdScorers } from "../lines";
import PARAMS from "./attd-params.json";

const P = PARAMS as AttdParams;
const row = (over: Partial<AttdRow>): AttdRow => ({ id: "1", name: "A B", team: "KC", key: "ab", m: 0.5, anytime: 0.4, two: 0.09, ...over });

describe("anytime TD model", () => {
  it("Poisson chances", () => {
    const c = anytimeChances(0.63);
    expect(c.anytime).toBeCloseTo(0.467, 3);
    expect(c.two).toBeCloseTo(0.132, 3);
    expect(anytimeChances(0).anytime).toBe(0);
  });

  it("a team's expected TDs split across its list, more implied points more TDs", () => {
    const lines = [
      { id: "rb", name: "Back", team: "KC", rushTd: 8, recTd: 1, car: 150, tgt: 20, teamRushTd: 12, teamRecTd: 14, teamCar: 300, teamTgt: 400 },
      { id: "wr", name: "Wide", team: "KC", rushTd: 0, recTd: 6, car: 2, tgt: 90, teamRushTd: 12, teamRecTd: 14, teamCar: 300, teamTgt: 400 },
    ];
    const lo = attdTeam(lines, 17, P);
    const hi = attdTeam(lines, 30, P);
    expect(hi[0].anytime).toBeGreaterThan(lo[0].anytime);
    expect(lo[0].m + lo[1].m).toBeLessThan(P.a * 17);
  });
});

describe("DK prices, edges, grading", () => {
  it("reads Anytime and 2+ prices per athlete", () => {
    const m = readTdScorers([
      { type: { name: "Anytime Touchdown Scorer" }, athlete: { $ref: ".../athletes/123?x" }, odds: { american: { value: "+150" } } },
      { type: { name: "Player to score 2 or more touchdowns" }, athlete: { $ref: ".../athletes/123" }, odds: { american: { value: "+900" } } },
      { type: { name: "First Touchdown Scorer" }, athlete: { $ref: ".../athletes/123" }, odds: { american: { value: "+700" } } },
    ]);
    expect(m.get("123")).toEqual({ anytime: 150, two: 900 });
  });

  it("an edge must clear DK's break-even by 5 points", () => {
    expect(attdEdges(row({ anytime: 0.45, dk: 150 }))).toHaveLength(1); // break-even 40%
    expect(attdEdges(row({ anytime: 0.43, dk: 150 }))).toHaveLength(0);
  });

  it("grades from the box score: rushing, receiving and return TDs; absent players void", () => {
    const tds = boxTds([
      {
        statistics: [
          { name: "rushing", keys: ["rushingAttempts", "rushingYards", "yardsPerRushAttempt", "rushingTouchdowns"], athletes: [{ athlete: { displayName: "A B" }, stats: ["10", "50", "5.0", "1"] }] },
          { name: "kickReturns", keys: ["kickReturns", "kickReturnYards", "yardsPerKickReturn", "longKickReturn", "kickReturnTouchdowns"], athletes: [{ athlete: { displayName: "A B" }, stats: ["1", "99", "99", "99", "1"] }] },
          { name: "receiving", keys: ["receptions", "receivingYards", "yardsPerReception", "receivingTouchdowns"], athletes: [{ athlete: { displayName: "C D" }, stats: ["3", "20", "6.7", "0"] }] },
        ],
      },
    ]);
    const rows = [row({ key: "ab", anytime: 0.45, two: 0.15, dk: 150, dk2: 900 }), row({ key: "cd", anytime: 0.3, dk: 300 }), row({ key: "ef", dk: 200 })];
    const result = gradeAttd(rows, tds);
    expect(result).toEqual({ ab: 2, cd: 0, ef: null });
    const sum = summarizeAttd([{ slug: "x", week: 8, rows, result }]);
    expect(sum.priced.n).toBe(2);
    expect(sum.priced.hits).toBe(1);
    // ab: anytime edge (45 vs 40) won +1.5u, 2+ edge (15 vs 10) won +9u; cd: 30 vs 25 edge lost.
    expect(sum.edges.n).toBe(3);
    expect(sum.edges.net).toBeCloseTo(1.5 + 9 - 1, 6);
  });
});
