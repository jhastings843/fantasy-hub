import { describe, expect, it } from "vitest";
import { bracketOrder, simulateSeason, type TeamNow } from "./projection";

const t = (rosterId: number, wins = 0, losses = 0): TeamNow => ({ rosterId, wins, losses, ties: 0, pf: 0, alive: true });
const dist = (means: number[]) => Object.fromEntries(means.map((m, i) => [i + 1, { mean: m, sd: 15 }]));

describe("season projection", () => {
  it("bracket order puts 1 and 2 on opposite sides", () => {
    expect(bracketOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
  });

  it("a strong team with a lead makes the playoffs nearly always", () => {
    const weeks = [10, 11, 12, 13].map((week) => ({ week, pairs: [[1, 2], [3, 4]] as [number, number][], dist: dist([140, 100, 110, 105]) }));
    const r = simulateSeason({ format: "h2h", teams: [t(1, 7, 2), t(2, 2, 7), t(3, 5, 4), t(4, 4, 5)], weeks, median: false, playoffTeams: 2, sims: 2000 });
    const one = r.teams.find((x) => x.rosterId === 1)!;
    expect(one.playoffPct).toBeGreaterThan(0.97);
    expect(r.teams[0].rosterId).toBe(1);
    expect(one.wins).toBeGreaterThan(10);
    expect(r.teams.reduce((s, x) => s + x.playoffPct, 0)).toBeCloseTo(2, 5);
    expect(r.teams.reduce((s, x) => s + (x.champPct ?? 0), 0)).toBeCloseTo(1, 5);
  });

  it("no weeks left: standings are final", () => {
    const r = simulateSeason({ format: "h2h", teams: [t(1, 9, 5), t(2, 10, 4)], weeks: [], median: false, playoffTeams: 1, sims: 50 });
    expect(r.teams[0]).toMatchObject({ rosterId: 2, playoffPct: 1, likelyFinish: 1 });
  });

  it("guillotine: the weak team is chopped first, already-chopped teams finish last", () => {
    const teams = [t(1), t(2), t(3), { ...t(4), alive: false, choppedWeek: 9 }];
    const weeks = [10, 11].map((week) => ({ week, pairs: [], dist: dist([150, 120, 60, 0]) }));
    const r = simulateSeason({ format: "guillotine", teams, weeks, median: false, playoffTeams: 0, sims: 1000 });
    const by = new Map(r.teams.map((x) => [x.rosterId, x]));
    expect(by.get(3)!.chopWeek).toBe(10);
    expect(by.get(4)!.likelyFinish).toBe(4);
    expect(by.get(1)!.champPct!).toBeGreaterThan(0.85);
  });
});
