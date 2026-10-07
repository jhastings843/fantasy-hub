import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  parseDavidBoard,
  parseSamBoard,
  parseSamRecord,
  parseSheetTabs,
  parseSheetWeek,
  teamKey,
  weekOf,
} from "./parse";

const fx = (f: string) => readFileSync(path.resolve(__dirname, "../../../test/fixtures/picks", f), "utf8");

describe("calendar", () => {
  it("puts 2026 NFL dates in the right week", () => {
    expect(weekOf("nfl", "2026-09-24")).toBe(3);
    expect(weekOf("nfl", "2026-09-28")).toBe(3);
    expect(weekOf("nfl", "2026-10-01")).toBe(4);
    expect(weekOf("nfl", "2026-10-05")).toBe(4);
    expect(weekOf("cfb", "2026-10-03")).toBe(5);
  });
});

describe("team keys", () => {
  it("folds college names", () => {
    expect(teamKey("cfb", "San José State")).toBe(teamKey("cfb", "San Jose St."));
    expect(teamKey("cfb", "Hawai&#x27;i")).toBe(teamKey("cfb", "Hawaii"));
    expect(teamKey("nfl", "Los Angeles Rams")).toBe("LA");
  });
});

describe("Sam's pages", () => {
  it("reads the NFL record", () => {
    const rows = parseSamRecord("nfl", fx("sam-record.html"), (d) => weekOf("nfl", d));
    expect(rows).toHaveLength(32);
    const tb = rows.find((r) => r.home === "PHI" && r.away === "LA")!;
    expect(tb.week).toBe(4);
    expect(tb.line.market).toBe(1.5);
    expect(tb.line.model).toBeCloseTo(6.1, 5);
    expect([tb.awayPts, tb.homePts]).toEqual([24, 20]);
  });
  it("reads the NFL board", () => {
    const b = parseSamBoard("nfl", fx("sam-board.html"));
    expect(b.week).toBe(5);
    expect(b.season).toBe(2026);
    expect(b.rows).toHaveLength(15);
    expect(b.rows[0]).toMatchObject({ home: "DAL", away: "TB", line: { market: -9.5, model: -3.9 } });
  });
  it("reads the college record and board", () => {
    expect(parseSamRecord("cfb", fx("sam-cfb-record.html"), (d) => weekOf("cfb", d))).toHaveLength(114);
    const b = parseSamBoard("cfb", fx("sam-cfb-board.html"));
    expect(b.week).toBe(6);
    expect(b.rows).toHaveLength(58);
  });
});

describe("David's pages", () => {
  it("lists the sheet's week tabs", () => {
    expect(parseSheetTabs(fx("ds-sheet.html")).map((t) => t.week)).toEqual([3, 4]);
    expect(parseSheetTabs(fx("ds-cfb-sheet.html")).map((t) => t.week)).toEqual([1, 2, 3, 4, 5]);
  });
  it("reads a week tab", () => {
    const rows = parseSheetWeek("nfl", 3, fx("ds-week3.csv"));
    expect(rows).toHaveLength(16);
    const gb = rows.find((r) => r.home === "GB")!;
    expect(gb.line.market).toBe(-5.5);
    expect(gb.line.model).toBeCloseTo(-4.54, 2);
  });
  it("reads the NFL board", () => {
    const b = parseDavidBoard("nfl", fx("ds-board.html"));
    expect(b.week).toBe(5);
    expect(b.rows).toHaveLength(15);
    expect(b.rows[0]).toMatchObject({ home: "DAL", away: "TB", line: { market: -8.5, model: -2.6 } });
    const atl = b.rows.find((r) => r.home === "ATL")!;
    expect(atl.line).toEqual({ market: -3.5, model: 0.3 });
  });
  it("reads the college board", () => {
    const b = parseDavidBoard("cfb", fx("ds-cfb-board.html"));
    expect(b.week).toBe(6);
    expect(b.rows.length).toBeGreaterThan(50);
    const troy = b.rows.find((r) => r.home === "troy")!;
    expect(troy.line).toEqual({ market: -10.5, model: -11.4 });
  });
});
