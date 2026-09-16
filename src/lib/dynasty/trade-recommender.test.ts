import { describe, expect, it } from "vitest";
import type { PlayerRow, TeamSummary } from "./power-rankings";
import { evaluateTrade, findBestTrades, findLeagueWideMatches, packageKey, scoreSideFor } from "./trade-recommender";

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

function fixture() {
  return league([
    [player("a", "WR", 1000), player("b", "WR", 1000), player("reserve", "WR", 5000)],
    [player("target", "RB", 2000), player("depth", "RB", 5000)],
    [player("c-wr", "WR", 1500), player("c-rb", "RB", 1500)],
    [player("d-wr", "WR", 500), player("d-rb", "RB", 500)],
  ]);
}

function matches(teams: TeamSummary[], ids = ["a", "b"]) {
  const myTeam = teams[0];
  return findLeagueWideMatches({ myTeam, allTeams: teams, mySendPlayerIds: new Set(ids),
    mySendValue: myTeam.players.filter((p) => ids.includes(p.id)).reduce((sum, p) => sum + p.value, 0),
    weakestPositions: ["RB"], limit: 100 });
}

describe("bilateral trade recommendations", () => {
  it("has antisymmetric value percentages with sides swapped", () => {
    const teams = fixture();
    const giving = [teams[0].players[0]];
    const receiving = [teams[1].players[0]];
    const mine = scoreSideFor(teams[0], teams, giving, receiving, 12);
    const theirs = scoreSideFor(teams[1], teams, receiving, giving, 12);
    expect(mine.pctDelta).toBe(-theirs.pctDelta);
    expect(mine.pctDelta).toBe(0.5);
  });

  it("generates a 2-for-1 where neither single send reaches parity", () => {
    const teams = fixture();
    const ideas = findBestTrades(teams[0], teams, 4, 100);
    const idea = ideas.find((i) => packageKey(i.send) === "a,b" && packageKey(i.receive) === "target");
    expect(idea).toBeDefined();
    expect(idea?.mutual).toBe(true);
    expect(ideas.some((i) => i.send.length === 1 && i.receive[0].id === "target")).toBe(false);
    expect(matches(teams).some((m) => packageKey(m.receivePlayers) === "target")).toBe(true);
  });

  it("generates 1-for-2 and 2-for-2 packages", () => {
    const teams = fixture();
    teams[1].players.splice(0, 1, player("r1", "RB", 1000), player("r2", "RB", 1000));
    const rebuilt = league(teams.map((t) => t.players));
    expect(matches(rebuilt).some((m) => packageKey(m.receivePlayers) === "r1,r2")).toBe(true);
    expect(findBestTrades(rebuilt[0], rebuilt, 4, 100).some((i) => i.send.length === 2 && i.receive.length === 2)).toBe(true);
    const single = league([ [player("single", "WR", 2000), player("reserve", "WR", 5000)], ...rebuilt.slice(1).map((t) => t.players) ]);
    expect(findBestTrades(single[0], single, 4, 100).some((i) => i.send.length === 1 && packageKey(i.receive) === "r1,r2")).toBe(true);
  });

  it("excludes a proposal that the partner would decline", () => {
    const teams = league([
      [player("give", "WR", 2000), player("reserve", "WR", 5000)],
      [player("bad", "RB", 2000), player("their-wr", "WR", 8000)],
      [player("c-rb", "RB", 1500)], [player("d-rb", "RB", 500)],
    ]);
    const assessment = evaluateTrade({ myPlayers: [teams[0].players[0]], theirPlayers: [teams[1].players[0]], myPicks: [], theirPicks: [] }, teams[0], teams[1], teams, 4, false, new Map());
    expect(assessment?.partner.verdict).toBe("decline");
    expect(assessment?.mutual).toBe(false);
    expect(matches(teams, ["give"]).some((m) => m.partnerRosterId === 2)).toBe(false);
    expect(findBestTrades(teams[0], teams, 4, 100).some((i) => packageKey(i.receive) === "bad")).toBe(false);
  });

  it("ranks an equal-value deal higher when it fills the partner's weakest room", () => {
    const teams = league([
      [player("give", "WR", 2000), player("reserve", "WR", 8000)],
      [player("fit", "RB", 2000), player("fit-reserve", "RB", 13000)],
      [player("neutral", "RB", 2000), player("neutral-reserve", "RB", 8000), player("neutral-wr", "WR", 7000)],
      [player("d-wr", "WR", 1000), player("d-rb", "RB", 1000)],
    ]);
    const found = matches(teams, ["give"]);
    const fit = found.find((m) => packageKey(m.receivePlayers) === "fit");
    const neutral = found.find((m) => packageKey(m.receivePlayers) === "neutral");
    expect(fit).toBeDefined();
    expect(neutral).toBeDefined();
    expect(fit!.mutualScore).toBeGreaterThan(neutral!.mutualScore);
    expect(found.indexOf(fit!)).toBeLessThan(found.indexOf(neutral!));
  });

  it("keeps existing 1-for-1 ideas", () => {
    const teams = fixture();
    teams[0].players[0].value = 2000;
    const rebuilt = league(teams.map((t) => t.players));
    expect(findBestTrades(rebuilt[0], rebuilt, 4, 100).some((i) => packageKey(i.send) === "a" && packageKey(i.receive) === "target")).toBe(true);
  });

  it("canonicalizes package order without mutating input or duplicating proposals", () => {
    const teams = fixture();
    const [a, b] = teams[0].players;
    const reversed = [b, a];
    expect(packageKey([a, b])).toBe(packageKey(reversed));
    expect(reversed).toEqual([b, a]);
    const ideas = findBestTrades(teams[0], teams, 4, 100);
    const keys = ideas.map((i) => `${i.partnerRosterId}:${packageKey(i.send)}:${packageKey(i.receive)}`);
    expect(new Set(keys).size).toBe(keys.length);
    const reordered = league(teams.map((t) => [...t.players].reverse()));
    expect(findBestTrades(reordered[0], reordered, 4, 100).map((i) => `${i.partnerRosterId}:${packageKey(i.send)}:${packageKey(i.receive)}`)).toEqual(keys);
  });

  it("keeps youth arbitrage subject to mutual acceptability", () => {
    const teams = fixture();
    teams[0].players[0].value = 2000;
    teams[0].players[0].age = 30;
    teams[1].players[0].age = 23;
    const rebuilt = league(teams.map((t) => t.players));
    const ideas = findBestTrades(rebuilt[0], rebuilt, 4, 100);
    expect(ideas.some((i) => i.kind === "youth_arbitrage")).toBe(true);
    expect(ideas.every((i) => i.mutual)).toBe(true);
  });
});
