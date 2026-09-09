import { describe, expect, it } from "vitest";
import { tieBandFor, tieNote, tiedWithBest } from "./tie";
import type { Candidate } from "./types";

// The case this exists for: week 1 of 2026 came back LAC at 1.00530 equity and
// JAX at 1.00471, and the report named LAC as the pick. The gap is 0.06%, on
// ownership numbers that were the national distribution with no weeks logged.

function candidate(team: string, score: number): Candidate {
  return {
    team,
    opponent: "OPP",
    home: true,
    week: 1,
    kickoff: "2026-09-13T20:25Z",
    winProb: 0.8,
    probSource: "moneyline",
    spread: -9.5,
    moneyline: -520,
    ownership: 0.3,
    fieldSurvival: 0.8,
    equityMultiplier: Math.exp(score),
    futureCost: 0,
    bestFutureWeek: null,
    bestFutureWinProb: null,
    flags: [],
    score,
  } as unknown as Candidate;
}

// The real numbers, as log(equity) with zero future cost.
const LAC = candidate("LAC", Math.log(1.0052956914800784));
const JAX = candidate("JAX", Math.log(1.004706595225417));
const DET = candidate("DET", Math.log(0.933));

describe("tieBandFor", () => {
  it("is widest when no weeks have been logged", () => {
    expect(tieBandFor("none")).toBeGreaterThan(tieBandFor("low"));
    expect(tieBandFor("low")).toBeGreaterThan(tieBandFor("medium"));
    expect(tieBandFor("medium")).toBeGreaterThan(tieBandFor("good"));
  });

  it("never claims more precision than the inputs have", () => {
    expect(tieBandFor("good")).toBeGreaterThan(0);
  });
});

describe("tiedWithBest", () => {
  it("calls the real week 1 board a tie", () => {
    const tied = tiedWithBest([LAC, JAX, DET], "none");
    expect(tied.map((c) => c.team)).toEqual(["LAC", "JAX"]);
  });

  it("leaves the clearly worse option out", () => {
    const tied = tiedWithBest([LAC, JAX, DET], "none");
    expect(tied.map((c) => c.team)).not.toContain("DET");
  });

  it("reports a genuine leader as a leader", () => {
    const clear = candidate("AAA", Math.log(1.25));
    const behind = candidate("BBB", Math.log(1.02));
    expect(tiedWithBest([clear, behind], "none")).toHaveLength(1);
  });

  it("still calls the real week 1 board a tie even on a trusted fit", () => {
    // Worth stating rather than assuming the opposite, which this test did at
    // first: the LAC/JAX gap is 0.0006 in log-equity, and even the tightest
    // band is 0.002. A 0.06% edge is noise however good the ownership fit is.
    expect(tiedWithBest([LAC, JAX], "good")).toHaveLength(2);
  });

  it("separates a real gap once the fit is trusted", () => {
    // 0.005 apart: inside the 0.01 band while ownership is a national guess,
    // outside the 0.002 band once weeks have been logged.
    const a = candidate("AAA", 0.02);
    const b = candidate("BBB", 0.015);
    expect(tiedWithBest([a, b], "none")).toHaveLength(2);
    expect(tiedWithBest([a, b], "good")).toHaveLength(1);
  });

  it("always includes the pick itself", () => {
    expect(tiedWithBest([LAC], "none").map((c) => c.team)).toEqual(["LAC"]);
  });

  it("handles an empty board without throwing", () => {
    expect(tiedWithBest([], "none")).toEqual([]);
  });
});

describe("tieNote", () => {
  it("says nothing when there is a clear best", () => {
    expect(tieNote([LAC], "none")).toBeNull();
  });

  it("names every tied team and tells him to take any of them", () => {
    const note = tieNote([LAC, JAX], "none")!;
    expect(note).toContain("LAC and JAX");
    expect(note).toContain("effectively tied");
    expect(note).toContain("Take whichever you prefer");
  });

  it("quotes the gap as a percentage of equity, not a raw score", () => {
    const note = tieNote([LAC, JAX], "none")!;
    expect(note).toContain("0.06%");
  });

  it("blames the right thing: unlogged ownership", () => {
    expect(tieNote([LAC, JAX], "none")!).toContain("national number");
  });

  it("lists three the readable way", () => {
    const third = candidate("CIN", Math.log(1.0045));
    expect(tieNote([LAC, JAX, third], "none")!).toContain("LAC, JAX and CIN");
  });
});
