import { describe, expect, it } from "vitest";
import { callPosture, lineupSigma, simulateChop, toSimTeam } from "./chop-line";
import type { SimTeam } from "./chop-line";
import type { LineupPlayer } from "./lineup";

const p = (id: string, position: string, points: number): LineupPlayer => ({
  playerId: id,
  position,
  points,
});

/** A team of eight starters averaging `avg` points each. */
function team(rosterId: number, avg: number, isMine = false): SimTeam {
  const positions = ["QB", "RB", "RB", "WR", "WR", "TE", "RB", "WR"];
  return {
    rosterId,
    name: `Team ${rosterId}`,
    isMine,
    starters: positions.map((pos, i) => p(`${rosterId}-${i}`, pos, avg)),
  };
}

describe("lineupSigma", () => {
  it("grows with projection", () => {
    const small = lineupSigma([p("a", "WR", 5)]);
    const large = lineupSigma([p("a", "WR", 25)]);
    expect(large).toBeGreaterThan(small);
  });

  it("treats quarterbacks as steadier than tight ends", () => {
    expect(lineupSigma([p("a", "QB", 20)])).toBeLessThan(lineupSigma([p("a", "TE", 20)]));
  });

  it("floors the spread so a tiny projection is not a certainty", () => {
    expect(lineupSigma([p("a", "WR", 0)])).toBeGreaterThanOrEqual(3);
  });

  it("adds in quadrature, so eight players are not eight times as volatile", () => {
    const one = lineupSigma([p("a", "WR", 10)]);
    const eight = lineupSigma(Array.from({ length: 8 }, (_, i) => p(`x${i}`, "WR", 10)));
    expect(eight).toBeCloseTo(one * Math.sqrt(8), 5);
  });

  it("is zero for an empty lineup", () => {
    expect(lineupSigma([])).toBe(0);
  });
});

describe("simulateChop", () => {
  it("gives every identical team the baseline risk", () => {
    const teams = Array.from({ length: 16 }, (_, i) => team(i + 1, 12));
    const result = simulateChop(teams, { simulations: 4000 });
    expect(result.baselineRisk).toBeCloseTo(1 / 16, 5);
    for (const t of result.teams) {
      expect(t.chopProbability).toBeGreaterThan(0.03);
      expect(t.chopProbability).toBeLessThan(0.10);
    }
  });

  it("puts the most risk on the weakest team", () => {
    const teams = [team(1, 6), ...Array.from({ length: 15 }, (_, i) => team(i + 2, 14))];
    const result = simulateChop(teams, { simulations: 4000 });
    expect(result.teams[0].rosterId).toBe(1);
    expect(result.teams[0].chopProbability).toBeGreaterThan(0.5);
  });

  it("sums every team's risk to one, since exactly one team is chopped", () => {
    const teams = Array.from({ length: 8 }, (_, i) => team(i + 1, 8 + i));
    const result = simulateChop(teams, { simulations: 4000 });
    const total = result.teams.reduce((s, t) => s + t.chopProbability, 0);
    expect(total).toBeCloseTo(1, 5);
  });

  it("is deterministic for a given seed", () => {
    const teams = Array.from({ length: 12 }, (_, i) => team(i + 1, 10 + (i % 4)));
    const a = simulateChop(teams, { simulations: 2000, seed: 7 });
    const b = simulateChop(teams, { simulations: 2000, seed: 7 });
    expect(a.teams.map((t) => t.chopProbability)).toEqual(
      b.teams.map((t) => t.chopProbability),
    );
  });

  it("reports my margin against the expected chop line", () => {
    const teams = [team(1, 15, true), ...Array.from({ length: 15 }, (_, i) => team(i + 2, 10))];
    const result = simulateChop(teams, { simulations: 4000 });
    expect(result.myChopProbability).toBeLessThan(result.baselineRisk);
    expect(result.myMargin).toBeGreaterThan(0);
    expect(result.expectedChopLine).toBeLessThan(15 * 8);
  });

  it("separates two teams with the same projection but different volatility", () => {
    // Same 96-point projection: one steady QB-heavy build, one all tight ends.
    const steady: SimTeam = {
      rosterId: 1,
      name: "Steady",
      isMine: false,
      starters: Array.from({ length: 8 }, (_, i) => p(`s${i}`, "QB", 12)),
    };
    const swingy: SimTeam = {
      rosterId: 2,
      name: "Swingy",
      isMine: false,
      starters: Array.from({ length: 8 }, (_, i) => p(`w${i}`, "TE", 12)),
    };
    const others = Array.from({ length: 6 }, (_, i) => team(i + 3, 13));
    const result = simulateChop([steady, swingy, ...others], { simulations: 8000 });
    const s = result.teams.find((t) => t.rosterId === 1)!;
    const w = result.teams.find((t) => t.rosterId === 2)!;
    expect(w.chopProbability).toBeGreaterThan(s.chopProbability);
  });

  it("reports the range the low score actually lands in", () => {
    const teams = Array.from({ length: 12 }, (_, i) => team(i + 1, 12));
    const result = simulateChop(teams, { simulations: 8000 });
    const [low, high] = result.chopLineRange;
    expect(low).toBeLessThan(result.expectedChopLine);
    expect(high).toBeGreaterThan(result.expectedChopLine);
  });

  it("puts every team's floor below its projection", () => {
    const result = simulateChop(
      Array.from({ length: 6 }, (_, i) => team(i + 1, 12)),
      { simulations: 1000 },
    );
    for (const t of result.teams) {
      expect(t.floor).toBeLessThan(t.projected);
    }
  });

  it("gives a volatile team a lower floor than a steady one at the same projection", () => {
    const steady: SimTeam = {
      rosterId: 1, name: "Steady", isMine: false,
      starters: Array.from({ length: 8 }, (_, i) => p(`s${i}`, "QB", 12)),
    };
    const swingy: SimTeam = {
      rosterId: 2, name: "Swingy", isMine: false,
      starters: Array.from({ length: 8 }, (_, i) => p(`w${i}`, "TE", 12)),
    };
    const result = simulateChop([steady, swingy], { simulations: 1000 });
    const s = result.teams.find((t) => t.rosterId === 1)!;
    const w = result.teams.find((t) => t.rosterId === 2)!;
    expect(w.floor).toBeLessThan(s.floor);
  });

  it("handles an empty field without dividing by zero", () => {
    const result = simulateChop([], { simulations: 100 });
    expect(result.myMargin).toBeNull();
    expect(result.baselineRisk).toBe(0);
    expect(result.expectedChopLine).toBe(0);
    expect(result.chopLineRange).toEqual([0, 0]);
  });
});

