import { describe, expect, it } from "vitest";
import { american, decimal, eligibleAt, kelly, pickParlays, shrunk, sizeAt, stakeFor, wantStakes, worstPrice } from "./staking";

describe("sizing", () => {
  it("pulls a record toward 50% as if it had gone 50-50 over 100 games", () => {
    expect(shrunk(14, 2)).toBeCloseTo(0.5517, 3);
    expect(shrunk(14, 6)).toBeCloseTo(0.5333, 3);
  });
  it("stakes a quarter Kelly at the price, in quarter units from 1 to 5", () => {
    const p = shrunk(14, 2);
    expect(stakeFor(p, -110)).toBe(1.5);
    expect(stakeFor(p, -105)).toBe(2);
    expect(stakeFor(p, 102)).toBe(2.75);
    // 0.57u at -118 is under the 1u minimum: not a bet (a cutoff, not a round-up).
    expect(stakeFor(p, -118)).toBe(0);
    // 14-6 at -118: the price eats the edge.
    expect(stakeFor(shrunk(14, 6), -118)).toBe(0);
    // A long, strong record caps at 5u.
    expect(stakeFor(shrunk(300, 150), 100)).toBe(5);
    expect(kelly(0.5, -110)).toBeLessThan(0);
  });
  it("says the worst price that still earns the 1u minimum", () => {
    expect(worstPrice(shrunk(14, 6))).toBe(-105);
    expect(worstPrice(shrunk(14, 2))).toBe(-114);
  });
});

describe("parlays", () => {
  const leg = (id: string, p: number, price = -110) => ({ id, game: id, p, price });
  it("sends a two-leg parlay only when the pair clears a 10% estimated edge", () => {
    // 14-2 legs clear 10% (10.9%) but an eighth Kelly is 0.5u, under the 1u minimum.
    const thin = shrunk(14, 2);
    expect(pickParlays([leg("a", thin), leg("b", thin)])).toEqual([]);
    const strong = shrunk(20, 2);
    const [pr] = pickParlays([leg("a", strong), leg("b", strong)]);
    expect(pr.edge).toBeCloseTo(0.2, 2);
    expect(pr.units).toBe(1);
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

describe("wants", () => {
  it("never stakes a game with no quoted price, and says so", () => {
    const [g] = wantStakes([{ tier: "t1", basis: "reference", side: "home" as const, ref: { awayPrice: -110 } }], { t1: { w: 14, l: 2 } });
    expect(g).toMatchObject({ priceSource: "missing", want: 0 });
    expect(g.price).toBeUndefined();
  });
  it("sizes a flat policy the same on every bet with a positive estimated edge", () => {
    const flat = { kind: "flat" as const, kellyScale: 0.25, priorGames: 100, flatUnits: 1 };
    expect(stakeFor(shrunk(14, 2), -110, flat)).toBe(1);
    expect(stakeFor(shrunk(10, 12), -110, flat)).toBe(0);
  });
});

describe("bet/pass is decided apart from sizing", () => {
  const flat = { kind: "flat" as const, kellyScale: 0.25, priorGames: 100, flatUnits: 1 };
  const eighth = { kind: "kelly" as const, kellyScale: 0.125, priorGames: 100, flatUnits: 1 };
  // The live college Tier 1 on 2026-10-10: 28-14, read as 54.9%.
  const t1 = { w: 28, l: 14 };

  it("the baseline policy bets exactly what it did before the split", () => {
    for (const rec of [t1, { w: 14, l: 2 }, { w: 8, l: 6 }, { w: 300, l: 150 }]) {
      for (let price = -125; price <= 110; price += 1) {
        if (price > -100 && price < 100) continue;
        const was = stakeFor(shrunk(rec.w, rec.l), price);
        expect(sizeAt(rec, price).want).toBe(was);
        expect(eligibleAt(rec, price)).toBe(was > 0);
      }
    }
  });
  it("flat 1u sizes only eligible picks: a priced-out pick stays a pass", () => {
    // -115: positive estimated edge, but quarter Kelly sizes it under 1u.
    expect(kelly(shrunk(28, 14), -115)).toBeGreaterThan(0);
    expect(sizeAt(t1, -115, flat)).toMatchObject({ eligible: false, want: 0 });
    // The same pick at -110 is eligible, and flat gives it 1u, not 1.25u.
    expect(sizeAt(t1, -110, flat)).toMatchObject({ eligible: true, want: 1 });
    expect(sizeAt(t1, -110).want).toBe(1.25);
  });
  it("a smaller policy can size an eligible pick under 1u: still eligible, not rounded up", () => {
    expect(sizeAt(t1, -110, eighth)).toMatchObject({ eligible: true, want: 0 });
  });
  it("a review-activated cut bets at most 1u, whatever its record says", () => {
    expect(sizeAt({ ...t1, activated: true }, 105).want).toBe(1);
    expect(sizeAt(t1, 105).want).toBe(3);
    expect(sizeAt({ ...t1, activated: true }, -115).want).toBe(0);
  });
  it("wantStakes marks eligibility on the board", () => {
    const g = (price: number) => ({ tier: "t1", basis: "reference", side: "home" as const, ref: { homePrice: price } });
    const [a, b] = wantStakes([g(-110), g(-115)], { t1 }, flat);
    expect(a).toMatchObject({ eligible: true, want: 1, price: -110 });
    expect(b).toMatchObject({ eligible: false, want: 0, price: -115 });
  });
});
