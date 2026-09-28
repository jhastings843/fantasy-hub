import { describe, expect, it } from "vitest";
import { reportsFrom, type ReportInputs } from "./report";
import { splitAlternative, SPLIT_SCORE_BAND } from "./split";
import { DEFAULT_POOL, type Candidate, type Game, type PoolConfig } from "./types";

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

const NOW = new Date("2026-09-06T00:00:00Z");

// KC and PHI nearly level, BUF well behind: a split should land on PHI.
const CLOSE: ReportInputs = {
  games: [game(1, "KC", "DEN", 0.8), game(1, "PHI", "NYG", 0.79), game(1, "BUF", "NYJ", 0.62)],
  publicByWeek: { "1": { KC: 0.3, PHI: 0.3, BUF: 0.2, NYJ: 0.1, DEN: 0.05, NYG: 0.05 } },
  publicPulledAt: "2026-09-06T12:00:00Z",
  injuries: [],
  now: NOW,
};

// KC far ahead of everything: splitting would cost too much, so stack.
const CLEAR: ReportInputs = {
  ...CLOSE,
  games: [game(1, "KC", "DEN", 0.9), game(1, "PHI", "NYG", 0.7), game(1, "BUF", "NYJ", 0.62)],
};

function pool(over: Partial<PoolConfig> = {}): PoolConfig {
  return { ...DEFAULT_POOL, ...over };
}

const TWO = (a: Partial<PoolConfig> = {}, b: Partial<PoolConfig> = {}) => [
  { id: "main", pool: pool({ name: "500 pool", ...a }) },
  { id: "thirty", pool: pool({ name: "30 pool", poolSize: 30, ...b }) },
];

describe("cross-pool split", () => {
  it("moves one open pool to a close alternative instead of stacking", () => {
    const solo = reportsFrom(CLOSE, [TWO()[0]])[0];
    expect(solo.bestTeam).toBe("KC");
    expect(solo.crossPool).toBe(null);

    const reports = reportsFrom(CLOSE, TWO());
    const teams = reports.map((r) => r.bestTeam);
    expect(new Set(teams).size).toBe(2);
    expect(teams).toContain("KC");
    expect(teams).toContain("PHI");

    const moved = reports.find((r) => r.bestTeam === "PHI")!;
    expect(moved.crossPool).toMatchObject({ kind: "split", team: "KC", movedTo: "PHI" });
    expect(moved.reasoning[0]).toMatch(/^Split from the/);
    expect(moved.candidates[0].team).toBe("PHI");
    // KC was given up to split, so it is not offered back as a tie.
    expect(moved.tied).not.toContain("KC");
    expect(moved.headline).not.toMatch(/KC/);
  });

  it("stacks and warns both pools when nothing is close", () => {
    const reports = reportsFrom(CLEAR, TWO());
    expect(reports.map((r) => r.bestTeam)).toEqual(["KC", "KC"]);
    for (const r of reports) {
      expect(r.crossPool?.kind).toBe("stacked");
      expect(r.reasoning[0]).toMatch(/nothing else is close enough/);
    }
    expect(reports[0].crossPool?.otherPool).toBe("30 pool");
    expect(reports[1].crossPool?.otherPool).toBe("500 pool");
  });

  it("never moves a taken pick, and moves the open pool instead", () => {
    const [taken, open] = reportsFrom(CLOSE, TWO({}, { myPicks: { "1": "KC" } }));
    expect(open.myPick).toBe("KC");
    expect(open.crossPool).toBe(null);
    expect(taken.bestTeam).toBe("PHI");
    expect(taken.crossPool?.kind).toBe("split");
  });

  it("warns when the same team is already taken in both", () => {
    const reports = reportsFrom(
      CLOSE,
      TWO({ myPicks: { "1": "KC" } }, { myPicks: { "1": "KC" } }),
    );
    for (const r of reports) {
      expect(r.crossPool?.kind).toBe("stacked");
      expect(r.reasoning[0]).toMatch(/you have KC in both/);
    }
  });

  it("leaves pools on different teams alone", () => {
    const reports = reportsFrom(CLOSE, TWO({ usedTeams: ["KC"] }));
    expect(reports.map((r) => r.crossPool)).toEqual([null, null]);
  });
});

describe("splitAlternative", () => {
  const c = (team: string, score: number, winProb: number) =>
    ({ team, score, winProb }) as Candidate;

  it("skips teams outside either band or already claimed", () => {
    const list = [
      c("KC", 0.1, 0.8),
      c("PHI", 0.1 - SPLIT_SCORE_BAND - 0.001, 0.8),
      c("BUF", 0.09, 0.7),
      c("SF", 0.095, 0.79),
      c("LAR", 0.094, 0.79),
    ];
    expect(splitAlternative(list, { KC: "A" })?.team).toBe("SF");
    expect(splitAlternative(list, { KC: "A", SF: "B" })?.team).toBe("LAR");
    expect(splitAlternative(list.slice(0, 3), { KC: "A" })).toBe(null);
  });
});
