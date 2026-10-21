import { describe, expect, it } from "vitest";
import { entryRecords, estimatedPublicHome, gradeTeams, tiebreakTotal,
  optimizeStandings, optimizePool, type PoolGame } from "./pool";

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

describe("entryRecords", () => {
  it("keys each game AWAY@HOME in Sleeper's spelling and names the picked team", () => {
    const canon = (x: string) => ({ WSH: "WAS", LA: "LAR" })[x] ?? x;
    const out = entryRecords(
      [
        { home: "NYJ", away: "CLE" },
        { home: "WSH", away: "LA" },
      ],
      ["home", "away"],
      "2026-10-11T16:50:00Z",
      canon,
    );
    expect(out).toEqual({
      "CLE@NYJ": { team: "NYJ", at: "2026-10-11T16:50:00Z" },
      "LAR@WAS": { team: "LAR", at: "2026-10-11T16:50:00Z" },
    });
  });
});

describe("gradeTeams", () => {
  it("grades picked teams on finished games only, skipping ties and unpicked games", () => {
    const id = (x: string) => x;
    const picks = new Map([[6, new Set(["NYJ", "IND", "TB"])]]);
    const games = [
      { week: 6, home: "NYJ", away: "CLE", completed: true, homeScore: 17, awayScore: 12 },
      { week: 6, home: "IND", away: "PIT", completed: true, homeScore: 20, awayScore: 24 },
      { week: 6, home: "TB", away: "DAL", completed: false, homeScore: null, awayScore: null },
      { week: 6, home: "KC", away: "LV", completed: true, homeScore: 30, awayScore: 10 },
      { week: 6, home: "SF", away: "SEA", completed: true, homeScore: 20, awayScore: 20 },
    ];
    expect(gradeTeams(picks, games, id)).toEqual([{ week: 6, w: 1, l: 1, graded: 2, played: 3 }]);
  });
});

describe("optimizeStandings", () => {
  const g = (pHome: number, extra: object = {}) => ({ key: "BUF@LAR", home: "LAR", away: "BUF", pHome, publicHome: 0.5, ...extra });

  it("takes the favorite when one rival is tied and picked the underdog", () => {
    const r = optimizeStandings([g(0.6)], 9, [{ base: 9, picks: ["away"] }], { trials: 4000 });
    expect(r.picks).toEqual(["home"]);
    expect(r.winChance).toBeCloseTo(0.6, 1);
  });

  it("must differ from the leader when one point behind", () => {
    // Leader is 10 on the favorite; matching them can never win. The dog
    // (30%) ties them at 10 and splits the tiebreaker: about 15%.
    const r = optimizeStandings([g(0.7)], 9, [{ base: 10, picks: ["home"] }], { trials: 4000 });
    expect(r.picks).toEqual(["away"]);
    expect(r.chalkChance).toBe(0);
    expect(r.winChance).toBeCloseTo(0.15, 1);
  });

  it("is already decided when two clear and one game left", () => {
    const r = optimizeStandings([g(0.5)], 11, [{ base: 9, picks: ["home"] }], { trials: 1000 });
    expect(r.winChance).toBe(1);
  });

  it("never flips a started game; it keeps Jack's locked pick", () => {
    const games = [g(0.9, { locked: true, mine: "away" }), { ...g(0.6), key: "X@Y", home: "Y", away: "X" }];
    const r = optimizeStandings(games, 5, [{ base: 5, picks: ["home", "home"] }], { trials: 4000 });
    expect(r.picks[0]).toBe("away");
    expect(r.upsets.map((u) => u.key)).not.toContain("BUF@LAR");
  });
});

describe("tiebreakTotal", () => {
  it("averages Sam and David and keeps the market beside it", () => {
    // Week 7 Monday night, DAL at PHI: Sam 48.3, David 45, market 44.5.
    expect(tiebreakTotal({ sam: 48.3, david: 45 }, 44.5)).toEqual({ total: 47, basis: "models", sam: 48.3, david: 45, market: 44.5 });
  });
  it("falls back to one model, then the market", () => {
    expect(tiebreakTotal({ sam: 50 }, 44.5)?.basis).toBe("sam");
    expect(tiebreakTotal({ david: 41.6 }, null)).toEqual({ total: 42, basis: "david", david: 41.6, market: undefined });
    expect(tiebreakTotal(null, 44.5)).toEqual({ total: 45, basis: "market", market: 44.5 });
    expect(tiebreakTotal(null, null)).toBeNull();
  });
});
