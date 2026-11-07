import { describe, expect, it } from "vitest";
import type { PlayerRow, TeamSummary } from "./power-rankings";
import { findBestTrades } from "./trade-recommender";
import type { TradePlan } from "./trade-plan";

function player(id: string, position: string, value: number, age = 25): PlayerRow {
  return { id, name: id, position, value, age, team: null, overallRank: 0, positionRank: 0 };
}

function league(rosters: PlayerRow[][]): TeamSummary[] {
  const teams = rosters.map((players, i) => ({
    rosterId: i + 1, ownerName: `Team ${i + 1}`, players,
    totalValue: players.reduce((sum, p) => sum + p.value, 0),
    positionTotals: Object.fromEntries(["QB", "RB", "WR", "TE"].map((pos) =>
      [pos, players.filter((p) => p.position === pos).reduce((sum, p) => sum + p.value, 0)])),
    positionRanks: {} as Record<string, number>,
  }));
  for (const team of teams) {
    for (const pos of ["QB", "RB", "WR", "TE"]) {
      team.positionRanks[pos] = 1 + teams.filter((other) => other.positionTotals[pos] > team.positionTotals[pos]).length;
    }
  }
  return teams;
}

function plan(over: Partial<TradePlan>): TradePlan {
  return { stance: "balanced", stanceFrom: "trajectory", trajectory: null, stanceGoal: null, focus: [], shed: [], keep: [], ...over };
}

// I have an aging RB star and a thin WR room; the league has young WRs.
function fixture() {
  return league([
    [player("vet-rb", "RB", 3000, 29), player("my-rb2", "RB", 2500, 25), player("my-wr", "WR", 300, 26), player("my-te", "TE", 900, 27)],
    [player("kid-wr", "WR", 2900, 22), player("p2-wr2", "WR", 2000, 26), player("p2-rb", "RB", 400, 25)],
    [player("w3", "WR", 4000, 26), player("r3", "RB", 500, 25)],
    [player("w4", "WR", 3500, 25), player("r4", "RB", 600, 25)],
    [player("w5", "WR", 3200, 27), player("r5", "RB", 700, 25)],
  ]);
}

describe("trade ideas follow the season plan", () => {
  it("offers sell-the-vet ideas when balanced", () => {
    const teams = fixture();
    const ideas = findBestTrades(teams[0], teams, 5, 100, { youth: true, plan: plan({}) });
    expect(ideas.some((i) => i.kind === "youth_arbitrage")).toBe(true);
  });

  it("drops sell-the-vet ideas for a win-now team", () => {
    const teams = fixture();
    const ideas = findBestTrades(teams[0], teams, 5, 100, { youth: true, plan: plan({ stance: "win_now" }) });
    expect(ideas.some((i) => i.kind === "youth_arbitrage")).toBe(false);
  });

  it("ranks sell-the-vet ideas higher in a build", () => {
    const teams = fixture();
    const base = findBestTrades(teams[0], teams, 5, 100, { youth: true, plan: plan({}) }).find((i) => i.kind === "youth_arbitrage");
    const built = findBestTrades(teams[0], teams, 5, 100, { youth: true, plan: plan({ stance: "build" }) }).find((i) => i.kind === "youth_arbitrage");
    expect(built!.score).toBeGreaterThan(base!.score);
    expect(built!.planReasons).toContain("Fits the build: younger player back");
  });

  it("treats a goal's position as a need and says so", () => {
    const teams = fixture();
    const ideas = findBestTrades(teams[0], teams, 5, 100, {
      youth: false,
      plan: plan({ stance: "win_now", focus: [{ position: "WR", goal: "Get a WR1" }] }),
    });
    const wr = ideas.find((i) => i.kind === "position_fit" && i.positionalGain.position === "WR");
    expect(wr?.planReasons).toContain('Your goal: "Get a WR1"');
  });

  it("is unchanged with no plan", () => {
    const teams = fixture();
    const a = findBestTrades(teams[0], teams, 5, 100, { youth: true });
    const b = findBestTrades(teams[0], teams, 5, 100, { youth: true, plan: null });
    expect(a.map((i) => i.score)).toEqual(b.map((i) => i.score));
  });
});
