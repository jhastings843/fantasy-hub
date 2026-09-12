import { describe, expect, it } from "vitest";
import { thursdaySubject, type ThursdayInput } from "./email";
import type { SurvivorReport } from "@/lib/survivor/types";
import type { WeeklyLineups } from "@/lib/lineup/build";

function survivor(
  poolId: string,
  name: string,
  best: string,
  opponent: string,
): SurvivorReport {
  return {
    poolId,
    week: 2,
    bestTeam: best,
    candidates: [{ team: best, opponent }],
    pool: { name },
  } as unknown as SurvivorReport;
}

const NO_CHANGES = {
  week: 2,
  season: 2026,
  leagues: [{ advice: { changes: [] } }],
} as unknown as WeeklyLineups;

function input(survivors: SurvivorReport[]): ThursdayInput {
  return {
    survivors,
    survivorError: null,
    lineups: NO_CHANGES,
    generatedAt: "2026-09-17T12:00:00Z",
    appUrl: "https://example.com",
  };
}

describe("thursdaySubject", () => {
  it("names the pick and the lineup tally for one pool", () => {
    expect(thursdaySubject(input([survivor("main", "500-entry pool", "LAC", "ARI")]))).toBe(
      "Week 2: LAC over ARI, lineups all set",
    );
  });

  it("says once when both pools land on the same team", () => {
    // The common case, and repeating the same team twice in an inbox line reads
    // as a bug rather than as agreement.
    const subject = thursdaySubject(
      input([
        survivor("main", "500-entry pool", "LAC", "ARI"),
        survivor("thirty", "30-entry pool", "LAC", "ARI"),
      ]),
    );
    expect(subject).toBe("Week 2: LAC over ARI in both pools, lineups all set");
  });

  it("names both teams when the pools disagree", () => {
    const subject = thursdaySubject(
      input([
        survivor("main", "500-entry pool", "LAC", "ARI"),
        survivor("thirty", "30-entry pool", "JAX", "CLE"),
      ]),
    );
    expect(subject).toBe("Week 2: LAC (500) / JAX (30), lineups all set");
  });

  it("still says which week it is when no pick could be built", () => {
    expect(thursdaySubject({ ...input([]), lineups: NO_CHANGES })).toBe(
      "Week 2: no survivor pick, lineups all set",
    );
  });
});
