import { describe, expect, it } from "vitest";
import { orderTieByPosture, tieBandFor, tieNote, tiedWithBest } from "./tie";
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

describe("orderTieByPosture", () => {
  // The real reason this exists: LAC and JAX are 0.06% apart on equity, which
  // the engine has already declared indistinguishable. Something has to choose,
  // and "whichever floating point put first" is a worse answer than the pool's
  // own shape. LAC is the safer team (80.0% against 78.7%) and JAX is the less
  // owned one (26.9% against 33.1%), so the two pools want opposite ends of the
  // same tie.
  function c(team: string, score: number, winProb: number, ownership: number): Candidate {
    return { ...candidate(team, score), winProb, ownership };
  }
  const lac = c("LAC", Math.log(1.0052956914800784), 0.8, 0.3311);
  const jax = c("JAX", Math.log(1.004706595225417), 0.7867, 0.2686);
  const det = c("DET", Math.log(0.933), 0.7335, 0.1548);

  it("prefers the safer team when surviving wins outright", () => {
    const out = orderTieByPosture([lac, jax, det], "none", "safety");
    expect(out.map((x) => x.team)).toEqual(["LAC", "JAX", "DET"]);
  });

  it("prefers the less owned team when the prize is likely split", () => {
    const out = orderTieByPosture([lac, jax, det], "none", "leverage");
    expect(out.map((x) => x.team)).toEqual(["JAX", "LAC", "DET"]);
  });

  it("never reorders past the tie band", () => {
    // DET is 7% behind on equity, which is a real gap. Leverage would love its
    // 15.5% ownership and must not be allowed to promote it.
    const out = orderTieByPosture([lac, jax, det], "none", "leverage");
    expect(out[2].team).toBe("DET");
  });

  it("leaves a board with no tie exactly as it was", () => {
    const out = orderTieByPosture([lac, det], "good", "leverage");
    expect(out.map((x) => x.team)).toEqual(["LAC", "DET"]);
  });

  it("does not mutate the array it was given", () => {
    const input = [lac, jax, det];
    orderTieByPosture(input, "none", "leverage");
    expect(input.map((x) => x.team)).toEqual(["LAC", "JAX", "DET"]);
  });

  it("handles an empty board", () => {
    expect(orderTieByPosture([], "none", "safety")).toEqual([]);
  });
});

describe("tieNote, with a posture", () => {
  const lac = { ...candidate("LAC", Math.log(1.0052956914800784)), winProb: 0.8, ownership: 0.3311 };
  const jax = { ...candidate("JAX", Math.log(1.004706595225417)), winProb: 0.7867, ownership: 0.2686 };

  it("no longer shrugs when the pool gives a reason to choose", () => {
    // "Take whichever you prefer" was the honest answer while nothing could
    // separate them. Now something can, and the note has to say what it was.
    const note = tieNote([lac, jax], "none", "safety");
    expect(note).not.toMatch(/whichever you prefer/);
    expect(note).toMatch(/safer|survive|outright/i);
  });

  it("says it took the lower-owned side in a pool that will split", () => {
    const note = tieNote([jax, lac], "none", "leverage");
    expect(note).toMatch(/JAX/);
    expect(note).toMatch(/owned|follow|split/i);
  });

  it("reports the spread as a positive number whichever way the tie was broken", () => {
    // Found on the live board: the note read "-0.54% of equity separates them".
    // The gap used to be tied[0] minus the last one, which was safe only while
    // the array was sorted by score. Breaking a tie toward leverage puts a
    // slightly lower-scoring team first, and the subtraction went negative. A
    // spread between two teams has no direction.
    const leverage = tieNote([jax, lac], "none", "leverage");
    const safety = tieNote([lac, jax], "none", "safety");
    expect(leverage).not.toMatch(/-\d/);
    // 0.06% is this fixture's real spread, the documented week 1 LAC/JAX pair.
    // Both orderings must report the same magnitude.
    expect(leverage).toMatch(/0\.06% of equity/);
    expect(safety).toMatch(/0\.06% of equity/);
  });

  it("still shrugs when no posture is supplied", () => {
    expect(tieNote([lac, jax], "none")).toMatch(/whichever you prefer/);
  });
});
