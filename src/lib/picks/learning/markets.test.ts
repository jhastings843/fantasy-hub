import { describe, expect, it } from "vitest";
import { applyPromotion, decide, evaluate, laterHypotheses, scoreSu, scoreTotal, sourcePairs, type Hypothesis, type Opportunity } from "./model";
import { tierBoard } from "../engine";
import { BASELINE_POLICY, SOURCE_DEFAULT, SU_DEFAULT, sourceState, suInForce, totalsAllowed } from "../policy";
import { totalsBacktest } from "../totals";
import type { ForecastSnapshot } from "../forecasts";

// Totals and straight up on the same loop as the spread side (2026-10-20).

const snap = (o: Partial<ForecastSnapshot> = {}): ForecastSnapshot => ({
  at: "2026-10-22T12:00:00Z",
  week: 8,
  home: "KC",
  away: "LV",
  sam: { model: -7, market: -6 },
  david: { model: -5, market: -6 },
  samTotal: 50,
  davidTotal: 49,
  ref: { line: -6, total: 45, homePrice: -110, awayPrice: -110, overPrice: -110, underPrice: -110, kickoff: "2026-10-25T17:00:00Z", source: "test", fetchedAt: "" } as ForecastSnapshot["ref"],
  ...o,
});
const opp = (final: { home: number; away: number }, s = snap(), i = 0): Opportunity => ({
  league: "nfl",
  week: 8 + (i % 3),
  home: "KC",
  away: `T${i}`,
  key: `k${i}`,
  first: { ...s, at: `2026-10-${String(22 + (i % 6)).padStart(2, "0")}T12:00:00Z` },
  last: s,
  final,
});

describe("scoring", () => {
  it("totals: both over 45, at the quoted over price", () => {
    expect(scoreTotal({}, snap(), opp({ home: 30, away: 20 }))).toMatchObject({ bet: true, result: "W" });
    expect(scoreTotal({}, snap(), opp({ home: 20, away: 20 }))).toMatchObject({ bet: true, units: -1 });
    // The under-only cut skips an over read.
    expect(scoreTotal({ side: "under" }, snap(), opp({ home: 20, away: 20 })).bet).toBe(false);
    // No over price, no bet.
    expect(scoreTotal({}, snap({ ref: { ...snap().ref!, overPrice: undefined } }), opp({ home: 30, away: 20 })).bet).toBe(false);
  });

  it("straight up: +1 right, -1 wrong, nothing on a tie", () => {
    // Home favored by every method here; home wins.
    expect(scoreSu("avg", opp({ home: 24, away: 17 }))).toMatchObject({ units: 1 });
    expect(scoreSu("vegas", opp({ home: 17, away: 24 }))).toMatchObject({ units: -1 });
    expect(scoreSu("avg", opp({ home: 20, away: 20 })).bet).toBe(false);
  });
});

describe("hypotheses", () => {
  const hs = laterHypotheses("2026-10-20T11:00:00Z");
  it("registers totals refinements against agreement and every straight-up method, per league", () => {
    expect(hs.map((h) => h.id)).toEqual(
      expect.arrayContaining(["nfl:ou:t-over", "nfl:ou:t-under", "nfl:ou:t-both-3", "cfb:ou:t-both-5", "nfl:su:sam", "nfl:su:vegas", "cfb:su:avg", "cfb:su:david"]),
    );
    expect(hs.filter((h) => h.kind === "totals-cut" || h.kind === "su-method").every((h) => h.actionable)).toBe(true);
    expect(hs.some((h) => h.id.endsWith(":ou:t-agree"))).toBe(false);
  });

  it("a method already in force compares with nothing", () => {
    const h = hs.find((x) => x.id === "nfl:su:avg")!;
    expect(evaluate(h, { opps: [], issued: [], active: BASELINE_POLICY, ruleTest: {} }).note).toMatch(/in force/);
  });

  it("a straight-up challenger that wins game by game is promoted and switches the method", () => {
    const h = hs.find((x) => x.id === "nfl:su:sam")!;
    // Sam picks the road side, the average picks home; road wins 30 of 34.
    const s = snap({ sam: { model: 2, market: -6 }, david: { model: -9, market: -6 } });
    const opps = Array.from({ length: 34 }, (_, i) => opp(i < 30 ? { home: 10, away: 20 } : { home: 20, away: 10 }, s, i));
    const e = evaluate(h, { opps, issued: [], active: BASELINE_POLICY, ruleTest: {} });
    const d = decide(h, e, { calibration: { n: 0, meanP: 0, winRate: 0, brier: 0, calibrated: false }, active: BASELINE_POLICY });
    expect(d.verdict).toBe("promote");
    const next = applyPromotion(BASELINE_POLICY, h, "p9", "2026-11-10T00:00:00Z");
    expect(suInForce(next, "nfl")).toBe("sam");
    expect(suInForce(next, "cfb")).toBe(SU_DEFAULT.cfb);
  });

  it("a totals promotion makes that cut eligible for the rule, in its league only", () => {
    const h = hs.find((x) => x.id === "nfl:ou:t-under") as Hypothesis;
    const next = applyPromotion(BASELINE_POLICY, h, "p9", "2026-11-10T00:00:00Z");
    expect([...totalsAllowed(next, "nfl")].sort()).toEqual(["t-agree", "t-under"]);
    expect([...totalsAllowed(next, "cfb")]).toEqual(["t-agree"]);
  });
});

