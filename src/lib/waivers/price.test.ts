import { describe, expect, it } from "vitest";
import {
  classifyClaim,
  paceTarget,
  pacingFor,
  parsePositionRank,
  priceClaim,
  reserveFor,
  type ClaimCandidate,
  type PricingContext,
} from "./price";

const REDRAFT_SLOTS = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "FLEX", "DEF", "BN", "BN"];
const DYNASTY_SLOTS = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "FLEX", "FLEX", "SUPER_FLEX", "BN"];

function ctx(over: Partial<PricingContext> = {}): PricingContext {
  return {
    type: "redraft",
    budget: 100,
    remaining: 100,
    week: 2,
    teams: 12,
    rosterPositions: REDRAFT_SLOTS,
    record: { wins: 1, losses: 1 },
    trajectory: null,
    observed: [],
    trending: new Map(),
    emptySlots: 0,
    ...over,
  };
}

function cand(over: Partial<ClaimCandidate> = {}): ClaimCandidate {
  return {
    playerId: "p",
    position: "WR",
    age: 26,
    seasonPositionRank: null,
    weekGain: null,
    startsThisWeek: false,
    ...over,
  };
}

describe("parsePositionRank", () => {
  it("reads the number off a positional label", () => {
    expect(parsePositionRank("WR54")).toBe(54);
    expect(parsePositionRank("RB 7")).toBe(7);
    expect(parsePositionRank(null)).toBeNull();
    expect(parsePositionRank("unranked")).toBeNull();
  });
});

