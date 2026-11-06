import { describe, expect, it } from "vitest";
import { fixture } from "./fixture";
import { isPortfolioSnapshot } from "./types";

// The ingest door: a version 1 snapshot gets in, anything else is refused.

describe("isPortfolioSnapshot", () => {
  it("accepts the full fixture", () => {
    expect(isPortfolioSnapshot(fixture())).toBe(true);
  });

  it("accepts the bare minimum: version, asOf, totals, holdings", () => {
    expect(isPortfolioSnapshot({ version: 1, asOf: "2026-11-05T23:40:00Z", totals: { total: 100 }, holdings: [] })).toBe(true);
  });

  it("accepts a track record from learn.py and refuses a malformed one", () => {
    const ok = { ...fixture(), trackRecord: { groups: [{ key: "sell", scored: 2, hits: 1, hitRate: 50 }], recent: [], lessons: ["x"] } };
    expect(isPortfolioSnapshot(ok)).toBe(true);
    expect(isPortfolioSnapshot({ ...fixture(), trackRecord: { groups: "sell" } })).toBe(false);
    expect(isPortfolioSnapshot({ ...fixture(), trackRecord: { groups: [{ label: "no key" }] } })).toBe(false);
    expect(isPortfolioSnapshot({ ...fixture(), trackRecord: [] })).toBe(false);
  });

  it("accepts a snapshot whose advisor is missing", () => {
    const s = fixture() as unknown as Record<string, unknown>;
    delete s.advisor;
    expect(isPortfolioSnapshot(s)).toBe(true);
  });

  it("accepts an advisor with no ideas array", () => {
    const s = fixture();
    delete s.advisor!.ideas;
    expect(isPortfolioSnapshot(s)).toBe(true);
  });

  const bad: [string, (s: Record<string, unknown>) => unknown][] = [
    ["null", () => null],
    ["an array", () => []],
    ["a string", () => "snapshot"],
    ["version 2", (s) => ({ ...s, version: 2 })],
    ["version as a string", (s) => ({ ...s, version: "1" })],
    ["no asOf", (s) => ({ ...s, asOf: undefined })],
    ["asOf not a date", (s) => ({ ...s, asOf: "yesterday" })],
    ["no totals", (s) => ({ ...s, totals: undefined })],
    ["total as a string", (s) => ({ ...s, totals: { total: "50000" } })],
    ["dayChange as a string", (s) => ({ ...s, totals: { total: 1, dayChange: "-5" } })],
    ["holdings not an array", (s) => ({ ...s, holdings: { AAA: {} } })],
    ["a holding with no symbol", (s) => ({ ...s, holdings: [{ value: 5 }] })],
    ["accounts not an array", (s) => ({ ...s, accounts: "Brokerage" })],
    ["history not an array", (s) => ({ ...s, history: {} })],
    ["a history point with no total", (s) => ({ ...s, history: [{ date: "2026-11-05" }] })],
    ["market not an object", (s) => ({ ...s, market: [1, 2] })],
    ["advisor as a string", (s) => ({ ...s, advisor: "hold" })],
    ["advisor actions not an array", (s) => ({ ...s, advisor: { actions: "sell" } })],
    ["an action with no kind", (s) => ({ ...s, advisor: { actions: [{ symbol: "AAA" }] } })],
    ["ideas not an array", (s) => ({ ...s, advisor: { ideas: { EEE: {} } } })],
    ["an idea with no symbol", (s) => ({ ...s, advisor: { ideas: [{ name: "No ticker" }] } })],
  ];
  it.each(bad)("rejects %s", (_name, make) => {
    expect(isPortfolioSnapshot(make(fixture() as unknown as Record<string, unknown>))).toBe(false);
  });
});
