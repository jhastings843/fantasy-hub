import { describe, expect, it } from "vitest";
import { FTD_GATE, PROPS_GATE, activeIds, emptyState, evidence, register, review, reviewDue, sectionView, liveBets, tOf, type Bet, type Candidate, type Gate } from "./engine";
import { parentOf } from "../props/learn";

// Small gate so the tests can reach it.
const G: Gate = { ...PROPS_GATE, minGames: 4, minWeeks: 2, minBets: 8, rollbackGames: 3 };
const T0 = "2026-10-20T12:00:00.000Z";
const at = (day: number) => `2026-10-${String(20 + day).padStart(2, "0")}T17:00:00.000Z`;

/** Two bets per game, `games` games across two weeks, each game netting `net` split over its bets. */
function bets(games: number, net: (i: number) => number, start = 1): Bet[] {
  return Array.from({ length: games }, (_, i) => [0, 1].map((k) => ({ game: `g${start + i}`, week: 7 + (i % 2), at: at(start + i), net: net(i) / 2, toward: k ? 1 : 0 }))).flat();
}

describe("gates are pinned", () => {
  it("props and First TD", () => {
    expect(PROPS_GATE).toMatchObject({ minGames: 30, minWeeks: 3, minBets: 100, minT: 2.33, minPairedT: 1.645, maxNew: 2, rollbackGames: 20, rollbackT: 1.645 });
    expect(FTD_GATE).toMatchObject({ minGames: 60, minWeeks: 4, minBets: 60, minWins: 12, minT: 2.33, maxNew: 1, rollbackGames: 30 });
  });
});

describe("evidence", () => {
  it("judges per game, not per bet", () => {
    // Ten bets in ONE game all win: one unit of evidence, so it can't clear a 4-game gate.
    const c: Candidate = { id: "a", label: "A", bets: Array.from({ length: 10 }, () => ({ game: "g1", week: 7, at: at(1), net: 0.9 })) };
    const e = evidence(G, c, T0);
    expect(e).toMatchObject({ games: 1, bets: 10, ready: false });
    expect(e.checks.find((x) => x.name === "games")!.pass).toBe(false);
  });

  it("counts only games after registration", () => {
    const c: Candidate = { id: "a", label: "A", bets: [{ game: "old", week: 6, at: "2026-10-18T17:00:00.000Z", net: 5 }, ...bets(6, () => 1)] };
    expect(evidence(G, c, T0).games).toBe(6);
    expect(evidence(G, c, T0).units).toBe(6);
  });

  it("a refinement must beat its parent game by game", () => {
    const parent: Candidate = { id: "p:all", label: "Parent", bets: bets(8, (i) => 1 + (i % 3) * 0.1) };
    // Same games, same results: no better than the parent.
    const same: Candidate = { id: "p:x", label: "X", parent: "p:all", bets: parent.bets };
    const e = evidence(G, same, T0, parent);
    expect(e.pairedT).toBe(0);
    expect(e.ready).toBe(false);
  });

  it("t is capped and zero with no games", () => {
    expect(tOf([])).toBe(0);
    expect(tOf([1, 1, 1])).toBe(99);
  });
});

