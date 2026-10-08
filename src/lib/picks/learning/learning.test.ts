import { describe, expect, it } from "vitest";
import { CRITERIA, seedHypotheses, validate } from "./model";
import { runReview, type ReviewInputs } from "./review";
import { memoryStore } from "./memory-store";
import type { ForecastSnapshot } from "../forecasts";
import { BASELINE_POLICY } from "../policy";

describe("protected acceptance criteria", () => {
  it("are pinned: the review cannot weaken its own test", () => {
    expect(CRITERIA).toEqual({
      MIN_OPPORTUNITIES: 30, MIN_WEEKS: 3, MIN_T: 1.645, CLV_MARGIN: 0.25, DRAWDOWN_RATIO: 1.25,
      CALIBRATION_MIN_BETS: 50, CALIBRATION_TOLERANCE: 0.05, ROLLBACK_MIN_OPPORTUNITIES: 20, MAX_COLLECTING: 24, MAX_NEW_PER_REVIEW: 2,
    });
  });
  it("the launch set fits the bound and every definition is a copy of a real cut", () => {
    const hs = seedHypotheses("2026-10-09T00:00:00Z");
    expect(hs.length).toBeLessThanOrEqual(CRITERIA.MAX_COLLECTING);
    expect(hs.filter((h) => h.actionable).every((h) => h.kind === "ats-cut" || h.kind === "stake-policy")).toBe(true);
  });
});

// Synthetic NFL weeks: home dogs where both models agree. Small dogs (+2.5,
// the "dog getting 3 or less" refinement) and big dogs (+8.5, the rest of the
// parent "agree on underdog").
function weekOf(week: number, t: string, smallWin: (i: number) => boolean, bigWin: (i: number) => boolean) {
  const snaps: ForecastSnapshot[] = [];
  const finals = new Map<string, { home: number; away: number }>();
  for (let i = 0; i < 12; i++) {
    const small = i < 8;
    const line = small ? 2.5 : 8.5;
    const home = `H${week}-${i}`;
    const away = `A${week}-${i}`;
    const kickoff = new Date(Date.parse(t) + 4 * 86400000).toISOString();
    snaps.push({ at: t, week, home, away, sam: { market: line, model: line - 3 }, david: { market: line, model: line - 2 }, ref: { line, source: "DraftKings via ESPN", fetchedAt: t, homePrice: -110, awayPrice: -110, kickoff } });
    const win = small ? smallWin(i) : bigWin(i);
    finals.set(`${week}:${away}@${home}`, win ? { home: 20, away: 21 } : { home: 3, away: 30 });
  }
  return { snaps, finals };
}

function inputs(weeks: ReturnType<typeof weekOf>[], now: string, overReplay = false): ReviewInputs {
  return {
    now: new Date(now),
    forecasts: [{ league: "nfl", snaps: weeks.flatMap((w) => w.snaps) }],
    finals: [{ league: "nfl", map: new Map(weeks.flatMap((w) => [...w.finals])) }],
    closes: [{ league: "nfl", map: new Map() }],
    issued: [],
    ruleTest: { nfl: { side: "dog" } },
    replay: async () => [{ league: "nfl", stakes: overReplay ? [10, 10] : [1.5, 1], weeklyRoom: 15, unpricedStakes: 0 }],
    history: async () => "units:+0.0 (frozen)",
  };
}

