import { describe, expect, it } from "vitest";
import { bp, reboundRead, reboundToday, shadowLanes } from "./rebound";
import type { VwapRebound, VwapReboundRow, VwapShadow } from "./types";

const row = (x: Partial<VwapReboundRow>): VwapReboundRow => ({
  day: "2026-11-16", symbol: "QQQ", setup: 1, setup_note: null, state: "waiting", why: null, signal_time: null,
  entry_time: null, entry: null, exit_time: null, exit: null, how: null, shares: null, pnl: null, bp: null,
  seen_entry_at: null, seen_exit_at: null, ...x,
});
const book = (n: number, meanBp: number | null): VwapRebound => ({
  book: "vwap-rebound", start: 100000, equity: 100000, symbols: ["QQQ"], record: { n, meanBp, hit: null, t: null },
  curve: [], setupDays: 0, days: 0, recent: [], rules: "x",
  backtest: { source: "x", symbol: "QQQ", n: 105, hit: 0.85, pf: 3.42, meanBp: 21.83, t: 4.54, firstHalfT: 1.34, secondHalfT: 5.87, worstBp: -326.1 },
});

describe("bp", () => {
  it("signs the number", () => {
    expect(bp(21.83)).toBe("+21.8bp");
    expect(bp(-3)).toBe("-3.0bp");
  });
});

describe("reboundToday", () => {
  it("handles no session, no setup, an open trade and a closed one", () => {
    expect(reboundToday(undefined).chip).toBe("No session yet");
    expect(reboundToday(row({ state: "no-setup", setup: 0, setup_note: "yesterday RSI(5) 46.5" })).text).toContain("RSI(5) 46.5");
    expect(reboundToday(row({ state: "open", entry: 600.5, shares: 166 })).tone).toBe("live");
    const won = reboundToday(row({ state: "closed", entry: 600, exit: 601.2, bp: 19.5, how: "vwap" }));
    expect(won).toMatchObject({ chip: "Won", tone: "win" });
    expect(won.text).toContain("back above VWAP");
    expect(reboundToday(row({ state: "closed", bp: -40, how: "close" })).tone).toBe("loss");
  });
});

describe("reboundRead", () => {
  it("says too early under 20 trades", () => expect(reboundRead(book(3, 10))).toMatch(/^3 live trades/));
  it("compares the live average once there are 20", () => {
    expect(reboundRead(book(25, 15))).toMatch(/^Holding up/);
    expect(reboundRead(book(25, 2))).toMatch(/^Falling short/);
  });
});

describe("shadowLanes", () => {
  it("lists pooled lanes in order and skips per-ticker ones", () => {
    const d: VwapShadow = { name: "x", verdict: "collecting", days: 4, bar: "x", lanes: {
      cross3m: { n: 6, meanBp: 1, hit: 0.5, t: 0.2 }, ema: { n: 10, meanBp: 5, hit: 0.4, t: 0.55 },
      "ema:SPY": { n: 5, meanBp: 6, hit: 0.4, t: 0.7 }, cross: { n: 8, meanBp: 4.9, hit: 0.62, t: 0.57 } } };
    expect(shadowLanes(d).map((l) => l.key)).toEqual(["ema", "cross", "cross3m"]);
  });
});
