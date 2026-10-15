import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseFirstTdPage } from "./parse";
import { grade } from "./grade";
import { MIN_GAMES, trends } from "./trends";

const html = readFileSync(path.resolve(import.meta.dirname, "../../../test/fixtures/firsttd/game-2026_06_SEA_DEN.html"), "utf8");
const g = parseFirstTdPage("2026_06_SEA_DEN", html)!;
const wilson = { kind: "offense" as const, team: "SEA", scorer: "Emanuel Wilson", how: "rush" as const, period: 1, clock: "1:00" };
const sutton = { kind: "offense" as const, team: "DEN", scorer: "Courtland Sutton", how: "pass" as const, period: 1, clock: "1:00" };

describe("first TD trends", () => {
  it("counts hits against Sam's own expectation", () => {
    const t = trends([{ game: g, result: grade(g, wilson) }, { game: g, result: grade(g, sutton) }]);
    const pick = t.headline.find((x) => x.id === "pick")!;
    expect(pick).toMatchObject({ n: 2, actual: 1, expected: 0.31, verdict: "early" });
    expect(t.rank.find((x) => x.id === "r1")!.actual).toBe(1);
    expect(t.passShare).toEqual({ n: 2, actual: 1, expected: 1.38 });
    expect(t.findings).toEqual([]);
  });

  it("calls a trend only past the sample bar and the 90% line", () => {
    const many = Array.from({ length: MIN_GAMES }, () => ({ game: g, result: grade(g, wilson) }));
    const t = trends(many);
    expect(t.headline.find((x) => x.id === "pick")!.verdict).toBe("over");
    expect(t.findings[0]).toMatch(/undersold/);
  });
});