describe("totals rule only from allowed cuts", () => {
  it("a qualifying refinement is not the rule until it is activated", () => {
    // 12 games both models under (all under), 3 both over (all under too): agreement 12-3, the under cut 12-0.
    const seen = Array.from({ length: 15 }, (_, i) => ({ week: 5 + (i % 3), home: "KC", away: `T${i}`, sam: i < 12 ? 40 : 52, david: i < 12 ? 41 : 53, line: 46, source: "", seenAt: "" }));
    const keyOf = (g: { week: number; home: string; away: string }) => `${g.week}|${g.home}|${g.away}`;
    const finals = new Map(seen.map((g) => [keyOf(g), 38]));
    const all = totalsBacktest("nfl", seen, finals, [], new Map(), keyOf);
    const gated = totalsBacktest("nfl", seen, finals, [], new Map(), keyOf, new Set(["t-agree"]));
    expect(all.rule?.id).toBe("t-under");
    expect(gated.rule?.id).toBe("t-agree");
  });
});

describe("PEM and Harris: added or dropped on forward evidence", () => {
  const hs = laterHypotheses("2026-10-20T11:00:00Z");
  const cmp = (t: number, meanDiff: number) => ({ n: 34, weeks: [8, 9, 10], meanDiff, t, challenger: { bets: 20, units: 2, risked: 20, roi: 0.1, clv: null, clvN: 0, drawdown: 2 }, incumbent: { bets: 34, units: -1, risked: 34, roi: 0, clv: null, clvN: 0, drawdown: 4 } });
  const cal = { n: 0, meanP: 0, winRate: 0, brier: 0, calibrated: false };

  it("registers a standing question for each, college only", () => {
    expect(hs.filter((h) => h.kind === "source").map((h) => h.id).sort()).toEqual(["cfb:source:harris", "cfb:source:pem"]);
    expect(SOURCE_DEFAULT).toEqual({ pem: "cuts", harris: "out" });
  });

  it("a clear gain from skipping its disagreements adds it as a veto; a clear loss drops it", () => {
    const harris = hs.find((h) => h.id === "cfb:source:harris")!;
    const add = decide(harris, { id: harris.id, comparison: cmp(2.1, 0.2) }, { calibration: cal, active: BASELINE_POLICY });
    expect(add).toMatchObject({ verdict: "promote", to: "veto" });
    const p = applyPromotion(BASELINE_POLICY, harris, "p9", "2026-11-10T00:00:00Z", add.to);
    expect(sourceState(p, "harris")).toBe("veto");
    expect(p.sourcesChangedAt?.harris).toBe("2026-11-10T00:00:00Z");
    // Later, from veto, a clear loss drops him.
    const drop = decide(harris, { id: harris.id, comparison: cmp(-1.9, -0.2) }, { calibration: cal, active: p });
    expect(drop).toMatchObject({ verdict: "promote", to: "out" });
    // A gain while already a veto changes nothing.
    expect(decide(harris, { id: harris.id, comparison: cmp(2.1, 0.2) }, { calibration: cal, active: p }).verdict).toBe("retain");
    // PEM starts at cuts: a loss drops it to out.
    const pem = hs.find((h) => h.id === "cfb:source:pem")!;
    expect(decide(pem, { id: pem.id, comparison: cmp(-2, -0.3) }, { calibration: cal, active: BASELINE_POLICY })).toMatchObject({ verdict: "promote", to: "out" });
    // Too few games: no move either way.
    expect(decide(pem, { id: pem.id, comparison: { ...cmp(-3, -0.5), n: 12 } }, { calibration: cal, active: BASELINE_POLICY }).verdict).toBe("retain");
  });

  it("scores the veto per rule bet: a disagreement is skipped, the rest bet as before", () => {
    // Sam -9 and David -8 against -6: both on home. PEM -2: away. Harris -10: home.
    const s = snap({ sam: { model: -9, market: -6 }, david: { model: -8, market: -6 }, pem: { model: -2, market: -6 } });
    const o = { ...opp({ home: 20, away: 17 }, s), league: "cfb" as const };
    const [pair] = sourcePairs("pem", {}, [o]);
    expect(pair.inc.bet).toBe(true);
    expect(pair.ch.bet).toBe(false);
    const [h] = sourcePairs("harris", {}, [o], new Map([[o.key, -10]]));
    expect(h.ch.bet).toBe(true);
  });

  it("the board skips a rule bet a veto source disagrees with, and says who", () => {
    const row = { home: "KC", away: "LV", sam: { model: -9, market: -6 }, david: { model: -8, market: -6 }, pem: { model: -2, market: -6 }, harris: -10 };
    const s = { rule: { id: "agree", label: "Both agree", test: {}, record: { w: 10, l: 2, p: 0, pct: 0.8, lo: 0.6, hi: 0.9, units: 7 } }, second: null } as unknown as Parameters<typeof tierBoard>[2];
    expect(tierBoard("cfb", [row], s)[0].tier).toBe("t1");
    expect(tierBoard("cfb", [row], s, "avg", { pem: true })[0]).toMatchObject({ vetoedBy: "PEM" });
    expect(tierBoard("cfb", [row], s, "avg", { harris: true })[0].tier).toBe("t1");
  });
});

