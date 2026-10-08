import { describe, expect, it } from "vitest";
import { harrisReport, harrisSummary } from "./harris-track";
import type { HarrisWeek } from "./harris-sheet";
import type { GradedGame } from "./engine";

const week = (w: number, rows: HarrisWeek["rows"], picks: HarrisWeek["picks"] = []): HarrisWeek => ({ season: 2026, week: w, rows, picks, verified: true, problems: [], source: "t", at: "t" });
const row = (away: string, home: string, model: number, market: number) => ({ away, home, awayName: away, homeName: home, model, market });
const graded = (w: number, away: string, home: string, market: number, side: "home" | "away", result: "W" | "L" | "P") =>
  ({ week: w, away, home, sam: { market, model: 0 }, david: { market, model: 0 }, final: { home: 0, away: 0 }, read: { agree: true, samSide: side }, result }) as unknown as GradedGame;

describe("harrisReport", () => {
  // Week 4: Washington -3.5 home; he has Washington by 1 (model -1): takes Iowa (away). Iowa loses by 7: away L.
  // Week 4: Memphis -14.5; he has Memphis by 19 (model -19): takes Memphis. Memphis wins by 21: home W, 4.5 edge.
  const w4 = week(4, [row("iowa", "washington", -1, -3.5), row("uab", "memphis", -19, -14.5)], [
    { tier: "best", team: "Iowa", line: 3.5 },
    { tier: "other", team: "Memphis", line: -14.5 },
  ]);
  const finals = new Map([
    ["4:iowa@washington", { home: 24, away: 17 }],
    ["4:uab@memphis", { home: 42, away: 21 }],
  ]);
  it("grades his sheet side at his line, and his picks at their listed line by tier", () => {
    const r = harrisReport([w4], finals, []);
    expect(r.sheet.all).toEqual({ w: 1, l: 1, p: 0 });
    expect(r.sheet.edge3).toEqual({ w: 1, l: 0, p: 0 });
    expect(r.picks.best).toEqual({ w: 0, l: 1, p: 0 });
    expect(r.picks.other).toEqual({ w: 1, l: 0, p: 0 });
    expect(r.picks.all).toEqual({ w: 1, l: 1, p: 0 });
  });
  it("agreement: splits Sam+David agree games by his side; skipping his disagreements that lost is a gain", () => {
    // Sam+David on Washington (home) at -3.5 and WON; he disagrees. Sam+David on Memphis, he agrees, won.
    const g = [graded(4, "iowa", "washington", -3.5, "home", "W"), graded(4, "uab", "memphis", -14.5, "home", "W")];
    const r = harrisReport([w4], finals, g);
    expect(r.agreement.games).toBe(2);
    expect(r.agreement.harrisAgrees).toEqual({ w: 1, l: 0, p: 0 });
    expect(r.agreement.harrisDisagrees).toEqual({ w: 1, l: 0, p: 0 });
    expect(r.agreement.meanGain).toBeLessThan(0); // skipping a winner costs
    expect(r.clears).toEqual({ agreement: false, edge: false });
    expect(harrisSummary(r)).toMatch(/^Harris tracker \(weeks 4\): posted picks 1-1, full sheet 1-1/);
  });
  it("an unverified week is ignored", () => {
    const r = harrisReport([{ ...w4, verified: false }], finals, []);
    expect(r.sheet.all).toEqual({ w: 0, l: 0, p: 0 });
  });
});
