import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { decidedOdds, filterRead, intradayHead, openTrades, todayRows } from "./intraday";
import { isSnapshot, type Intraday } from "./types";

// A real trade-bot payload: a replay of 2026-10-28 with two trades forced through the filter.
const sample = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../../test/fixtures/money/intraday-sample.json"), "utf8")) as Intraday;
const empty: Intraday = { book: "intraday-orb", start: 100000, equity: 100000, curve: [], today: [], record: null, skills: [], status: "waiting for the first session", filter: "x" };
const snap = (x: object) => ({ version: 1, generatedAt: "2026-10-28T21:00:00Z", books: [], phil: null, ...x });

describe("isSnapshot with the intraday desk", () => {
  it("accepts a snapshot without it, with it, empty, or failed", () => {
    expect(isSnapshot(snap({}))).toBe(true);
    expect(isSnapshot(snap({ intraday: sample }))).toBe(true);
    expect(isSnapshot(snap({ intraday: empty }))).toBe(true);
    expect(isSnapshot(snap({ intraday: { error: "desk failed" } }))).toBe(true);
    expect(isSnapshot(snap({ intraday: null }))).toBe(true);
  });
  it("rejects a malformed intraday value", () => expect(isSnapshot(snap({ intraday: "oops" }))).toBe(false));
});

describe("filterRead", () => {
  it("calls the sample too early (2 taken, 19 shadow)", () => {
    const r = filterRead(sample.record!.taken, sample.record!.shadow);
    expect(r.kind).toBe("early");
    expect(r.text).toContain("2 taken and 19 turned down");
  });
  it("says nothing is graded on the empty desk", () => expect(filterRead(null, null).kind).toBe("empty"));
  const st = (n: number, meanR: number) => ({ n, meanR, hit: 0.5, t: 1 });
  it("reads helping, hurting and even once both sides have 30", () => {
    expect(filterRead(st(30, 0.3), st(40, 0.1)).kind).toBe("helping");
    expect(filterRead(st(30, -0.1), st(40, 0.2)).kind).toBe("hurting");
    expect(filterRead(st(30, 0.12), st(40, 0.1)).kind).toBe("even");
  });
});

describe("rows", () => {
  it("drops an open trade the day already shows as closed", () => {
    expect(sample.open!.length).toBe(1);
    expect(openTrades(sample)).toEqual([]);
    expect(openTrades(empty)).toEqual([]);
  });
  it("lists taken first, then latest trigger first", () => {
    const rows = todayRows(sample);
    expect(rows.length).toBe(21);
    expect(rows.slice(0, 2).map((r) => r.decision)).toEqual(["taken", "taken"]);
    expect(rows[0].symbol).toBe("PH");
  });
  it("turns replay odds into the decided share the filter uses", () => {
    expect(decidedOdds(sample.today![0])).toBeCloseTo(0.1324 / (0.1324 + 0.5555), 6);
    expect(decidedOdds({ ...sample.today![0], p_target: null })).toBeNull();
  });
  it("reads the head from the book and SPY", () => {
    const h = intradayHead(sample);
    expect(h.ret).toBeCloseTo(-0.0031903, 6);
    expect(h.edge).toBeCloseTo(-0.0031903 - 0.001193, 6);
    expect(intradayHead(empty)).toMatchObject({ ret: 0, spyRet: null, waiting: true });
  });
});