describe("Harris veto on a PEM split pick (Astra, 2026-10-20)", () => {
  it("skips PEM's side when Harris is a veto and disagrees", () => {
    // Sam home, David away; PEM home. Harris away.
    const row = { home: "KC", away: "LV", sam: { model: -9, market: -6 }, david: { model: -2, market: -6 }, pem: { model: -10, market: -6 }, harris: -1 };
    const s = { rule: { id: "pem-split", label: "PEM's side", test: { pemSplit: true }, record: { w: 10, l: 2, p: 0, pct: 0.8, lo: 0.6, hi: 0.9, units: 7 } }, second: null } as unknown as Parameters<typeof tierBoard>[2];
    expect(tierBoard("cfb", [row], s)[0].tier).toBe("t1");
    expect(tierBoard("cfb", [row], s, "avg", { harris: true })[0]).toMatchObject({ tier: "split", vetoedBy: "Harris" });
  });
});

describe("public betting and line moves (report only)", () => {
  // Sam -7, David -5 at KC -6: models split, so use both on KC -9 / -8 to make KC (home) the rule side.
  const ours = snap({ sam: { model: -9, market: -6 }, david: { model: -8, market: -6 } });
  const at = "2026-10-22T12:00:00Z";
  const withSplits = (splits: ForecastSnapshot["splits"]) => ({ ...opp({ home: 30, away: 20 }, { ...ours, splits }), splitsRead: { ...ours, splits } });

  it("reads splits only in the last 90 minutes before kickoff (2026-10-27)", async () => {
    const { opportunities } = await import("./model");
    const kick = "2026-10-25T17:00:00Z";
    const read = (at: string, homeTickets: number) => ({ ...ours, at, splits: { homeTickets, homeMoney: homeTickets, at } });
    const [early] = opportunities("nfl", [read("2026-10-25T13:00:00Z", 80)], new Map(), new Map());
    expect(early.splitsRead).toBeUndefined();
    const [late] = opportunities("nfl", [read("2026-10-25T13:00:00Z", 80), read("2026-10-25T16:15:00Z", 55), { ...ours, at: "2026-10-25T16:45:00Z" }], new Map(), new Map());
    expect(late.splitsRead?.splits?.homeTickets).toBe(55);
    expect(late.last.ref?.kickoff).toBe(kick);
  });

  it("registers three report-only hypotheses per league", async () => {
    const { laterHypotheses: later } = await import("./model");
    const hs = later("2026-10-21T11:00:00Z").filter((h) => h.kind === "market");
    expect(hs.map((h) => h.id).sort()).toEqual(["cfb:mkt:public-ours", "cfb:mkt:rlm-against", "cfb:mkt:sharp-against", "nfl:mkt:public-ours", "nfl:mkt:rlm-against", "nfl:mkt:sharp-against"]);
    expect(hs.every((h) => !h.actionable)).toBe(true);
  });

  it("skips a rule bet when the line moved toward the side the tickets are against, and it is not ours", async () => {
    const { marketPairs } = await import("./model");
    // KC opened -8, now -6: moved toward LV while 70% of tickets are on KC -> RLM on LV, against us.
    const [p] = marketPairs("rlm-against", "nfl", {}, [withSplits({ homeTickets: 70, homeMoney: 60, open: -8, at })]);
    expect(p.inc.bet).toBe(true);
    expect(p.ch.bet).toBe(false);
    // Same move with the public on LV is not RLM: the bet stands.
    const [q] = marketPairs("rlm-against", "nfl", {}, [withSplits({ homeTickets: 30, homeMoney: 30, open: -8, at })]);
    expect(q.ch.bet).toBe(true);
  });

  it("public-ours and sharp-against fire on their own reads, and no splits means no change", async () => {
    const { marketPairs } = await import("./model");
    expect(marketPairs("public-ours", "nfl", {}, [withSplits({ homeTickets: 72, homeMoney: 70, at })])[0].ch.bet).toBe(false);
    expect(marketPairs("sharp-against", "nfl", {}, [withSplits({ homeTickets: 60, homeMoney: 45, at })])[0].ch.bet).toBe(false);
    expect(marketPairs("sharp-against", "nfl", {}, [withSplits({ homeTickets: 45, homeMoney: 60, at })])[0].ch.bet).toBe(true);
    const [none] = marketPairs("public-ours", "nfl", {}, [opp({ home: 30, away: 20 }, ours)]);
    expect(none.ch).toEqual(none.inc);
  });
});
