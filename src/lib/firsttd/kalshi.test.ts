import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseFirstTdPage } from "./parse";
import { grade } from "./grade";
import { kalshiFee } from "./kalshi";
import { kalshiCost, kalshiFor, trends } from "./trends";

const html = readFileSync(path.resolve(import.meta.dirname, "../../../test/fixtures/firsttd/game-2026_06_SEA_DEN.html"), "utf8");
const g = parseFirstTdPage("2026_06_SEA_DEN", html)!;
const wilson = { kind: "offense" as const, team: "SEA", scorer: "Emanuel Wilson", how: "rush" as const, period: 1, clock: "1:00" };

describe("Kalshi first TD prices", () => {
  it("charges Kalshi's fee, rounded up to the cent", () => {
    expect(kalshiFee(0.1)).toBe(0.01);
    expect(kalshiFee(0.5)).toBe(0.02);
    expect(kalshiCost(0.1)).toBe(0.11);
  });

  it("matches Sam's short names to one Kalshi player only", () => {
    const k = { event: "E", at: "", players: [{ name: "Emanuel Wilson", bid: 0.1, ask: 0.11, last: null }] };
    expect(kalshiFor(k, "E.Wilson")?.ask).toBe(0.11);
    expect(kalshiFor({ ...k, players: [...k.players, { name: "Eric Wilson", bid: 0.01, ask: 0.02, last: null }] }, "E.Wilson")).toBeNull();
  });

  it("books Sam's value plays at the ask", () => {
    const k = { event: "E", at: "", players: [{ name: "Emanuel Wilson", bid: 0.08, ask: 0.09, last: null }] };
    const t = trends([{ game: g, result: grade(g, wilson), kalshi: k }]);
    const v = t.market.find((x) => x.id === "k-value")!;
    // Sam 15.7% against a 10 cent cost: one bet, one win, paid 9 to 1.
    expect(v).toMatchObject({ bets: 1, w: 1, units: 9, needed: 0.1, verdict: "early" });
    expect(t.kalshiGames).toBe(1);
  });
});
