import { describe, expect, it } from "vitest";
import { parseNbaSummaryOdds } from "./nba";

// ESPN's scoreboard drops odds once a game tips; the summary's pickcenter keeps the close.
describe("closing odds from the game summary", () => {
  it("reads DraftKings' close: home spread, total, moneyline", () => {
    const json = {
      pickcenter: [
        {
          provider: { name: "DraftKings" },
          spread: 1.5,
          overUnder: 220.5,
          pointSpread: { home: { close: { line: "+1.5", odds: "-108" } }, away: { close: { line: "-1.5", odds: "-112" } } },
          total: { over: { close: { line: "o220.5", odds: "-115" } }, under: { close: { line: "u220.5", odds: "-105" } } },
          moneyline: { home: { close: { odds: "+105" } }, away: { close: { odds: "-125" } } },
        },
      ],
    };
    expect(parseNbaSummaryOdds(json)).toEqual({
      line: { home: 1.5, homePrice: -108, awayPrice: -112 },
      total: { points: 220.5, overPrice: -115, underPrice: -105 },
      ml: { home: 105, away: -125 },
    });
  });
  it("no pickcenter, nothing", () => {
    expect(parseNbaSummaryOdds({})).toEqual({});
  });
});