describe("callPosture", () => {
  const field = (mineAvg: number) => [
    team(1, mineAvg, true),
    ...Array.from({ length: 15 }, (_, i) => team(i + 2, 12)),
  ];

  it("calls red when risk runs well above the baseline", () => {
    const call = callPosture(simulateChop(field(6), { simulations: 4000 }));
    expect(call.posture).toBe("red");
    expect(call.headline).toContain("Spend");
  });

  it("calls green when clear of the field", () => {
    const call = callPosture(simulateChop(field(18), { simulations: 4000 }));
    expect(call.posture).toBe("green");
    expect(call.headline).toContain("Hold");
  });

  it("calls yellow at about average risk", () => {
    const call = callPosture(simulateChop(field(12), { simulations: 4000 }));
    expect(call.posture).toBe("yellow");
  });

  it("says so plainly when my team is not in the field", () => {
    const call = callPosture(simulateChop([team(1, 10)], { simulations: 100 }));
    expect(call.headline).toBe("No read yet");
  });
});

describe("toSimTeam", () => {
  it("simulates the starting lineup only, leaving the surplus out", () => {
    const roster = [
      p("qb", "QB", 20),
      p("rb1", "RB", 15), p("rb2", "RB", 12),
      p("wr1", "WR", 14), p("wr2", "WR", 13),
      p("te", "TE", 8),
      p("spare1", "WR", 2), p("spare2", "WR", 1),
    ];
    const sim = toSimTeam(1, "Mine", true, roster, ["QB", "RB", "RB", "WR", "WR", "TE", "BN", "BN"]);
    expect(sim.starters).toHaveLength(6);
    expect(sim.starters.map((s) => s.playerId)).not.toContain("spare1");
    expect(sim.starters.reduce((t, s) => t + s.points, 0)).toBeCloseTo(82, 5);
  });
});

describe("last week in the posture detail", () => {
  const field = [team(1, 13, true), ...Array.from({ length: 12 }, (_, i) => team(i + 2, 13))];

  it("names last week's finish without moving the number", () => {
    const r = simulateChop(field, { simulations: 2000 });
    const call = callPosture(r, {
      week: 1,
      score: 59.7,
      rankFromBottom: 2,
      teams: 16,
      lowest: 52,
      margin: 7.7,
    });
    expect(call.detail).toContain("Last week you scored 59.7");
    expect(call.detail).toContain("2nd lowest of 16");
    expect(r.teams.find((t) => t.isMine)!.projected).toBeCloseTo(13 * 8);
  });

  it("says nothing about last week before one has been played", () => {
    const call = callPosture(simulateChop(field, { simulations: 2000 }), null);
    expect(call.detail).not.toContain("Last week");
  });
});
