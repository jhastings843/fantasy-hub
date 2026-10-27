import { describe, expect, it } from "vitest";
import { type StrategyBoard, tally } from "./engine";
import type { ForecastSnapshot } from "./forecasts";
import { priceShadow } from "./price-shadow";

const rec = tally(["W", "W", "L"]);
// Tier 1: any agreement.
const board = { cuts: [], baselines: [], splits: { sam: rec, david: rec }, byWeek: [], rule: { id: "agree", label: "Agree", group: "Agree", test: {}, record: rec }, second: null } as unknown as StrategyBoard;

const snap = (home: string, away: string, line: number, homePrice: number, at = "2026-10-20T12:00:00Z"): ForecastSnapshot => ({
  at, week: 7, home, away,
  // Both models like the home team by more than the line.
  sam: { model: line - 4, market: line }, david: { model: line - 3, market: line },
  ref: { line, homePrice, awayPrice: -110, kickoff: "2026-10-21T00:00:00Z", source: "DraftKings", fetchedAt: at },
});

describe("priceShadow", () => {
  it("bets every tier pick at -115 or better, graded at its price, and splits bet from not bet", () => {
    const snaps = [
      snap("A", "B", -3, -110, "2026-10-20T10:00:00Z"),
      snap("A", "B", -3, -114), // the last pregame read wins
      snap("C", "D", -3, -120), // over the cap
      snap("E", "F", -3, +105),
      snap("G", "H", -3, -110, "2026-10-21T01:00:00Z"), // after kickoff: ignored
    ];
    const finals = new Map([
      ["7:B@A", { home: 20, away: 10 }],
      ["7:D@C", { home: 20, away: 10 }],
      ["7:F@E", { home: 10, away: 20 }],
    ]);
    const x = priceShadow("nfl", snaps, [[7, board]], finals, new Map([["7:B@A", "home"]]));
    expect(x.rows.map((r) => [r.home, r.price, r.result, r.bet])).toEqual([
      ["A", -114, "W", true],
      ["E", 105, "L", false],
    ]);
    expect(x.overCap).toBe(1);
    expect(x.all).toMatchObject({ w: 1, l: 1, actual: -0.12 });
    expect(x.bet).toMatchObject({ w: 1, l: 0, actual: 0.88 });
    expect(x.passed).toMatchObject({ w: 0, l: 1, actual: -1 });
  });
});
