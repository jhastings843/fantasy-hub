import { describe, expect, it } from "vitest";
import { clvPrice, impliedOf, parseSummary, type ClosingLine } from "./closing";
import { betPrices, issuedClv, type IssuedRecord } from "./issued";
import { key } from "./engine";

describe("price-aware CLV", () => {
  it("an unchanged spread bet at -110 that closed -140 gains, though point CLV reads 0", () => {
    const v = clvPrice("home", -3, { home: -110, away: -110 }, { close: -3, closeHomePrice: -140, closeAwayPrice: 120 })!;
    // No-vig: 0.5 at bet; close 0.5833 / (0.5833 + 0.4545) = 0.562.
    expect(v).toBeCloseTo(0.0621, 3);
  });

  it("the other side of the same move loses the same", () => {
    const v = clvPrice("away", -3, { home: -110, away: -110 }, { close: -3, closeHomePrice: -140, closeAwayPrice: 120 })!;
    expect(v).toBeCloseTo(-0.0621, 3);
  });

  it("only our price at bet: raw implied at both ends", () => {
    const v = clvPrice("home", -3, { home: -110 }, { close: -3, closeHomePrice: -140, closeAwayPrice: 120 })!;
    expect(v).toBeCloseTo(impliedOf(-140) - impliedOf(-110), 9);
  });

  it("null when the spread moved, or the close has no price (older records)", () => {
    expect(clvPrice("home", -3, { home: -110 }, { close: -3.5, closeHomePrice: -110, closeAwayPrice: -110 })).toBeNull();
    expect(clvPrice("home", -3, { home: -110 }, { close: -3 })).toBeNull();
    expect(clvPrice("home", -3, {}, { close: -3, closeHomePrice: -140 })).toBeNull();
  });

  it("reads closing prices from the other leg when the feed had the sides turned", () => {
    // Home listed +6.5 but the home moneyline says home is the big favorite: the sides were swapped.
    const s = parseSummary({
      pickcenter: [{
        pointSpread: { home: { close: { line: "+6.5", odds: "-105" } }, away: { close: { line: "-6.5", odds: "-115" } } },
        moneyline: { home: { close: { odds: "-300" } }, away: { close: { odds: "+240" } } },
      }],
    })!;
    expect(s.close).toBe(-6.5);
    expect(s.closeHomePrice).toBe(-115);
    expect(s.closeAwayPrice).toBe(-105);
  });
});

describe("betPrices", () => {
  const ref = { line: -3, homePrice: -110, awayPrice: -110, source: "DK", fetchedAt: "x" };
  it("pairs our price with the quote's other side at the same number", () => {
    expect(betPrices({ side: "home", homeLine: -3, price: -110, ref })).toEqual({ home: -110, away: -110 });
  });
  it("a price shopped at another book stands alone", () => {
    expect(betPrices({ side: "home", homeLine: -3, price: -105, ref })).toEqual({ home: -105 });
  });
  it("a quote at another number lends nothing", () => {
    expect(betPrices({ side: "away", homeLine: -2.5, price: -110, ref })).toEqual({ away: -110 });
  });
});

describe("issuedClv carries the price measure", () => {
  const rec: IssuedRecord = {
    league: "nfl", season: 2026, week: 9, slot: "tue", issuedAt: "2026-11-03T14:00:00Z", provenance: "issued", status: "sent", subject: "s", ruleVersion: "v",
    rule: null, second: null, suMethod: { id: "avg", label: "a" }, su: [], unverified: [],
    plays: [
      { home: "H", away: "A", tier: "t1", side: "home", homeLine: -3, play: "H -3", basis: "reference", shownInEmail: true, units: 1, price: -110, ref: { line: -3, homePrice: -110, awayPrice: -110, source: "DK", fetchedAt: "x" } },
      { home: "C", away: "D", tier: "t1", side: "away", homeLine: 4, play: "D -4", basis: "reference", shownInEmail: true, units: 1, price: -110 },
    ],
  } as IssuedRecord;
  const close = (home: string, away: string, c: Partial<ClosingLine>): [string, ClosingLine] => [key({ week: 9, home, away }), { week: 9, home, away, open: null, close: null, totalOpen: null, totalClose: null, ...c }];

  it("adds price CLV where the close has prices, keeps point CLV for all", () => {
    const closes = new Map([close("H", "A", { close: -3, closeHomePrice: -140, closeAwayPrice: 120 }), close("C", "D", { close: 3 })]);
    const out = issuedClv([rec], closes);
    expect(out.t1).toEqual([0, -1]);
    expect(out.t1Price).toHaveLength(1);
    expect(out.t1Price[0]).toBeCloseTo(0.0621, 3);
  });
});
