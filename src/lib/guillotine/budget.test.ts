import { describe, expect, it } from "vitest";
import { planBudget, phaseFor, strengthFor } from "./budget";
import type { BudgetInput } from "./budget";

// Dah Chopped: 16 teams, $1000 budget.
const base: BudgetInput = {
  budget: 1000,
  remaining: 1000,
  teamsAlive: 16,
  totalTeams: 16,
  posture: "yellow",
  rivalRemaining: Array(15).fill(1000),
};

describe("phaseFor", () => {
  it("keys the inversion to teams remaining, not the date", () => {
    expect(phaseFor(16)).toBe("field");
    expect(phaseFor(7)).toBe("field");
    expect(phaseFor(6)).toBe("consolidation");
    expect(phaseFor(5)).toBe("consolidation");
    expect(phaseFor(4)).toBe("endgame");
    expect(phaseFor(2)).toBe("duel");
  });
});

describe("planBudget", () => {
  it("computes the neutral allowance from eliminations remaining", () => {
    // $1000 over 15 chops in a 16-team league.
    expect(planBudget(base).neutralAllowance).toBeCloseTo(1000 / 15, 5);
  });

  it("gives a 12-team league a larger allowance than a 16-team league", () => {
    const twelve = planBudget({ ...base, teamsAlive: 12, totalTeams: 12, rivalRemaining: Array(11).fill(1000) });
    expect(twelve.neutralAllowance).toBeGreaterThan(planBudget(base).neutralAllowance);
  });

  it("holds nearly the whole budget at the start of the season", () => {
    expect(planBudget(base).holdFloor).toBeCloseTo(950, 0);
  });

  it("still leaves week one biddable", () => {
    // A curve that held 100% before the first chop made the opening waiver run
    // impossible, which is wrong: an injury in week one is a cheap fix.
    const plan = planBudget(base);
    expect(plan.weeklyCap).toBeGreaterThan(0);
    expect(plan.maxSingleBid).toBeGreaterThan(0);
  });

  it("releases the budget as eliminations pile up", () => {
    const early = planBudget({ ...base, teamsAlive: 13, rivalRemaining: Array(12).fill(900) });
    const mid = planBudget({ ...base, teamsAlive: 9, rivalRemaining: Array(8).fill(700) });
    const late = planBudget({ ...base, teamsAlive: 5, rivalRemaining: Array(4).fill(400) });
    expect(early.holdFloor).toBeGreaterThan(mid.holdFloor);
    expect(mid.holdFloor).toBeGreaterThan(late.holdFloor);
  });

  it("keeps a green week to price enforcement", () => {
    const plan = planBudget({ ...base, teamsAlive: 10, remaining: 800, posture: "green", rivalRemaining: Array(9).fill(700) });
    expect(plan.weeklyCap).toBeLessThanOrEqual(20);
    expect(plan.notes.some((n) => n.includes("price-enforcing"))).toBe(true);
  });

  it("overrides pacing when the week is red", () => {
    const green = planBudget({ ...base, teamsAlive: 14, remaining: 950, posture: "green", rivalRemaining: Array(13).fill(950) });
    const red = planBudget({ ...base, teamsAlive: 14, remaining: 950, posture: "red", rivalRemaining: Array(13).fill(950) });
    expect(red.weeklyCap).toBeGreaterThan(green.weeklyCap);
    expect(red.weeklyCap).toBeLessThanOrEqual(300);
    expect(red.notes.some((n) => n.includes("overridden"))).toBe(true);
  });

  it("never lets a single early bid exceed a quarter of the budget", () => {
    const plan = planBudget({ ...base, teamsAlive: 14, remaining: 950, posture: "red", rivalRemaining: Array(13).fill(950) });
    expect(plan.maxSingleBid).toBeLessThanOrEqual(250);
  });

  it("switches pacing off in the endgame", () => {
    const plan = planBudget({ ...base, teamsAlive: 3, remaining: 420, posture: "green", rivalRemaining: [300, 150] });
    expect(plan.weeklyCap).toBe(420);
    expect(plan.notes.some((n) => n.includes("Pacing is switched off"))).toBe(true);
  });

  it("spends everything in a duel", () => {
    const plan = planBudget({ ...base, teamsAlive: 2, remaining: 275, posture: "green", rivalRemaining: [90] });
    expect(plan.weeklyCap).toBe(275);
    expect(plan.maxSingleBid).toBe(275);
    expect(plan.phaseNote).toContain("Leftover FAAB is worth exactly zero");
  });

  it("never recommends spending more than you have", () => {
    const plan = planBudget({ ...base, teamsAlive: 12, remaining: 40, posture: "red", rivalRemaining: Array(11).fill(600) });
    expect(plan.weeklyCap).toBeLessThanOrEqual(40);
    expect(plan.maxSingleBid).toBeLessThanOrEqual(40);
  });

  it("measures purchasing power against surviving rivals, not the original field", () => {
    const plan = planBudget({
      ...base,
      teamsAlive: 4,
      remaining: 600,
      rivalRemaining: [100, 80, 20],
    });
    expect(plan.purchasingPowerShare).toBeCloseTo(600 / 800, 5);
    expect(plan.maxRivalBid).toBe(100);
  });

  it("flags a commanding budget lead", () => {
    const plan = planBudget({
      ...base,
      teamsAlive: 4,
      remaining: 600,
      rivalRemaining: [100, 80, 20],
    });
    expect(plan.notes.some((n) => n.includes("real weapon"))).toBe(true);
  });

  it("warns when a rival can outbid you on anything", () => {
    const plan = planBudget({
      ...base,
      teamsAlive: 3,
      remaining: 100,
      rivalRemaining: [700, 300],
    });
    expect(plan.notes.some((n) => n.includes("cannot afford to chase"))).toBe(true);
  });
});

describe("roster strength", () => {
  const base = {
    budget: 1000,
    remaining: 820,
    teamsAlive: 9,
    totalTeams: 16,
    posture: "yellow" as const,
    rivalRemaining: [661, 587, 470, 460, 307, 200, 150, 90],
  };

  // Week 8: 2nd lowest of 9, $820 left. The curve alone held $753 and capped
  // the week at $67; the weak-roster hold is $650, so the week opens to $170.
  it("loosens pacing for a bottom-third roster", () => {
    const plan = planBudget({ ...base, rankFromBottom: 2 });
    expect(plan.holdFloor).toBe(650);
    expect(plan.weeklyCap).toBe(170);
    expect(plan.notes.join(" ")).toContain("bottom third");
  });

  it("leaves middle and top rosters on the season curve", () => {
    const curve = planBudget(base);
    expect(planBudget({ ...base, rankFromBottom: 5 }).weeklyCap).toBe(curve.weeklyCap);
    expect(planBudget({ ...base, rankFromBottom: 9 }).weeklyCap).toBe(curve.weeklyCap);
    expect(curve.weeklyCap).toBe(67);
  });

  it("caps a weak yellow week at 20% of budget", () => {
    const plan = planBudget({ ...base, remaining: 1000, rankFromBottom: 1 });
    expect(plan.weeklyCap).toBe(200);
  });

  it("splits the field into thirds", () => {
    expect(strengthFor(3, 9)).toBe("bottom");
    expect(strengthFor(4, 9)).toBe("middle");
    expect(strengthFor(7, 9)).toBe("top");
    expect(strengthFor(undefined, 9)).toBeNull();
  });
});
