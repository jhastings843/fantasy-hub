import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HEAT_CAP, crowdMultiplier, heatOf, parseMostBet } from "./kotc-crowd";

const html = readFileSync(path.resolve(import.meta.dirname, "../../../../test/fixtures/kotc/most-bet-2026-10-28.html"), "utf8");

describe("parseMostBet", () => {
  const rows = parseMostBet(html);

  it("reads the 50 ranked rows, header skipped", () => {
    expect(rows).toHaveLength(50);
    expect(rows[0]).toEqual({ rank: 1, event: "LA Lakers @ LA Clippers", market: "Walker Kessler Rebounds", line: "8+" });
    expect(rows[2]).toMatchObject({ rank: 3, market: "1st Points Scorer", line: "Shai Gilgeous-Alexander" });
  });

  it("is empty without the table", () => {
    expect(parseMostBet("<html><body>nothing</body></html>")).toEqual([]);
  });
});

describe("heatOf", () => {
  const rows = parseMostBet(html);

  it("counts rows naming a player in the market or the line, higher ranks weigh more", () => {
    const sga = heatOf(rows, "Shai Gilgeous-Alexander");
    expect(sga).toBeGreaterThan(2);
    expect(heatOf(rows, "Walker Kessler")).toBeGreaterThan(heatOf(rows, "Isaiah Hartenstein"));
    expect(heatOf(rows, "Nobody Atall")).toBe(0);
  });

  it("caps the multiplier", () => {
    expect(crowdMultiplier(0)).toBe(1);
    expect(crowdMultiplier(1.5)).toBe(2.5);
    expect(crowdMultiplier(40)).toBe(HEAT_CAP);
  });
});
