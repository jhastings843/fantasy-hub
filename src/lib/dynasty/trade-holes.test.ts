import { describe, expect, it } from "vitest";
import type { PlayerRow, TeamSummary } from "./power-rankings";
import { evaluateTrade, findBestTrades } from "./trade-recommender";

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

// Jack's dynasty shape on 2026-10-05: the league's worst QB room, whose one
// real asset is a young QB (Dart), and the worst WR room. The recommender
// offered Dart for a WR because QB was already ranked last, so losing him
// could not move the rank and read as free.
function lastPlaceQbRoom() {
  const other = (n: number) => [
    player(`t${n}-qb`, "QB", 5000 + n), player(`t${n}-wr`, "WR", 2500 + n),
    player(`t${n}-rb`, "RB", 1000), player(`t${n}-te`, "TE", 1000),
  ];
  return league([
    [player("dart", "QB", 3000, 23), player("bagent", "QB", 100), player("my-wr", "WR", 400),
      player("my-rb", "RB", 6000), player("my-te", "TE", 1000)],
    [player("their-qb", "QB", 3200), player("collins", "WR", 3000, 27), player("their-wr2", "WR", 2000),
      player("their-rb", "RB", 1000), player("their-te", "TE", 1000)],
    other(3), other(4), other(5), other(6),
  ]);
}

describe("a room already ranked last", () => {
  it("is not treated as free to empty", () => {
    const teams = lastPlaceQbRoom();
    expect(teams[0].positionRanks.QB).toBe(6);
    const ideas = findBestTrades(teams[0], teams, 6, 100, { youth: true });
    expect(ideas.some((i) => i.send.some((p) => p.id === "dart"))).toBe(false);
  });

  it("is called out as deepening the hole in the analyzer", () => {
    const teams = lastPlaceQbRoom();
    const dart = teams[0].players[0];
    const collins = teams[1].players[1];
    const a = evaluateTrade(
      { myPlayers: [dart], myPicks: [], theirPlayers: [collins], theirPicks: [] },
      teams[0], teams[1], teams, 6, true, new Map(),
    )!;
    expect(a.positionalImpact.find((p) => p.position === "QB")?.holeChange).toBe("deepens");
    expect(a.reasoning.some((r) => r.startsWith("Deepens your QB hole"))).toBe(true);
    expect(["accept", "lean_accept", "even"]).not.toContain(a.verdict);
  });

  it("still lets a scrub leave the room", () => {
    const teams = lastPlaceQbRoom();
    const bagent = teams[0].players[1];
    const wr2 = teams[1].players[2];
    const a = evaluateTrade(
      { myPlayers: [bagent], myPicks: [], theirPlayers: [wr2], theirPicks: [] },
      teams[0], teams[1], teams, 6, true, new Map(),
    )!;
    expect(a.positionalImpact.find((p) => p.position === "QB")?.holeChange).toBe("stays_hole");
  });
});
