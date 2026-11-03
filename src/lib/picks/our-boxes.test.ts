import { describe, expect, it } from "vitest";
import { ourBoxes, edgePerUnit } from "./our-boxes";
import { shrunk } from "./staking";

describe("ourBoxes", () => {
  it("pulls the record toward 50% and prices it at the posted price", () => {
    const b = ourBoxes({ record: { w: 45, l: 39 }, price: -105, priorGames: 100 });
    expect(b.p).toBeCloseTo((45 + 50) / (84 + 100), 6);
    expect(b.edgePct).toBeCloseTo((b.p! * (1 + 100 / 105) - 1) * 100, 6);
    expect(b.assumed).toBe(false);
    expect(b.price).toBe(-105);
  });

  it("has no chance or edge with no graded games", () => {
    const b = ourBoxes({ record: { w: 0, l: 0 }, price: -110 });
    expect(b.p).toBeNull();
    expect(b.edgePct).toBeNull();
    expect(ourBoxes({ record: null }).p).toBeNull();
  });

  it("assumes -110 with no price, except where told not to (straight up)", () => {
    const b = ourBoxes({ record: { w: 10, l: 5 } });
    expect(b.assumed).toBe(true);
    expect(b.price).toBe(-110);
    expect(b.edgePct).toBeCloseTo(edgePerUnit(shrunk(10, 5), -110), 6);
    const su = ourBoxes({ record: { w: 10, l: 5 }, assume: false });
    expect(su.p).not.toBeNull();
    expect(su.edgePct).toBeNull();
    expect(su.assumed).toBe(false);
  });
});
