import { describe, expect, it } from "vitest";
import { propsByType } from "./money";

const c = (id: string, nets: number[]) => ({ id, label: id, bets: nets.map((net, i) => ({ game: `g${i}`, week: 1, at: "2026-10-01T00:00:00Z", net })) });

describe("propsByType", () => {
  it("splits edges by prop type with record and units, dropping types with no bets", () => {
    const out = propsByType(
      [c("edge:pts", [0.91, -1, -1])],
      ["pts", "reb"],
      [c("fb:all", [4, -1, -1, -1])],
      [c("edge:rec_yds", [0.91, 0, -1])],
      ["rec_yds"],
      [],
    );
    expect(out.map((t) => [t.label, t.bets, t.w, t.l, t.p, Number(t.units.toFixed(2))])).toEqual([
      ["NFL receiving yards", 3, 1, 1, 1, -0.09],
      ["NBA points", 3, 1, 2, 0, -1.09],
      ["NBA first basket", 4, 1, 3, 0, 1],
    ]);
  });
});
