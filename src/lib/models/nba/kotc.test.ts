import { describe, expect, it } from "vitest";
import { kingLogLoss, kingsOf, simulateSlate, type KotcGame, type KotcParams, type KotcPlayer } from "./kotc";
import KP from "./kotc-params.json";

const P = { ...(KP as KotcParams), sims: 4000 };
const games: KotcGame[] = [
  { id: "g1", home: "LAL", away: "GS", homeSpread: -6.5 },
  { id: "g2", home: "HOU", away: "DAL", homeSpread: -9.5 },
];
const pl = (id: string, game: string, pra: number, starter = true): KotcPlayer => ({ id, name: id, team: game === "g1" ? "LAL" : "HOU", game, min: 32, pra, starter });

describe("simulateSlate", () => {
  const players = [pl("star", "g1", 45), pl("b", "g1", 33), pl("c", "g2", 33), pl("d", "g2", 20, false)];
  const b = simulateSlate(games, players, P, 1);

  it("chances sum to 1, ties split", () => {
    expect(b.rows.reduce((a, r) => a + r.p, 0)).toBeCloseTo(1, 6);
  });

  it("the biggest projection leads, equal projections land close", () => {
    expect(b.rows[0].id).toBe("star");
    expect(b.rows[0].p).toBeGreaterThan(0.5);
    const [x, y] = ["b", "c"].map((id) => b.rows.find((r) => r.id === id)!.p);
    expect(Math.abs(x - y)).toBeLessThan(0.04);
  });

  it("is reproducible with a seed and top 3 is at least the win chance", () => {
    expect(simulateSlate(games, players, P, 1).rows.map((r) => r.p)).toEqual(b.rows.map((r) => r.p));
    for (const r of b.rows) expect(r.top3).toBeGreaterThanOrEqual(r.p);
  });

  it("skips players whose game isn't on the slate", () => {
    expect(simulateSlate(games, [...players, pl("ghost", "g9", 60)], P, 1).rows.some((r) => r.id === "ghost")).toBe(false);
  });
});

describe("kings and log loss", () => {
  it("finds every tied leader", () => {
    expect(kingsOf([{ id: "a", pra: 50 }, { id: "b", pra: 50 }, { id: "c", pra: 41 }])).toEqual({ ids: ["a", "b"], pra: 50 });
  });
  it("scores the chance given to the king, floored", () => {
    expect(kingLogLoss([{ id: "a", p: 0.25 }], ["a"])).toBeCloseTo(-Math.log(0.25));
    expect(kingLogLoss([{ id: "a", p: 0.25 }], ["z"])).toBeCloseTo(-Math.log(1e-4));
  });
});
