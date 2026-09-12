import { describe, expect, it } from "vitest";
import { reportsFrom, type ReportInputs } from "./report";
import { DEFAULT_POOL, type Game, type PoolConfig } from "./types";

function game(week: number, home: string, away: string, p: number): Game {
  return {
    week,
    home,
    away,
    kickoff: `2026-09-${String(6 + week).padStart(2, "0")}T17:00:00Z`,
    homeSpread: null,
    homeMoneyline: null,
    awayMoneyline: null,
    overUnder: null,
    homeWinProb: p,
    probSource: "moneyline",
    completed: false,
    homeScore: null,
    awayScore: null,
  };
}

const GAMES = [
  game(1, "KC", "DEN", 0.82),
  game(1, "PHI", "NYG", 0.74),
  game(1, "BUF", "NYJ", 0.66),
  game(2, "KC", "NYG", 0.8),
  game(2, "PHI", "DEN", 0.72),
  game(2, "BUF", "NYJ", 0.64),
];

const PICKS = { KC: 0.4, PHI: 0.3, BUF: 0.2, NYJ: 0.05, DEN: 0.03, NYG: 0.02 };

const INPUTS: ReportInputs = {
  games: GAMES,
  publicByWeek: { "1": PICKS },
  publicPulledAt: "2026-09-06T12:00:00Z",
  injuries: [],
  now: new Date("2026-09-06T00:00:00Z"),
};

function pool(over: Partial<PoolConfig> = {}): PoolConfig {
  return { ...DEFAULT_POOL, ...over };
}

describe("reportsFrom", () => {
  it("returns one report per pool, in the order given", () => {
    const reports = reportsFrom(INPUTS, [
      { id: "main", pool: pool({ name: "500-entry pool" }) },
      { id: "thirty", pool: pool({ name: "30-entry pool", poolSize: 30 }) },
    ]);
    expect(reports.map((r) => r.poolId)).toEqual(["main", "thirty"]);
    expect(reports.map((r) => r.pool.name)).toEqual([
      "500-entry pool",
      "30-entry pool",
    ]);
  });

  it("gives every report the same ownership snapshot", () => {
    // The reason the pools share one fetch. Two reports built from two separate
    // pulls could price the same slate off different ownership and disagree for
    // a reason that has nothing to do with either pool.
    const reports = reportsFrom(INPUTS, [
      { id: "main", pool: pool() },
      { id: "thirty", pool: pool({ poolSize: 30 }) },
    ]);
    expect(reports[0].ownership).toEqual(reports[1].ownership);
    expect(reports[0].week).toBe(reports[1].week);
  });

  it("keeps burned teams to the pool that burned them", () => {
    // The whole point of a second pool. KC is spent in one and available in the
    // other, so the boards have to differ.
    const [spent, clean] = reportsFrom(INPUTS, [
      { id: "main", pool: pool({ usedTeams: ["KC"] }) },
      { id: "thirty", pool: pool({ poolSize: 30 }) },
    ]);
    expect(spent.candidates.map((c) => c.team)).not.toContain("KC");
    expect(clean.candidates.map((c) => c.team)).toContain("KC");
    expect(clean.bestTeam).toBe("KC");
    expect(spent.bestTeam).not.toBe("KC");
  });

  it("keeps a taken pick to the pool it was taken in", () => {
    const [taken, notTaken] = reportsFrom(INPUTS, [
      { id: "main", pool: pool({ myPicks: { "1": "PHI" } }) },
      { id: "thirty", pool: pool({ poolSize: 30 }) },
    ]);
    expect(taken.myPick).toBe("PHI");
    expect(notTaken.myPick).toBe(null);
  });

  it("fits the chalk factor per pool from that pool's own logged weeks", () => {
    // Each pool leans off the public by its own amount, so one pool's logged
    // distribution must not calibrate the other's board.
    const [logged, unlogged] = reportsFrom(
      { ...INPUTS, now: new Date("2026-09-09T00:00:00Z") },
      [
        {
          id: "main",
          pool: pool({ weeklyPicks: { "1": { KC: 70, PHI: 20, BUF: 10 } } }),
        },
        { id: "thirty", pool: pool({ poolSize: 30 }) },
      ],
    );
    expect(logged.calibration.weeks).toBe(1);
    expect(unlogged.calibration.weeks).toBe(0);
  });
});
