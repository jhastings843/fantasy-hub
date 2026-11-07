import { describe, expect, it } from "vitest";
import type { PlayerRow } from "./power-rankings";
import { buildTradePlan, type PlanGoal } from "./trade-plan";

function player(id: string, name: string, position: string): PlayerRow {
  return { id, name, position, value: 1000, age: 25, team: null, overallRank: 0, positionRank: 0 };
}

const ROSTER = [player("9221", "Jahmyr Gibbs", "RB"), player("1", "Davante Adams", "WR")];

function goal(text: string, extra: Partial<PlanGoal> = {}): PlanGoal {
  return { id: text, text, category: "trade", done: false, ...extra };
}

function plan(goals: PlanGoal[], trajectory: "contender" | "rebuild" | "transition" | null = "transition", leagueType: "dynasty" | "redraft" = "dynasty") {
  return buildTradePlan({ leagueType, trajectory, goals, myPlayers: ROSTER });
}

describe("trade plan from the season plan", () => {
  it("takes stance from trajectory with no goals", () => {
    expect(plan([], "contender").stance).toBe("win_now");
    expect(plan([], "rebuild").stance).toBe("build");
    expect(plan([], "transition").stance).toBe("balanced");
    expect(plan([], "contender").stanceFrom).toBe("trajectory");
  });

  it("reads a wanted position", () => {
    expect(plan([goal("Get a WR1 before the deadline")]).focus.map((f) => f.position)).toEqual(["WR"]);
    expect(plan([goal("need a tight end")]).focus.map((f) => f.position)).toEqual(["TE"]);
  });

  it("reads a position to sell as shed, not focus", () => {
    const p = plan([goal("Sell an RB, I'm deep there")]);
    expect(p.focus).toEqual([]);
    expect(p.shed.map((s) => s.position)).toEqual(["RB"]);
  });

  it("keeps a named player and does not treat the keep as a need", () => {
    const p = plan([goal("Keep Gibbs, build around him")]);
    expect(p.keep.map((k) => k.id)).toEqual(["9221"]);
    expect(p.focus).toEqual([]);
  });

  it("lets a goal override trajectory", () => {
    const p = plan([goal("Go all in for the title")], "rebuild");
    expect(p.stance).toBe("win_now");
    expect(p.stanceFrom).toBe("goal");
    expect(plan([goal("Rebuild: get younger, add picks")], "contender").stance).toBe("build");
  });

  it("ignores done goals and draft goals", () => {
    expect(plan([goal("Get a WR1", { done: true })]).focus).toEqual([]);
    expect(plan([goal("Draft a QB in round 1", { category: "draft" })]).focus).toEqual([]);
  });

  it("never moves stance in redraft", () => {
    const p = plan([goal("Rebuild with youth")], null, "redraft");
    expect(p.stance).toBe("win_now");
    expect(p.stanceFrom).toBe("format");
  });
});
