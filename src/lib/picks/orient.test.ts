import { describe, expect, it } from "vitest";
import { homeFavored, spreadFlipped } from "./orient";
import { parseCurrentOdds, parseSummary } from "./closing";
import { nbaOdds } from "./nba";
import { readOpenClose } from "@/lib/models/nba/game-lines";

describe("every spread reader puts the favorite on the right side", () => {
  it("reads who is favored from moneylines first, then the feed's flags", () => {
    expect(homeFavored({ mlHome: -245, mlAway: 200 })).toBe(true);
    expect(homeFavored({ mlHome: 200, mlAway: -245, homeFav: true })).toBe(false);
    expect(homeFavored({ homeFav: false, awayFav: true })).toBe(false);
    expect(homeFavored({})).toBeNull();
    expect(spreadFlipped(2.5, { homeFav: true, awayFav: false })).toBe(true);
    expect(spreadFlipped(-2.5, { homeFav: true, awayFav: false })).toBe(false);
    expect(spreadFlipped(0.5, { mlHome: -120, mlAway: 100 })).toBe(false);
  });

  // UConn at Air Force, 2026-10-31: DraftKings AF -2.5, Air Force the favorite.
  const board = (spread: number) => ({
    events: [
      {
        id: "401861966",
        date: "2026-10-31T19:00Z",
        status: { type: { state: "pre" } },
        competitions: [
          {
            competitors: [
              { homeAway: "home", team: { id: "2005", abbreviation: "AFA", location: "Air Force" } },
              { homeAway: "away", team: { id: "41", abbreviation: "CONN", location: "UConn" } },
            ],
            odds: [{ spread, overUnder: 44.5, provider: { name: "DraftKings" }, homeTeamOdds: { favorite: true }, awayTeamOdds: { favorite: false }, pointSpread: { home: { close: { odds: "-105" } }, away: { close: { odds: "-115" } } } }],
          },
        ],
      },
    ],
  });
  it("football current lines: a wrong-side spread is turned around, prices with it", () => {
    const ok = [...parseCurrentOdds("cfb", 10, board(-2.5), "now").values()][0];
    expect(ok.line).toBe(-2.5);
    const bad = [...parseCurrentOdds("cfb", 10, board(2.5), "now").values()][0];
    expect(bad.line).toBe(-2.5);
    expect(bad.homePrice).toBe(-115);
    expect(bad.awayPrice).toBe(-105);
  });
  it("football closes: open and close turn together", () => {
    const s = parseSummary({ pickcenter: [{ pointSpread: { home: { open: { line: "+1.5" }, close: { line: "+2.5" } } }, total: { over: { close: { line: "o44.5" } } }, moneyline: { home: { close: { odds: "-140" } }, away: { close: { odds: "+120" } } } }] })!;
    expect(s.open).toBe(-1.5);
    expect(s.close).toBe(-2.5);
    expect(s.totalClose).toBe(44.5);
  });
  it("NBA scoreboard odds and core odds get the same check", () => {
    const g = nbaOdds({ spread: 6.5, moneyline: { home: { close: { odds: "-250" } }, away: { close: { odds: "+205" } } }, pointSpread: { home: { close: { line: "+6.5", odds: "-110" } }, away: { close: { line: "-6.5", odds: "-108" } } } });
    expect(g.line).toEqual({ home: -6.5, homePrice: -108, awayPrice: -110 });
    const oc = readOpenClose({ items: [{ provider: { name: "DraftKings" }, homeTeamOdds: { open: { pointSpread: { american: "+5" } }, close: { pointSpread: { american: "+6.5" }, moneyLine: { american: "-250" } } }, awayTeamOdds: { close: { moneyLine: { american: "+205" } } } }] })!;
    expect(oc.close.spread).toBe(-6.5);
    expect(oc.open.spread).toBe(-5);
  });
});
