import { describe, expect, it } from "vitest";
import { WEEKLY_CAP, american, decimal, kelly, pickParlays, shrunk, stakeBoard, stakeFor, worstPrice } from "./staking";

describe("sizing", () => {
  it("pulls a record toward 50% as if it had gone 50-50 over 100 games", () => {
    expect(shrunk(14, 2)).toBeCloseTo(0.5517, 3);
    expect(shrunk(14, 6)).toBeCloseTo(0.5333, 3);
  });
  it("stakes a quarter Kelly at the price, in quarter units from 0.25 to 5", () => {
    const p = shrunk(14, 2);
    expect(stakeFor(p, -110)).toBe(1.5);
    expect(stakeFor(p, -105)).toBe(2);
    expect(stakeFor(p, 102)).toBe(2.75);
    expect(stakeFor(p, -118)).toBe(0.5);
    // 14-6 at -118: the price eats the edge.
    expect(stakeFor(shrunk(14, 6), -118)).toBe(0);
    // A long, strong record caps at 5u.
    expect(stakeFor(shrunk(300, 150), 100)).toBe(5);
    expect(kelly(0.5, -110)).toBeLessThan(0);
  });
  it("says the worst price that still earns a quarter unit", () => {
    expect(worstPrice(shrunk(14, 6))).toBe(-112);
  });
});

describe("parlays", () => {
  const leg = (id: string, p: number, price = -110) => ({ id, game: id, p, price });
  it("sends a two-leg parlay only when the pair clears a 10% estimated edge", () => {
    const strong = shrunk(14, 2);
    const [pr] = pickParlays([leg("a", strong), leg("b", strong)]);
    expect(pr.edge).toBeCloseTo(0.109, 2);
    // An eighth Kelly: 0.5u.
    expect(pr.units).toBe(0.5);
    expect(american(pr.decimal)).toBe("+264");
    const weak = shrunk(14, 6);
    expect(pickParlays([leg("a", weak), leg("b", weak)])).toEqual([]);
  });
  it("never pairs two bets on one game and uses each leg once", () => {
    const p = shrunk(20, 2);
    expect(pickParlays([{ id: "a", game: "g1", p, price: -110 }, { id: "b", game: "g1", p, price: -110 }])).toEqual([]);
    const out = pickParlays(["a", "b", "c", "d", "e"].map((x) => leg(x, p)));
    expect(out).toHaveLength(2);
    expect(new Set(out.flatMap((x) => x.legs.map((l) => l.id))).size).toBe(4);
  });
  it("converts odds", () => {
    expect(decimal(-110)).toBeCloseTo(1.9091, 3);
    expect(american(2.2)).toBe("+120");
  });
});

describe("weekly cap", () => {
  it("scales a heavy week down so singles and parlays stay within the cap", () => {
    const ref = { homePrice: -105, awayPrice: -105 };
    const games = Array.from({ length: 12 }, (_, i) => ({ home: `H${i}`, away: `A${i}`, tier: "t1", basis: "reference", side: "home" as const, ref }));
    const { board, parlays } = stakeBoard(games, { t1: { w: 14, l: 2 } }, 6);
    const singles = board.reduce((t, g) => t + (g.stake ?? 0), 0);
    expect(singles).toBeLessThanOrEqual(WEEKLY_CAP * 0.8);
    expect(board.every((g) => (g.stake ?? 0) >= 0.25)).toBe(true);
    expect(singles + parlays.reduce((t, p) => t + p.units, 0)).toBeLessThanOrEqual(WEEKLY_CAP);
  });
});
