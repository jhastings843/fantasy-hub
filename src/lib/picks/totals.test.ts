import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseDavidBoard, parseSamBoard, parseSamRecord, weekOf } from "./parse";
import { key } from "./engine";
import {
  type TotalsSeen,
  clvTotal,
  gradeTotal,
  readTotal,
  totalsBacktest,
  totalsBoard,
  totalsCuts,
} from "./totals";

const fx = (f: string) => readFileSync(path.resolve(__dirname, "../../../test/fixtures/picks", f), "utf8");

describe("model totals from the sites", () => {
  it("adds each site's projected scores (Week 5 NFL, TB at DAL)", () => {
    // Sam: 23.9 + 27.8. David: 23.3 + 25.9, which his page also prints as "Model total 49.2".
    expect(parseSamBoard("nfl", fx("sam-board.html")).rows[0]).toMatchObject({ away: "TB", home: "DAL", modelTotal: 51.7 });
    expect(parseDavidBoard("nfl", fx("ds-board.html")).rows[0]).toMatchObject({ away: "TB", home: "DAL", modelTotal: 49.2 });
  });
  it("reads college projected scores and Sam's projected totals on his record", () => {
    const cfb = parseDavidBoard("cfb", fx("ds-cfb-board.html")).rows;
    expect(cfb.every((r) => r.modelTotal !== undefined)).toBe(true);
    const rec = parseSamRecord("nfl", fx("sam-record.html"), (d) => weekOf("nfl", d));
    // "ATL at NO ... Projected 21.4–22.1".
    expect(rec[0]).toMatchObject({ away: "ATL", home: "NO", modelTotal: 43.5 });
  });
});

describe("over/under arithmetic", () => {
  it("reads sides against one number", () => {
    expect(readTotal(45.5, 48, 47)).toMatchObject({ agree: true, side: "over", minEdge: 1.5 });
    expect(readTotal(45.5, 48, 44).agree).toBe(false);
    expect(readTotal(45.5, 45.5, 50).agree).toBe(false); // on the number is no side
  });
  it("grades and scores against the close", () => {
    expect(gradeTotal(50, 45.5, "over")).toBe("W");
    expect(gradeTotal(45, 45, "under")).toBe("P");
    // Over at 45.5 that closed 47: 1.5 better. Under at 45.5 that closed 47: 1.5 worse.
    expect(clvTotal("over", 45.5, 47)).toBe(1.5);
    expect(clvTotal("under", 45.5, 47)).toBe(-1.5);
  });
});

describe("totals backtest and board", () => {
  const seen = (i: number, sam: number, david: number, line = 45): TotalsSeen => ({
    week: 6, home: `H${i}`, away: `A${i}`, sam, david, line, source: "DraftKings via ESPN", seenAt: "t",
  });
  // 11 agreed overs: 9 win, 2 lose. One game not finished yet.
  const rows = Array.from({ length: 11 }, (_, i) => seen(i, 49, 48));
  const finals = new Map(rows.map((r, i) => [key(r), i < 9 ? 52 : 40]));
  rows.push(seen(99, 49, 48));

  it("needs 10+ decided agreement games before a totals rule exists", () => {
    const few = totalsBacktest("nfl", rows.slice(0, 9), finals, [], new Map(), key);
    expect(few.rule).toBeNull();
    const bt = totalsBacktest("nfl", rows, finals, [], new Map(), key);
    expect(bt.archived).toBe(11);
    expect(bt.cuts.find((c) => c.id === "t-over")!.record).toMatchObject({ w: 9, l: 2 });
    expect(bt.rule).not.toBeNull();
  });

  it("grades Sam alone at the opening total, with CLV against the close", () => {
    const sam = [{ week: 4, home: "H", away: "A", modelTotal: 50 }];
    const market = new Map([["4:A@H", { open: 45, close: 47 }]]);
    const bt = totalsBacktest("nfl", [], new Map([["4:A@H", 41]]), sam, market, key);
    expect(bt.samAlone.record).toMatchObject({ w: 0, l: 1 });
    expect(bt.samAlone.clv).toEqual({ avg: 2, n: 1 });
  });

  it("only calls a total a play when a rule qualifies, and never without a current line", () => {
    const ref = { total: 45, source: "s", fetchedAt: "t" };
    const board = [
      { home: "H1", away: "A1", sam: 49, david: 48, ref },
      { home: "H2", away: "A2", sam: 49, david: 44, ref },
      { home: "H3", away: "A3", sam: 49, david: 48 },
      { home: "H4", away: "A4", sam: 49, ref },
    ];
    expect(totalsBoard(board, null).map((g) => g.tier)).toEqual(["lean", "split", "noline", "one"]);
    const rule = totalsCuts("nfl").find((c) => c.id === "t-over")!;
    const b = totalsBoard(board, rule);
    expect(b[0]).toMatchObject({ tier: "t1", play: "Over 45", side: "over", line: 45 });
  });
});