describe("review", () => {
  const good: Candidate = { id: "good", label: "Good", bets: bets(8, (i) => 1 + (i % 3) * 0.2) };
  const bad: Candidate = { id: "bad", label: "Bad", bets: bets(8, () => -1) };

  it("registers on first sight, then activates on later evidence, bounded per review", () => {
    // First review: registers both at T0. Their bets are all after T0, so the evidence is already there.
    const r1 = review(G, emptyState("t"), [good, bad], T0, 7);
    expect(r1.journal[0]).toMatchObject({ kind: "registered" });
    expect(r1.state.entries.good.status).toBe("active");
    expect(r1.state.entries.bad.status).toBe("collecting");
    expect(reviewDue(r1.state, 7)).toBe(false);
    expect(reviewDue(r1.state, 8)).toBe(true);
  });

  it("caps activations at maxNew, strongest first", () => {
    const cs = ["a", "b", "c"].map((id, k): Candidate => ({ id, label: id, bets: bets(8, (i) => 1 + k * 0.5 + (i % 2) * 0.3) }));
    const r = review({ ...G, maxNew: 2 }, emptyState("t"), cs, T0, 7);
    expect(Object.values(r.state.entries).filter((e) => e.status === "active").map((e) => e.id).sort()).toEqual(["b", "c"]);
  });

  it("skips a refinement whose parent is already live", () => {
    const parent: Candidate = { id: "p:all", label: "P", bets: bets(8, (i) => 1 + (i % 2) * 0.3) };
    const r1 = review(G, emptyState("t"), [parent], T0, 7);
    expect(r1.state.entries["p:all"].status).toBe("active");
    const child: Candidate = { id: "p:x", label: "X", parent: "p:all", bets: bets(8, (i) => 3 + (i % 2) * 0.3, 20) };
    const r2 = review(G, r1.state, [{ ...parent, bets: [...parent.bets, ...bets(8, () => 0.1, 20)] }, child], "2026-10-21T00:00:00.000Z", 8);
    expect(r2.state.entries["p:x"].status).toBe("collecting");
  });

  it("rolls back a live slice that loses after going live, and journals it", () => {
    const r1 = review(G, emptyState("t"), [good], T0, 7);
    const later: Candidate = { ...good, bets: [...good.bets, ...bets(4, (i) => -1 - i * 0.1, 30)] };
    const r2 = review(G, r1.state, [later], "2026-11-01T00:00:00.000Z", 9);
    // Activated at T0, so its whole record counts as live: +8ish then the losses; t on per-game nets is still positive.
    expect(r2.state.entries.good.status).toBe("active");
    // Activated at a time after the winning games: only the losses count.
    const fromLate = { ...r1.state, entries: { good: { ...r1.state.entries.good, activatedAt: "2026-10-31T00:00:00.000Z" } } };
    const r3 = review(G, fromLate, [later], "2026-11-30T00:00:00.000Z", 12);
    expect(r3.state.entries.good).toMatchObject({ status: "rolled-back", endedWeek: 12 });
    expect(r3.journal.some((j) => j.kind === "rolled back")).toBe(true);
  });

  it("always journals a review line", () => {
    const r = review(G, emptyState("t"), [], T0, 7);
    expect(r.journal.at(-1)).toMatchObject({ kind: "review" });
  });
});

describe("views", () => {
  it("shows the live record and feeds the money chart only from activation", () => {
    const c: Candidate = { id: "good", label: "Good", bets: bets(8, (i) => 1 + (i % 3) * 0.2) };
    const r = review(G, emptyState("t"), [c], T0, 7);
    const v = sectionView(G, r.state, [c], r.journal);
    expect(v.entries[0].live).toMatchObject({ games: 8, bets: 16 });
    const lateState = { ...r.state, entries: { good: { ...r.state.entries.good, activatedAt: at(5) } } };
    expect(liveBets(lateState, [c]).every((b) => b.at >= at(5))).toBe(true);
  });
});

describe("props parents", () => {
  it("maps each slice to the broader one it narrows", () => {
    expect(parentOf("play:all")).toBeUndefined();
    expect(parentOf("play:rec_yds")).toBe("play:all");
    expect(parentOf("lean:noplay")).toBe("lean:all");
    expect(parentOf("dplay:all")).toBe("dboard:all");
    expect(parentOf("dplay:receptions")).toBe("dplay:all");
    expect(parentOf("h2h:david")).toBeUndefined();
    expect(parentOf("h2h:agree")).toBe("h2h:david");
    expect(parentOf("h2h:split-sam")).toBe("h2h:sam");
  });
});

