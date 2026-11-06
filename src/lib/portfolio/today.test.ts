import { describe, expect, it } from "vitest";
import { etDate, todayMoves } from "./today";
import type { PortfolioSnapshot } from "./types";

const base = {
  version: 1,
  asOf: "2026-01-12T23:00:00+00:00",
  totals: { total: 1000, dayChange: 0, dayChangePct: 0, cash: 100, cashPct: 10 },
  holdings: [],
} as unknown as PortfolioSnapshot;

const snap = (over: Partial<PortfolioSnapshot>): PortfolioSnapshot => ({ ...base, ...over }) as PortfolioSnapshot;

describe("todayMoves", () => {
  it("is empty with no snapshot or nothing due", () => {
    expect(todayMoves(null, "2026-01-13")).toEqual([]);
    expect(todayMoves(base, "2026-01-13")).toEqual([]);
  });

  it("takes sells, buys and limits dated today, not deadlines, waits or holds", () => {
    const s = snap({
      advisor: {
        actions: [
          { kind: "sell", symbol: "AAA", amount: 50, when: "2026-01-13", reason: "r" },
          { kind: "buy", symbol: "BBB", amount: 70, when: "2026-01-14", reason: "r" },
          { kind: "limit", symbol: "CCC", amount: 20, when: "by 2026-01-13", reason: "r" },
          { kind: "wait", symbol: "DDD", when: "2026-01-13", reason: "r" },
          { kind: "hold", symbol: "EEE", reason: "r" },
        ],
      },
    } as Partial<PortfolioSnapshot>);
    expect(todayMoves(s, "2026-01-13").map((m) => m.symbol)).toEqual(["AAA"]);
  });

  it("flags a hit trigger and a backstop landing today, not one that passed", () => {
    const s = snap({
      cashPlan: [
        { label: "T2", amount: 10, buy: "VOO", trigger_spx: 5000, backstop: "2026-02-01", status: "trigger hit" },
        { label: "T3", amount: 20, buy: "VOO", trigger_spx: null, backstop: "2026-01-13", status: "backstop due" },
        { label: "T4", amount: 30, buy: "VOO", trigger_spx: null, backstop: "2026-01-02", status: "backstop due" },
      ],
    } as Partial<PortfolioSnapshot>);
    expect(todayMoves(s, "2026-01-13").map((m) => m.detail)).toEqual(["T2", "T3"]);
  });

  it("includes ready ideas only", () => {
    const s = snap({ advisor: { ideas: [{ symbol: "XYZ", status: "ready", size: 5 }, { symbol: "QRS", status: "watching" }] } } as Partial<PortfolioSnapshot>);
    expect(todayMoves(s, "2026-01-13").map((m) => [m.kind, m.symbol])).toEqual([["idea", "XYZ"]]);
  });
});

describe("etDate", () => {
  it("uses the Eastern day", () => {
    expect(etDate(new Date("2026-01-14T03:00:00Z"))).toBe("2026-01-13");
  });
});