describe("classifyClaim", () => {
  it("calls a top-ranked WR a league winner and a mid-ranked one a starter", () => {
    // 12 teams, 2 WR plus two of three flex positions: about 32 WR start.
    expect(classifyClaim(cand({ seasonPositionRank: 10 }), ctx())).toBe("winner");
    expect(classifyClaim(cand({ seasonPositionRank: 28 }), ctx())).toBe("starter");
  });

  it("prices on lineup gain when the season rank is outside the starters", () => {
    expect(classifyClaim(cand({ seasonPositionRank: 60, weekGain: 3 }), ctx())).toBe("multiweek");
    expect(classifyClaim(cand({ seasonPositionRank: 60, weekGain: 0.8 }), ctx())).toBe("filler");
    expect(classifyClaim(cand({ seasonPositionRank: 60 }), ctx())).toBe("stash");
  });

  it("calls a rank-only start a filler, because nobody measured the gain", () => {
    // He cracks the lineup by the solver's ranking, but the projection feed
    // has no number for one of the two players. That is a start, not a
    // multiweek starter: two points of gain has to be two points.
    const c = cand({
      seasonPositionRank: 60,
      weekGain: null,
      startsThisWeek: true,
      weekSlot: { slot: "FLEX", over: "Denzel Boston", from: 80, to: 70 },
    });
    expect(classifyClaim(c, ctx())).toBe("filler");
    const p = priceClaim(c, ctx());
    expect(p.reason).toContain("Cracks this week's lineup at FLEX over Denzel Boston");
    expect(p.reason).toContain("70 against 80");
    expect(p.reason).not.toContain("Adds");
  });

  it("says projected points when it has them, and calls them that", () => {
    const p = priceClaim(cand({ seasonPositionRank: 60, weekGain: 3.2, startsThisWeek: true }), ctx());
    expect(p.reason).toContain("Adds 3.2 projected points to this week's lineup");
  });

  it("pays more for a player who starts than one who sits, even without a point figure", () => {
    const starts = priceClaim(cand({ seasonPositionRank: 60, startsThisWeek: true }), ctx());
    const sits = priceClaim(cand({ seasonPositionRank: 60, startsThisWeek: false }), ctx());
    expect(starts.walkAway).toBeGreaterThan(sits.walkAway);
  });

  it("bids nothing when there is nothing left to spend", () => {
    const p = priceClaim(cand({ seasonPositionRank: 28, weekGain: 3 }), ctx({ remaining: 0 }));
    expect(p.bid).toBe(0);
    expect(p.walkAway).toBe(0);
    expect(p.reason).toContain("$0");
    expect(p.reason).not.toContain("expect to lose");
  });

  it("prices a defense at a dollar or two, not the QB streamer rate", () => {
    const def = priceClaim(cand({ position: "DEF", weekGain: 6 }), ctx());
    expect(def.walkAway).toBeLessThanOrEqual(2);
    expect(def.longShot).toBe(false);
  });

  it("does not call a one-dollar bid a long shot over a rounding gap", () => {
    const p = priceClaim(cand({ seasonPositionRank: 60 }), ctx({ observed: [{ tier: "stash", amount: 2 }] }));
    expect(p.longShot).toBe(false);
  });

  it("lifts an unranked player with a full role last week to multiweek", () => {
    expect(classifyClaim(cand({ seasonPositionRank: null, lastWeekSnaps: 48 }), ctx())).toBe("multiweek");
    expect(classifyClaim(cand({ seasonPositionRank: null, lastWeekSnaps: 12 }), ctx())).toBe("stash");
  });

  it("does not let the consensus turn a one-QB quarterback into starter money", () => {
    const qb = cand({ position: "QB", weekGain: 6, researchTier: "starter" });
    expect(classifyClaim(qb, ctx())).toBe("streamer");
    expect(classifyClaim(qb, ctx({ type: "dynasty", rosterPositions: DYNASTY_SLOTS }))).toBe("starter");
  });

  it("lets the week's consensus lift a tier but never lower one", () => {
    expect(classifyClaim(cand({ seasonPositionRank: 60, researchTier: "starter" }), ctx())).toBe("starter");
    expect(classifyClaim(cand({ seasonPositionRank: 10, researchTier: "stash" }), ctx())).toBe("winner");
  });

  it("folds the consensus bid into the market number", () => {
    const quiet = priceClaim(cand({ seasonPositionRank: 60, weekGain: 3 }), ctx());
    const loud = priceClaim(cand({ seasonPositionRank: 60, weekGain: 3, researchPercent: 40 }), ctx());
    expect(loud.marketExpected).toBeGreaterThan(quiet.marketExpected);
    expect(loud.reason).toContain("40% of budget");
  });

  it("treats K, DEF and a one-QB league's QB as streamers", () => {
    expect(classifyClaim(cand({ position: "DEF", weekGain: 2 }), ctx())).toBe("streamer");
    expect(classifyClaim(cand({ position: "QB", weekGain: 4, seasonPositionRank: 5 }), ctx())).toBe("streamer");
    expect(classifyClaim(cand({ position: "QB", weekGain: 0 }), ctx())).toBe("stash");
  });

  it("does not treat a superflex QB as a streamer", () => {
    const c = cand({ position: "QB", weekGain: 4, seasonPositionRank: 8 });
    expect(classifyClaim(c, ctx({ type: "dynasty", rosterPositions: DYNASTY_SLOTS }))).not.toBe("streamer");
  });
});