describe("slices change between reviews", () => {
  // First TD, Oct 26: slices renamed for best-price grading mid-week. The new ones waited for the next
  // weekly review, and the log showed the retired Kalshi slices at 0 games in the meantime.
  const old: Candidate = { id: "k:value", label: "Our chance above Kalshi's cost", bets: [] };
  const fresh: Candidate = { id: "b:value", label: "Every value bet, best price", bets: bets(3, () => 1) };
  const reviewed = review(G, emptyState("t"), [old], T0, 8).state;

  it("registers new slices on any pull, without counting as the week's review", () => {
    const r = register(reviewed, [fresh], at(1), 8);
    expect(r.state.entries["b:value"]).toMatchObject({ status: "collecting", registeredAt: at(1), registeredWeek: 8 });
    expect(r.state.lastReviewWeek).toBe(8);
    expect(r.state.lastReviewAt).toBe(T0);
    expect(r.state.entries["k:value"]).toBeUndefined();
    expect(r.journal.map((j) => j.text)).toEqual([
      "Registered 1 slice; only games after today count toward them.",
      "Retired 1 slice no longer defined: Our chance above Kalshi's cost.",
    ]);
    // A failed read (no candidates) retires nothing.
    expect(register(reviewed, [], at(1), 8).state.entries["k:value"]).toBeDefined();
    expect(register(r.state, [fresh], at(2), 8).journal).toEqual([]);
  });

  it("the log hides a collecting slice whose definition is gone, but keeps a live one", () => {
    const s = register(reviewed, [fresh], at(1), 8).state;
    const withLive = { ...s, entries: { ...s.entries, "k:gone": { ...s.entries["k:value"], id: "k:gone", status: "active" as const, activatedAt: T0 } } };
    const ids = sectionView(G, withLive, [fresh], []).entries.map((e) => e.id);
    expect(ids).toEqual(["b:value", "k:gone"]);
  });
});

describe("reviews every slate, activations capped per week", () => {
  const ready: Candidate[] = ["a", "b", "c"].map((id) => ({ id, label: id.toUpperCase(), bets: bets(8, () => 1) }));
  const one: Gate = { ...G, maxNew: 1 };

  it("is due again on a new slate in the same week", () => {
    const s = review(one, emptyState("t"), ready, T0, 8, "2026-10-20").state;
    expect(reviewDue(s, 8, "2026-10-20")).toBe(false);
    expect(reviewDue(s, 8, "2026-10-21")).toBe(true);
    expect(reviewDue(s, 9)).toBe(true);
  });

  it("a second review in the week can't go past the week's cap", () => {
    const r1 = review(one, emptyState("t"), ready, T0, 8, "2026-10-20");
    const r2 = review(one, r1.state, ready, at(12), 8, "2026-11-01");
    const active = (s: typeof r2.state) => Object.values(s.entries).filter((e) => e.status === "active").length;
    expect(active(r1.state)).toBe(1);
    expect(active(r2.state)).toBe(1);
    // Next week the cap resets.
    expect(active(review(one, r2.state, ready, at(13), 9, "2026-11-02").state)).toBe(active(r1.state) + 1);
  });
});

describe("weekly loss cap", () => {
  const cap: Gate = { ...G, maxNew: 1, weeklyLossCap: 5 };
  const winner: Candidate = { id: "w", label: "W", bets: bets(8, () => 1) };

  it("a live slice that loses the cap in a week pauses until the next week's first review", () => {
    const live = review(cap, emptyState("t"), [winner], T0, 8, "2026-10-20").state;
    expect(live.entries.w.status).toBe("active");
    // Week 9: six straight 1u losses after it went live.
    const losing: Candidate = { ...winner, bets: [...winner.bets, ...Array.from({ length: 6 }, (_, i) => ({ game: `L${i}`, week: 9, at: at(9), net: -1 }))] };
    const hit = review(cap, live, [losing], at(10), 9, "2026-10-30");
    expect(hit.state.entries.w).toMatchObject({ status: "active", pausedWeek: 9 });
    expect(hit.journal.map((j) => j.text).join(" ")).toMatch(/Paused W/);
    expect(sectionView(cap, hit.state, [losing], []).entries.find((e) => e.id === "w")!.status).toBe("paused");
    expect(activeIds(hit.state)).toEqual([]);
    // Week 10's first review lifts it.
    const next = review(cap, hit.state, [losing], at(17), 10, "2026-11-06").state;
    expect(next.entries.w.pausedWeek).toBeUndefined();
    expect(activeIds(next)).toEqual(["w"]);
  });

  it("every gate has a cap", () => {
    expect(PROPS_GATE.weeklyLossCap).toBe(10);
    expect(FTD_GATE.weeklyLossCap).toBe(15);
  });
});