describe("rehearsal: ingest -> settle -> evaluate -> decide -> validate -> activate -> rollback", () => {
  it("runs the whole cycle and records every step", async () => {
    const store = memoryStore();
    // Review 0, before any evidence: registers the launch set, keeps baseline.
    const r0 = await runReview(store, inputs([], "2026-10-09T10:00:00Z"));
    expect(r0.registered.length).toBeGreaterThan(10);
    expect(r0.state.lastOutcome).toBe("no change: kept p1");
    expect(r0.decisions.find((d) => d.id === "nfl:ats:dog-band-a")?.why).toMatch(/insufficient evidence/);

    // Four weeks after registration: small dogs cover 7 of 8, big dogs 1 of 4.
    const good = [6, 7, 8, 9].map((w, k) => weekOf(w, `2026-10-${13 + 7 * k}T21:00:00Z`.replace("10-34", "11-03").replace("10-41", "11-10"), (i) => i !== 3, (i) => i === 9));
    const r1 = await runReview(store, inputs(good, "2026-11-11T10:00:00Z"));
    const d = r1.decisions.find((x) => x.id === "nfl:ats:dog-band-a")!;
    expect(d.verdict).toBe("promote");
    expect(r1.activated).toEqual({ from: "p1", to: "p2", hypothesis: "nfl:ats:dog-band-a" });
    expect((await store.active()).atsCandidates).toEqual(["dog-band-a"]);
    expect(r1.journal.find((j) => j.kind === "activate")?.rollbackTarget).toBe("p1");
    // Old versions stay frozen.
    expect((await store.version("p1"))).toEqual(BASELINE_POLICY);

    // After activation the refinement falls apart: small dogs lose, big dogs cover.
    const bad = [10, 11].map((w, k) => weekOf(w, `2026-11-${17 + 7 * k}T21:00:00Z`, () => false, () => true));
    const r2 = await runReview(store, inputs([...good, ...bad], "2026-12-01T10:00:00Z"));
    expect(r2.rolledBack?.to).toBe("p1");
    expect((await store.active()).id).toBe("p1");
    expect(store.dump().journal.map((j) => j.kind)).toEqual(expect.arrayContaining(["register", "activate", "rollback", "review"]));
  });

  it("a promotion that fails validation is retained, with the reason", async () => {
    const store = memoryStore();
    await runReview(store, inputs([], "2026-10-09T10:00:00Z"));
    const good = [6, 7, 8, 9].map((w, k) => weekOf(w, new Date(Date.parse("2026-10-13T21:00:00Z") + k * 7 * 86400000).toISOString(), (i) => i !== 3, (i) => i === 9));
    const r = await runReview(store, inputs(good, "2026-11-11T10:00:00Z", true));
    expect(r.activated).toBeUndefined();
    expect(r.journal.find((j) => j.kind === "retain")?.why).toMatch(/exceed the 15u room/);
    expect((await store.active()).id).toBe("p1");
  });

  it("a dry run writes nothing", async () => {
    const store = memoryStore();
    await runReview(store, inputs([], "2026-10-09T10:00:00Z"), { dryRun: true });
    expect(store.dump().hypotheses).toEqual([]);
    expect(store.dump().journal).toEqual([]);
  });

  it("validation catches a rewrite of history and an unpriced stake", () => {
    expect(validate({ policy: BASELINE_POLICY, replay: [], historyBefore: "a", historyAfter: "b" })).toContain("re-grading issued history changed under the new policy");
    expect(validate({ policy: BASELINE_POLICY, replay: [{ league: "nfl", stakes: [1], weeklyRoom: 15, unpricedStakes: 1 }], historyBefore: "a", historyAfter: "a" })[0]).toMatch(/no quoted price/);
  });
});

describe("bounded proposals", () => {
  it("never re-registers a definition already being tested, under any name", async () => {
    const { propose, seedHypotheses } = await import("./model");
    const hs = seedHypotheses("2026-10-09T00:00:00Z");
    const band = hs.find((h) => h.id === "nfl:ats:dog-band-a")!;
    const evals = [{ id: band.id, comparison: { n: 40, weeks: [1, 2, 3], meanDiff: 0.2, t: 2, challenger: {} as never, incumbent: {} as never } }];
    const first = propose(hs, evals, "2026-11-01T00:00:00Z");
    expect(first.length).toBeLessThanOrEqual(2);
    const again = propose([...hs, ...first], evals, "2026-11-08T00:00:00Z");
    const tests = [...hs, ...first, ...again].filter((h) => h.league === "nfl" && h.definition.kind === "ats-cut").map((h) => JSON.stringify((h.definition as { test: unknown }).test) + (h.definition as { parentId: string }).parentId);
    expect(new Set(tests).size).toBe(tests.length);
  });
});