describe("priceClaim", () => {
  it("bids the market when it sits under the value ceiling", () => {
    // Every-week starter in redraft: prior 25% of $100. Market is the same
    // prior with no history, so the bid is that number nudged off round.
    const p = priceClaim(cand({ seasonPositionRank: 28, weekGain: 3 }), ctx());
    expect(p.tier).toBe("starter");
    expect(p.longShot).toBe(false);
    expect(p.bid).toBeGreaterThanOrEqual(20);
    expect(p.bid).toBeLessThanOrEqual(p.walkAway);
  });

  it("marks a long shot when the room is hotter than the player is worth to you", () => {
    const trending = new Map([["p", 1]]);
    const cold = priceClaim(cand({ seasonPositionRank: 60, weekGain: 3 }), ctx());
    const hot = priceClaim(cand({ seasonPositionRank: 60, weekGain: 3 }), ctx({ trending }));
    expect(hot.marketExpected).toBeGreaterThan(cold.marketExpected);
    expect(hot.longShot).toBe(true);
    expect(hot.bid).toBe(hot.walkAway);
    expect(hot.reason).toContain("expect to lose");
  });

  it("raises the ceiling for a losing team and lowers it for a winning one", () => {
    const c = cand({ seasonPositionRank: 28, weekGain: 3 });
    const losing = priceClaim(c, ctx({ record: { wins: 0, losses: 2 } }));
    const winning = priceClaim(c, ctx({ record: { wins: 2, losses: 0 } }));
    expect(losing.walkAway).toBeGreaterThan(winning.walkAway);
  });

  it("never bids past what is left after the reserve", () => {
    const p = priceClaim(cand({ seasonPositionRank: 5, weekGain: 8 }), ctx({ remaining: 14 }));
    // $14 left, $10 reserve until week 13.
    expect(p.walkAway).toBe(4);
    expect(p.bid).toBeLessThanOrEqual(4);
  });

  it("learns from the league's own winning bids", () => {
    const c = cand({ seasonPositionRank: 28, weekGain: 3 });
    const quiet = priceClaim(c, ctx());
    const rich = priceClaim(
      c,
      ctx({ observed: [{ tier: "starter", amount: 60 }, { tier: "starter", amount: 55 }] }),
    );
    expect(rich.marketExpected).toBeGreaterThan(quiet.marketExpected);
  });

  it("in dynasty, a rebuilder pays for youth and not for a veteran", () => {
    const base = ctx({ type: "dynasty", budget: 1000, remaining: 1000, rosterPositions: DYNASTY_SLOTS, trajectory: "rebuild" });
    const young = priceClaim(cand({ age: 22, seasonPositionRank: 28, weekGain: 3 }), base);
    const vet = priceClaim(cand({ age: 30, seasonPositionRank: 28, weekGain: 3 }), base);
    expect(young.walkAway).toBeGreaterThan(vet.walkAway * 3);
    expect(vet.reason).toContain("rebuilding");
  });

  it("in dynasty, a contender pays up for a veteran who starts now", () => {
    const base = ctx({ type: "dynasty", budget: 1000, remaining: 1000, rosterPositions: DYNASTY_SLOTS, trajectory: "contender" });
    const starting = priceClaim(cand({ age: 30, seasonPositionRank: 28, weekGain: 4 }), base);
    const benched = priceClaim(cand({ age: 30, seasonPositionRank: 28, weekGain: 0 }), base);
    expect(starting.walkAway).toBeGreaterThan(benched.walkAway);
  });

  it("ignores the standings for a rebuilder", () => {
    const base = ctx({ type: "dynasty", budget: 1000, remaining: 1000, rosterPositions: DYNASTY_SLOTS, trajectory: "rebuild" });
    const c = cand({ age: 22, seasonPositionRank: 28, weekGain: 3 });
    const a = priceClaim(c, { ...base, record: { wins: 0, losses: 2 } });
    const b = priceClaim(c, { ...base, record: { wins: 2, losses: 0 } });
    expect(a.walkAway).toBe(b.walkAway);
  });
});

describe("pacing", () => {
  it("keeps a redraft reserve until the playoffs are in sight", () => {
    expect(reserveFor(ctx({ week: 6 }))).toBe(10);
    expect(reserveFor(ctx({ week: 14 }))).toBe(0);
  });

  it("keeps nothing back for a dynasty rebuilder", () => {
    expect(reserveFor(ctx({ type: "dynasty", budget: 1000, trajectory: "rebuild" }))).toBe(0);
    expect(reserveFor(ctx({ type: "dynasty", budget: 1000, trajectory: "contender", week: 6 }))).toBe(120);
  });

  it("interpolates the redraft curve", () => {
    expect(paceTarget({ type: "redraft", week: 2, trajectory: null })).toBeCloseTo(0.27);
    expect(paceTarget({ type: "redraft", week: 3, trajectory: null })).toBeCloseTo(0.36);
    expect(paceTarget({ type: "redraft", week: 17, trajectory: null })).toBe(1);
  });

  it("runs a slower curve for a dynasty rebuilder than a contender", () => {
    const rebuild = paceTarget({ type: "dynasty", week: 8, trajectory: "rebuild" });
    const contend = paceTarget({ type: "dynasty", week: 8, trajectory: "contender" });
    expect(rebuild).toBeLessThan(contend);
  });

  it("says when you are behind pace and that unspent money is gone", () => {
    const p = pacingFor(ctx({ week: 8, remaining: 100 }));
    expect(p.note).toContain("gone");
    const q = pacingFor(ctx({ week: 2, remaining: 40 }));
    expect(q.note).toContain("Ahead of pace");
  });
});
