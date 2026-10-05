import { describe, expect, it } from "vitest";
import type { PlayerRow, TeamSummary } from "./power-rankings";
import { evaluateTrade, findBestTrades, suggestLevelers } from "./trade-recommender";
import { suggestTradeFits } from "./trade-fits";
import { DAH_DYNASTY_LEAGUE_ID, markUntouchables, untouchableNote } from "./untouchables";

const GIBBS = "9221";

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
  return teams as TeamSummary[];
}

describe("markUntouchables", () => {
  it("flags Gibbs on Jack's dynasty roster only", () => {
    const teams = league([[player(GIBBS, "RB", 10000)], [player(GIBBS, "RB", 10000)]]);
    markUntouchables(teams, DAH_DYNASTY_LEAGUE_ID, 1);
    expect(teams[0].players[0].untouchable).toBe(true);
    expect(teams[1].players[0].untouchable).toBeFalsy();
  });

  it("leaves other leagues alone", () => {
    const teams = league([[player(GIBBS, "RB", 10000)]]);
    markUntouchables(teams, "some-redraft-league", 1);
    expect(teams[0].players[0].untouchable).toBeFalsy();
  });
});

describe("recommenders never offer an untouchable", () => {
  it("best trades skip him even when he is the obvious send", () => {
    const teams = league([
      [player("a", "WR", 1000), player("b", "WR", 1000), player("reserve", "WR", 5000)],
      [player("target", "RB", 2000), player("depth", "RB", 5000)],
      [player("c-wr", "WR", 1500), player("c-rb", "RB", 1500)],
      [player("d-wr", "WR", 500), player("d-rb", "RB", 500)],
    ]);
    const baseline = findBestTrades(teams[0], teams, 4, 100);
    expect(baseline.some((i) => i.send.some((p) => p.id === "a"))).toBe(true);

    teams[0].players[0].untouchable = true;
    const ideas = findBestTrades(teams[0], teams, 4, 100);
    expect(ideas.some((i) => i.send.some((p) => p.id === "a"))).toBe(false);
  });

  it("youth swaps skip an untouchable aging star", () => {
    const teams = league([
      [player("old-star", "WR", 3000, 30), player("my-rb", "RB", 500), player("my-qb", "QB", 500), player("my-te", "TE", 500)],
      [player("young", "WR", 2950, 22), player("b-wr2", "WR", 500), player("b-rb", "RB", 2000), player("b-qb", "QB", 2000), player("b-te", "TE", 2000)],
      [player("c-wr", "WR", 4000), player("c-rb", "RB", 1000), player("c-qb", "QB", 1000), player("c-te", "TE", 1000)],
      [player("d-wr", "WR", 3500), player("d-rb", "RB", 800), player("d-qb", "QB", 800), player("d-te", "TE", 800)],
    ]);
    teams[0].players[0].untouchable = true;
    const ideas = findBestTrades(teams[0], teams, 4, 6, { youth: true });
    expect(ideas.some((i) => i.send.some((p) => p.id === "old-star"))).toBe(false);
  });

  it("levelers never ask you to add him", () => {
    const teams = league([
      [player(GIBBS, "RB", 10000), player("filler", "WR", 900)],
      [player("star", "WR", 3000)],
    ]);
    teams[0].players[0].untouchable = true;
    const options = suggestLevelers({
      myTeam: teams[0], partnerTeam: teams[1],
      mySelectedIds: new Set(["filler"]), theirSelectedIds: new Set(["star"]),
      delta: 2100, picks: [], selectedPickIds: new Set(), isSuperflex: true, myWeakPositions: [],
    });
    expect(options.some((o) => o.player?.id === GIBBS)).toBe(false);
  });

  it("trade fits never list him as a send", () => {
    const rbRoom = [player(GIBBS, "RB", 9000), player("rb2", "RB", 800), player("rb3", "RB", 700), player("rb4", "RB", 600), player("rb5", "RB", 500)];
    const teams = league([
      rbRoom,
      [player("x-rb", "RB", 100), player("x-wr", "WR", 5000)],
      [player("y-rb", "RB", 200)],
      [player("z-rb", "RB", 300)],
    ]);
    teams[0].players[0].untouchable = true;
    const fits = suggestTradeFits(teams[0], teams[1], 4);
    const sends = fits.filter((f) => f.side === "send").flatMap((f) => f.suggested);
    expect(sends.length).toBeGreaterThan(0);
    expect(sends.some((p) => p.id === GIBBS)).toBe(false);
  });
});

describe("evaluating a trade that includes him", () => {
  it("declines and says why, first", () => {
    const teams = league([
      [{ ...player(GIBBS, "RB", 10000), name: "Jahmyr Gibbs", untouchable: true }],
      [player("haul", "WR", 15000)],
    ]);
    const a = evaluateTrade(
      { myPlayers: [teams[0].players[0]], myPicks: [], theirPlayers: [teams[1].players[0]], theirPicks: [] },
      teams[0], teams[1], teams, 2, true, new Map(),
    )!;
    expect(a.verdict).toBe("decline");
    expect(a.reasoning[0]).toBe(untouchableNote([teams[0].players[0]]));
    expect(a.reasoning[0]).toContain("Jahmyr Gibbs");
  });
});
