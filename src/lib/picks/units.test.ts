import { describe, expect, it } from "vitest";
import { tierBoard, type StrategyBoard } from "./engine";
import { selectForEmail, toIssued, type IssuedRecord } from "./issued";
import { payout, risk, unitReport } from "./units";
import { slateOf } from "./email";
import type { PicksReport } from "./report";

describe("unit math", () => {
  it("pays the stake on a win and costs the risk on a loss", () => {
    expect(risk(1, -110)).toBeCloseTo(1.1);
    expect(payout("W", 1, -110)).toBe(1);
    expect(payout("L", 1, -110)).toBeCloseTo(-1.1);
    expect(payout("L", 0.5, -118)).toBeCloseTo(-0.59);
    // Plus money: to win 1u at +120 risks 0.833u.
    expect(payout("L", 1, 120)).toBeCloseTo(-0.8333, 3);
    expect(payout("P", 1, -110)).toBe(0);
  });
});

const base: Omit<IssuedRecord, "plays"> = {
  league: "nfl", season: 2026, week: 6, issuedAt: "t", provenance: "issued", subject: "s", ruleVersion: "v",
  rule: null, second: null, suMethod: { id: "avg", label: "a" }, su: [], unverified: [],
};

describe("unit ledger", () => {
  const tue: IssuedRecord = {
    ...base, slot: "tue",
    plays: [
      { home: "H1", away: "A1", tier: "t1", side: "home", homeLine: 3, play: "", basis: "reference", shownInEmail: true, units: 1, price: -110 },
      { home: "H2", away: "A2", tier: "t2", side: "home", homeLine: 3, play: "", basis: "reference", shownInEmail: true, units: 0.5, price: -120 },
      { home: "H3", away: "A3", tier: "t1", side: "home", homeLine: 3, play: "", basis: "reference", shownInEmail: true, units: 1 },
    ],
  };
  const legacy: IssuedRecord = {
    ...base, week: 5, provenance: "recovered",
    plays: [{ home: "H9", away: "A9", tier: "t1", side: "home", homeLine: 3, play: "", basis: "source", shownInEmail: true }],
  };
  const sat: IssuedRecord = {
    ...base, slot: "sat",
    plays: [{ home: "H4", away: "A4", tier: "t1", side: "away", homeLine: -3, play: "", basis: "reference", shownInEmail: true, units: 1, price: -105 }],
  };
  const finals = new Map([
    ["6:A1@H1", { home: 20, away: 21 }], // home +3 covers: W
    ["6:A2@H2", { home: 10, away: 20 }], // L at -120 on 0.5u: -0.6
    // H3 not played yet
    ["6:A4@H4", { home: 24, away: 20 }], // road +3 loses by 4: L at -105: -1.05
    ["5:A9@H9", { home: 0, away: 30 }],
  ]);
  const u = unitReport([legacy, tue, sat], finals);

  it("adds up staked bets at their own prices and leaves unstaked plays out", () => {
    expect(u.total).toMatchObject({ bets: 4, w: 1, l: 2, pending: 1 });
    expect(u.total.units).toBeCloseTo(1 - 0.6 - 1.05, 2);
    expect(u.unstaked).toBe(1);
  });
  it("splits by tier and by send", () => {
    expect(u.byTier.t2.units).toBeCloseTo(-0.6, 2);
    expect(u.bySlot.tue).toMatchObject({ bets: 3, w: 1, l: 1, pending: 1 });
    expect(u.bySlot.sat.units).toBeCloseTo(-1.05, 2);
    expect(u.byWeek.map((x) => x.week)).toEqual([6]);
  });
});

describe("stakes on issued bets", () => {
  it("records 1u / 0.5u and the price on the side that was bet", () => {
    const ref = { line: 3, source: "DraftKings via ESPN", fetchedAt: "t", homePrice: -118, awayPrice: -102, kickoff: "2026-10-15T00:15:00Z" };
    const board = tierBoard("nfl", [{ home: "H", away: "A", sam: { market: 3, model: 1 }, david: { market: 3, model: 0 }, ref }], {
      rule: { id: "dog", label: "dog", test: { side: "dog" }, record: {} }, second: null,
    } as unknown as StrategyBoard);
    const r = { league: "nfl", season: 2026, week: 6, board, strategies: { rule: null, second: null }, su: { best: null } } as unknown as PicksReport;
    const rec = toIssued(r, selectForEmail(r, 99, 0), { issuedAt: "t", subject: "s" });
    expect(rec.plays[0]).toMatchObject({ units: 1, price: -118, kickoff: "2026-10-15T00:15:00Z" });
  });
});

describe("slates", () => {
  it("names each kickoff's slate in Eastern time", () => {
    expect(slateOf("2026-10-16T00:15:00Z").label).toBe("Thursday night"); // Thu 8:15pm ET
    expect(slateOf("2026-10-18T17:00:00Z").label).toBe("Sunday");
    expect(slateOf("2026-10-20T00:15:00Z").label).toBe("Monday night");
    expect(slateOf("2026-10-13T23:00:00Z").label).toBe("Tuesday night");
    expect(slateOf("2026-10-17T16:00:00Z").label).toBe("Saturday");
  });
});
