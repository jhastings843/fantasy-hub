import { describe, expect, it } from "vitest";
import { rowsFrom, SCORING_CODE, type FpResponse } from "./fantasypros";
import { resolveNames, type SleeperCandidate } from "./resolve";

// Rows exactly as the platform returned them for week 2, 2026, trimmed to the
// five that carry the behaviour worth pinning down and otherwise untouched.
//
// Each one is here for a reason:
//   Josh Allen           a quarterback, which only the superflex list contains
//   Jahmyr Gibbs         an away game, so "location" and "at BUF" must agree
//   Parker Washington    team JAC, which Sleeper spells JAX
//   Xavier Worthy        the only negative vs-ECR row, so the sign is pinned
//   Philadelphia Eagles  a defence, named as a team and positioned DST
const REAL_ROWS: FpResponse = {
  expert_id: "7717",
  expert_name: "Jingles",
  sport: "NFL",
  type: "Weekly Half PPR",
  year: "2026",
  week: "2",
  position_id: "OP",
  scoring: "HALF",
  count: 5,
  published: "2026-09-17 07:19:57",
  players: [
    {
      rank: "1", pos_rank: "QB1", rank_ecr: 1, rank_vs_ecr: 0, player_id: 17298,
      player_name: "Josh Allen", player_team_id: "BUF", player_positions: "QB",
      player_yahoo_id: "30977", notes: "", bye_week: "7", opponent: "DET",
      location: "home", matchup: "vs. DET", tier: null,
    },
    {
      rank: "2", pos_rank: "RB1", rank_ecr: 3, rank_vs_ecr: 1, player_id: 22968,
      player_name: "Jahmyr Gibbs", player_team_id: "DET", player_positions: "RB",
      player_yahoo_id: "40059", notes: "", bye_week: "6", opponent: "BUF",
      location: "away", matchup: "at BUF", tier: null,
    },
    {
      rank: "65", pos_rank: "WR15", rank_ecr: 67, rank_vs_ecr: 2, player_id: 23106,
      player_name: "Parker Washington", player_team_id: "JAC", player_positions: "WR",
      player_yahoo_id: "40234", notes: "", bye_week: "7", opponent: "DEN",
      location: "away", matchup: "at DEN", tier: null,
    },
    {
      rank: "166", pos_rank: "WR67", rank_ecr: 139, rank_vs_ecr: -27, player_id: 23019,
      player_name: "Xavier Worthy", player_team_id: "KC", player_positions: "WR",
      player_yahoo_id: "40877", notes: "", bye_week: "5", opponent: "IND",
      location: "home", matchup: "vs. IND", tier: null,
    },
    {
      rank: "1", pos_rank: "DST1", rank_ecr: 1, rank_vs_ecr: 0, player_id: 8230,
      player_name: "Philadelphia Eagles", player_team_id: "PHI", player_positions: "DST",
      player_yahoo_id: "100021", notes: "", bye_week: "10", opponent: "TEN",
      location: "away", matchup: "at TEN", tier: null,
    },
  ],
};

const rows = rowsFrom(REAL_ROWS);
const byName = (name: string) => rows.find((r) => r.name === name)!;

describe("rowsFrom", () => {
  it("reads every row", () => {
    expect(rows).toHaveLength(5);
  });

  it("keeps his overall rank and his position rank apart", () => {
    // The row that would expose a parser conflating them: 65th overall, 15th
    // receiver. A flex decision needs the first and a WR slot needs the second.
    const parker = byName("Parker Washington");
    expect(parker.rank).toBe(65);
    expect(parker.positionRank).toBe(15);
  });

  it("reads the venue from the location field", () => {
    expect(byName("Josh Allen").home).toBe(true);
    expect(byName("Jahmyr Gibbs").home).toBe(false);
    expect(byName("Jahmyr Gibbs").opponent).toBe("BUF");
  });

  it("falls back to the matchup string when location is missing", () => {
    const withoutLocation = rowsFrom({
      ...REAL_ROWS,
      players: REAL_ROWS.players.map((p) => ({ ...p, location: null })),
    });
    expect(withoutLocation.find((r) => r.name === "Jahmyr Gibbs")!.home).toBe(false);
    expect(withoutLocation.find((r) => r.name === "Josh Allen")!.home).toBe(true);
  });

  it("calls a defence DEF, the way Sleeper does", () => {
    // He and FantasyPros both say DST. Every join in this app is on DEF, and a
    // row left as DST resolves to no player at all.
    expect(byName("Philadelphia Eagles").position).toBe("DEF");
  });

  it("reads vs-ECR with his direction: positive means he is higher", () => {
    // His own post explains this one: Parker Washington a top-15 receiver where
    // the field has him lower. A flipped sign would turn every stance he takes
    // into its opposite, and nothing downstream could tell.
    expect(byName("Parker Washington").vsEcr).toBe(2);
    expect(byName("Parker Washington").ecrRank).toBe(67);
    expect(byName("Xavier Worthy").vsEcr).toBe(-27);
  });

  it("carries the ids a join needs", () => {
    expect(byName("Josh Allen").fantasyProsId).toBe("17298");
    expect(byName("Josh Allen").yahooId).toBe("30977");
    expect(byName("Josh Allen").bye).toBe(7);
  });

  it("returns an empty note rather than an empty string", () => {
    expect(byName("Josh Allen").note).toBeNull();
  });

  it("survives a row with nothing in it", () => {
    const broken = rowsFrom({
      ...REAL_ROWS,
      players: [
        { ...REAL_ROWS.players[0], player_name: "" },
        { ...REAL_ROWS.players[1], rank: "not a number" },
      ],
    });
    expect(broken).toHaveLength(0);
  });
});

describe("resolving his rows against Sleeper", () => {
  // Enough of a catalog to exercise the two joins that have broken before.
  const catalog: SleeperCandidate[] = [
    { playerId: "6770", fullName: "Josh Allen", position: "QB", team: "BUF" },
    { playerId: "9509", fullName: "Jahmyr Gibbs", position: "RB", team: "DET" },
    { playerId: "9226", fullName: "Parker Washington", position: "WR", team: "JAX" },
    { playerId: "9500", fullName: "Xavier Worthy", position: "WR", team: "KC" },
    { playerId: "PHI", fullName: "Philadelphia Eagles", position: "DEF", team: "PHI" },
  ];

  it("joins every row, including the JAC/JAX spelling and the defence", () => {
    const { resolved, unresolved, ambiguous } = resolveNames(rows, catalog);
    expect(unresolved).toEqual([]);
    expect(ambiguous).toEqual([]);
    expect(resolved).toHaveLength(5);

    const idOf = (name: string) =>
      resolved.find((r) => r.input.name === name)!.playerId;
    expect(idOf("Parker Washington")).toBe("9226");
    expect(idOf("Philadelphia Eagles")).toBe("PHI");
  });
});

describe("SCORING_CODE", () => {
  it("maps our vocabulary onto theirs", () => {
    expect(SCORING_CODE.half_ppr).toBe("HALF");
    expect(SCORING_CODE.full_ppr).toBe("PPR");
    expect(SCORING_CODE.standard).toBe("STD");
  });
});
