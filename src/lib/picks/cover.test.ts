import { describe, expect, it } from "vitest";
import type { BoardGame, StrategyBoard } from "./engine";
import { coverRead } from "./cover";
import { shrunk } from "./staking";

const rec = (w: number, l: number) => ({ w, l, p: 0, pct: w / (w + l), units: 0, lo: 0, hi: 0 });
const st = {
  cuts: [{ id: "agree", label: "Both agree, any edge", record: rec(86, 76) }],
  splits: { sam: rec(57, 64), david: rec(63, 56) },
  rule: { label: "Near Vegas", record: rec(36, 22) },
  second: null,
} as unknown as StrategyBoard;
const read = (agree: boolean) => ({ agree, side: agree ? "home" : undefined, samSide: "away", davidSide: "home", avgEdge: 2, avgModel: -5, avgMarket: -3 });
const ref = { line: -3, homePrice: -110, awayPrice: -110 };

describe("coverRead", () => {
  it("tiered game keeps its tier p and price", () => {
    const g = { read: read(true), tier: "t1", side: "home", p: 0.56, price: 100, ref } as unknown as BoardGame;
    const c = coverRead(g, st)!;
    expect(c.p).toBe(0.56);
    expect(c.tier).toBe("t1");
    expect(c.edgePct).toBeCloseTo(12, 5);
  });
  it("agree outside the tiers borrows Both agree, any edge", () => {
    const c = coverRead({ read: read(true), ref } as unknown as BoardGame, st)!;
    expect(c.label).toBe("Both agree, any edge");
    expect(c.p).toBe(shrunk(86, 76));
    expect(c.side).toBe("home");
    expect(c.edgePct).toBeDefined();
  });
  it("split takes the model with the better split record", () => {
    const c = coverRead({ read: read(false), ref } as unknown as BoardGame, st)!;
    expect(c.label).toBe("David's side when they split");
    expect(c.side).toBe("home");
  });
  it("no read, no number", () => {
    expect(coverRead({ ref } as unknown as BoardGame, st)).toBeNull();
  });
});
