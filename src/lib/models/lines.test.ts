import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { american, closeLines, lineCounts, mergeLines, readPropBets, type PropBetRow } from "./lines";
import { isMembersPage } from "@/lib/props/parse";

const fx = (f: string) => JSON.parse(readFileSync(`test/fixtures/models/${f}`, "utf8")) as { items: PropBetRow[] };
const base = { league: "nba" as const, season: 2026, event: "401909834", away: "ATL", home: "ORL" };

describe("american", () => {
  it("reads signed prices and EVEN", () => {
    expect(american("+568")).toBe(568);
    expect(american("-113")).toBe(-113);
    expect(american("EVEN")).toBe(100);
    expect(american(undefined)).toBeNull();
    expect(american("1.88")).toBeNull();
  });
});

describe("readPropBets (ESPN DraftKings, ATL at ORL 2026-10-21)", () => {
  const lines = readPropBets(fx("espn-propbets-nba-401909834.json").items, "nba");
  it("pairs over and under rows, over first", () => {
    // Athlete 6478: Total Points 8.5, rows -113/-113 now, opened +101 / -128.
    const m = lines.get("6478|Total Points")!;
    expect(m.current).toEqual({ line: 8.5, over: -113, under: -113 });
    expect(m.dkOpen).toEqual({ line: 8.5, over: 101, under: -128 });
  });
  it("keeps First Basket as a yes-only price", () => {
    const m = lines.get("2490149|First Basket")!;
    expect(m.current).toEqual({ line: null, over: 568, under: null });
    expect(m.dkOpen.over).toBe(610);
  });
  it("covers the four modeled stats and first basket", () => {
    const types = new Set([...lines.values()].map((l) => l.type));
    for (const t of ["Total Points", "Total Rebounds", "Total Assists", "Total 3-Point Field Goals", "First Basket"]) expect(types.has(t)).toBe(true);
    expect([...lines.values()].filter((l) => l.type === "First Basket").length).toBe(10);
  });
  it("reads NFL lines that carry no prices yet", () => {
    const nfl = readPropBets(fx("espn-propbets-nfl-401873010.json").items, "nfl");
    const rec = [...nfl.values()].filter((l) => l.type === "Total Receiving Yards (incl. overtime)");
    expect(rec.length).toBeGreaterThan(5);
    expect(rec.every((l) => l.current.line !== null && l.current.over === null)).toBe(true);
  });
});

describe("mergeLines", () => {
  const fresh = readPropBets(fx("espn-propbets-nba-401909834.json").items, "nba");
  it("keeps the first snapshot and moves only the last", () => {
    const g1 = mergeLines(undefined, base, fresh, "2026-10-21T16:00:00Z");
    const moved = new Map(fresh);
    const k = "6478|Total Points";
    moved.set(k, { ...fresh.get(k)!, current: { line: 9.5, over: -110, under: -110 } });
    const g2 = mergeLines(g1, base, moved, "2026-10-21T22:45:00Z");
    expect(g2.firstAt).toBe("2026-10-21T16:00:00Z");
    expect(g2.markets[k].first.line).toBe(8.5);
    expect(g2.markets[k].last).toEqual({ line: 9.5, over: -110, under: -110, at: "2026-10-21T22:45:00Z" });
    // Unchanged markets keep their earlier timestamp.
    expect(g2.markets["2490149|First Basket"].last.at).toBe("2026-10-21T16:00:00Z");
    expect(lineCounts(g2).moved).toBe(1);
  });
  it("keeps a market a later read no longer lists", () => {
    const g1 = mergeLines(undefined, base, fresh, "a");
    const g2 = mergeLines(g1, base, new Map(), "b");
    expect(Object.keys(g2.markets).length).toBe(Object.keys(g1.markets).length);
  });
  it("keeps Kalshi's first and latest read", () => {
    const g1 = mergeLines(undefined, base, fresh, "a", [{ name: "X", bid: 0.1, ask: 0.12, last: 0.11 }]);
    const g2 = mergeLines(g1, base, fresh, "b", [{ name: "X", bid: 0.2, ask: 0.22, last: 0.21 }]);
    const g3 = mergeLines(g2, base, fresh, "c");
    expect(g3.kalshi!.first.at).toBe("a");
    expect(g3.kalshi!.last.at).toBe("b");
  });
  it("closes once and never moves the close", () => {
    const g = closeLines(mergeLines(undefined, base, fresh, "a"), "tip");
    expect(closeLines(g, "later").closedAt).toBe("tip");
  });
});

describe("isMembersPage", () => {
  it("spots Sam's members-only props page", () => {
    expect(isMembersPage(readFileSync("test/fixtures/props/nba-props-members.html", "utf8"))).toBe(true);
    expect(isMembersPage(readFileSync("test/fixtures/props/nba-props-0022600001.html", "utf8"))).toBe(false);
  });
});
