import { describe, expect, it } from "vitest";
import { estimatedPublicHome, optimizePool, type PoolGame } from "./pool";

const game = (i: number, pHome: number, publicHome = estimatedPublicHome(pHome)): PoolGame => ({ key: `g${i}`, home: `H${i}`, away: `A${i}`, pHome, publicHome });

describe("pool math", () => {
  it("matches a brute-force simulation of the whole field (ties split evenly)", () => {
    // 4 games, 6 entrants: compare the analytic win share against simulating every opponent.
    const games = [game(0, 0.7), game(1, 0.55), game(2, 0.6), game(3, 0.8)];
    const r = optimizePool(games, 6, { trials: 40000, seed: 7 });
    // Brute force the chalk entry.
    let s = 0;
    let seed = 99;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const T = 60000;
    for (let t = 0; t < T; t++) {
      const won: number[] = games.map((g) => (rnd() < g.pHome ? 1 : 0));
      const mine = won.reduce((a: number, w, g) => a + (w === (games[g].pHome >= 0.5 ? 1 : 0) ? 1 : 0), 0);
      const opp = Array.from({ length: 5 }, () => won.reduce((a: number, w, g) => a + ((rnd() < games[g].publicHome ? 1 : 0) === w ? 1 : 0), 0));
      const top = Math.max(mine, ...opp);
      if (mine === top) s += 1 / (1 + opp.filter((x) => x === top).length);
    }
    expect(Math.abs(r.chalkChance - s / T)).toBeLessThan(0.01);
  });

  it("in a tiny pool, all favorites is the best entry", () => {
    const games = Array.from({ length: 14 }, (_, i) => game(i, 0.55 + (i % 5) * 0.08));
    const r = optimizePool(games, 2, { trials: 8000 });
    expect(r.upsets).toEqual([]);
  });

  it("in a big pool, takes a close underdog the field ignores, not a long shot", () => {
    const games = [
      ...Array.from({ length: 12 }, (_, i) => game(i, 0.72)),
      game(12, 0.52, 0.92), // near coin flip, field piles on the favorite
      game(13, 0.85), // heavy favorite
    ];
    const r = optimizePool(games, 45, { trials: 20000 });
    expect(r.upsets.map((u) => u.key)).toContain("g12");
    expect(r.upsets.map((u) => u.key)).not.toContain("g13");
    expect(r.winChance).toBeGreaterThan(r.chalkChance);
  });

  it("runs a full slate fast enough for a page render", () => {
    const games = Array.from({ length: 16 }, (_, i) => game(i, 0.5 + (i % 8) * 0.05));
    const t0 = Date.now();
    optimizePool(games, 45);
    expect(Date.now() - t0).toBeLessThan(4000);
  });

  it("estimates the field leaning harder to favorites than the market", () => {
    expect(estimatedPublicHome(0.6)).toBeGreaterThan(0.6);
    expect(estimatedPublicHome(0.5)).toBeCloseTo(0.5);
  });
});
