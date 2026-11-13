import { describe, expect, it } from "vitest";
import { ATTD_GATE, FB_GATE, FTD_GATE, PROPS_GATE, emptyState, liveBets, register, review, stakeAt, tOf, type Bet, type Candidate, type Gate } from "./engine";
import { liveStake } from "../props/staked-core";

// Probation (Jack, 2026-11-13): long-price slices go live at 0.25u from t 1.0,
// move to full stake at the real bar, and stop if they fall below even.
const G: Gate = { ...PROPS_GATE, minGames: 4, minWeeks: 2, minBets: 8, minT: 3, probation: { minT: 1, stake: 0.25 } };
const T0 = "2026-10-20T12:00:00.000Z";
const at = (i: number) => new Date(Date.parse("2026-10-21T17:00:00.000Z") + i * 86_400_000).toISOString();

/** Two bets per game; game i nets nets[i] split over its bets. */
const bets = (nets: number[], from = 0): Bet[] =>
  nets.flatMap((n, i) => [0, 1].map((k) => ({ game: `g${from + i}`, key: `g${from + i}|${k}`, week: 7 + ((from + i) % 2), at: at(from + i), net: n / 2, toward: k })));

const MID = [2, -1, 2, -1, 2, -1, 2, 2]; // t 1.59: past 1, short of 3
const start = () => register(emptyState("s"), [{ id: "a", label: "A", bets: [] }], T0, 7).state;
const cand = (b: Bet[]): Candidate[] => [{ id: "a", label: "A", bets: b }];

describe("probation", () => {
  it("pins the two gates that use it, and leaves First TD alone", () => {
    expect(ATTD_GATE).toMatchObject({ minT: 1.645, probation: { minT: 1, stake: 0.25 } });
    expect(FB_GATE).toMatchObject({ minGames: 60, minWins: 12, minT: 1.645, probation: { minT: 1, stake: 0.25 } });
    expect(FTD_GATE.minT).toBe(1.96);
    expect(FTD_GATE.probation).toBeUndefined();
  });

  it("goes live at 0.25u when only t is short and t is 1+", () => {
    expect(tOf(MID)).toBeGreaterThan(1);
    const b = bets(MID);
    const r = review(G, start(), cand(b), "2026-11-01T12:00:00.000Z", 9);
    expect(r.state.entries.a).toMatchObject({ status: "active", probation: { stake: 0.25 } });
    expect(r.journal.find((j) => j.kind === "activated")!.text).toContain("at 0.25u (probation)");
  });

  it("stays out below t 1, and a gate without probation still needs the full bar", () => {
    const weak = bets([2, -1, 2, -1, 2, -1, 2, -1]); // t 0.88
    expect(review(G, start(), cand(weak), "2026-11-01T12:00:00.000Z", 9).state.entries.a.status).toBe("collecting");
    const b = bets(MID);
    const { probation: _, ...plain } = G;
    void _;
    expect(review(plain, start(), cand(b), "2026-11-01T12:00:00.000Z", 9).state.entries.a.status).toBe("collecting");
  });

  it("moves to full stake once it passes the real bar; earlier bets stay at 0.25u", () => {
    const b = bets(MID);
    const live = review(G, start(), cand(b), "2026-11-01T12:00:00.000Z", 9).state;
    const more = [...b, ...bets(Array(12).fill(1.5), 20)];
    const r = review(G, live, cand(more), "2026-11-20T12:00:00.000Z", 10);
    expect(r.state.entries.a.probation?.until).toBe("2026-11-20T12:00:00.000Z");
    expect(r.journal.some((j) => j.text.startsWith("Promoted A to full stake"))).toBe(true);
    expect(stakeAt(r.state.entries.a, "2026-11-10T00:00:00.000Z")).toBe(0.25);
    expect(stakeAt(r.state.entries.a, "2026-11-21T00:00:00.000Z")).toBe(1);
  });

  it("stops when its t since registering falls below 0", () => {
    const b = bets(MID);
    const live = review(G, start(), cand(b), "2026-11-01T12:00:00.000Z", 9).state;
    const worse = [...b, ...bets(Array(10).fill(-1), 20)];
    const r = review(G, live, cand(worse), "2026-11-20T12:00:00.000Z", 10);
    expect(r.state.entries.a.status).toBe("rolled-back");
    expect(r.state.entries.a.reason).toContain("on probation");
  });

  it("the money record counts probation bets at their stake, each bet once at the bigger stake", () => {
    const b = bets([2, 2], 20); // after activation
    const s = {
      ...emptyState("s"),
      entries: {
        a: { id: "a", label: "A", status: "active" as const, registeredAt: T0, registeredWeek: 7, activatedAt: T0, probation: { stake: 0.25 } },
        c: { id: "c", label: "C", status: "active" as const, registeredAt: T0, registeredWeek: 7, activatedAt: T0 },
      },
    };
    expect(liveBets(s, [{ id: "a", label: "A", bets: b }, { id: "c", label: "C", bets: [] }]).reduce((x, y) => x + y.net, 0)).toBe(1);
    expect(liveBets(s, [{ id: "a", label: "A", bets: b }, { id: "c", label: "C", bets: b }]).reduce((x, y) => x + y.net, 0)).toBe(4);
  });

  it("a staked play takes 1u when any live slice keeping it is at full stake", () => {
    const e = (id: string, probation?: { stake: number; until?: string }) => ({ id, label: id, status: "active" as const, activatedAt: T0, ...(probation ? { probation } : {}) });
    expect(liveStake([e("a", { stake: 0.25 })], at(3), () => true)).toBe(0.25);
    expect(liveStake([e("a", { stake: 0.25 }), e("b")], at(3), () => true)).toBe(1);
    expect(liveStake([e("a", { stake: 0.25 }), e("b")], at(3), (id) => id === "a")).toBe(0.25);
    expect(liveStake([e("a", { stake: 0.25, until: at(1) })], at(3), () => true)).toBe(1);
  });
});
