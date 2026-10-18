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

  it("tracks Kalshi bets by Sam's probability tier, value or not", () => {
    const kalshi = {
      event: "x",
      at: "2026-10-16T00:00:00Z",
      players: [
        { name: "Emanuel Wilson", bid: 0.11, ask: 0.12, last: null },
        { name: "Jaxon Smith-Njigba", bid: 0.14, ask: 0.15, last: null },
        { name: "Courtland Sutton", bid: 0.04, ask: 0.05, last: null },
      ],
    };
    const t = trends([{ game: g, result: grade(g, wilson), kalshi }]);
    const m = (id: string) => t.market.find((x) => x.id === id)!;
    // Wilson 15.7% at 12c + 1c fee: a winner paying 0.87 / 0.13.
    expect(m("k-p12")).toMatchObject({ bets: 1, w: 1, units: 6.69 });
    // Top two in the game: Wilson and Smith-Njigba (11.1%, 15c + 1c), one winner.
    expect(m("k-top2")).toMatchObject({ bets: 2, w: 1 });
    expect(m("k-p4")).toMatchObject({ bets: 1, w: 0, units: -1 });
    // 8%+ and above cost keeps Wilson, drops Smith-Njigba (11.1% under his 16c).
    expect(m("k-p8-value")).toMatchObject({ bets: 1, w: 1 });
  });
});
