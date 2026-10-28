import { describe, expect, it } from "vitest";
import { CfbModel, PointsRatings, phi, projectedScore, type CfbParams, type CfbResult } from "./model";
import { CFB_SLICES, cfbCandidates, clvOf, coverMargin, foldRead, forwardRecord, gameKey, liveSlicesFor, signalOf, type CfbSnap, type CfbTracked } from "./track";
import PARAMS from "./params.json";

const P: CfbParams = {
  rating: { hfa: 3, kPerf: 0.3, cap: 60, carryPerf: 1, hfaMkt: 3, kMkt: 0.5, carryMkt: 1 },
  points: { hfa: 3, k: 0.15, cap: 28, carry: 0.6 },
  sigma: 17.5,
};
const res = (o: Partial<CfbResult>): CfbResult => ({ id: "1", season: 2026, date: "2026-09-05", home: "alabama", away: "georgia", homeScore: 30, awayScore: 20, neutral: false, ...o });

describe("college model", () => {
  it("phi is the standard normal CDF", () => {
    expect(phi(0)).toBeCloseTo(0.5, 6);
    expect(phi(1.96)).toBeCloseTo(0.975, 3);
    expect(phi(-1)).toBeCloseTo(0.1587, 3);
  });

  it("projected score splits the total by the margin", () => {
    const p = projectedScore(7, 55, 17.5);
    expect(p).toMatchObject({ margin: 7, spread: -7, total: 55, homePts: 31, awayPts: 24 });
    expect(p.homeWin).toBeGreaterThan(0.6);
    expect(projectedScore(0, 50, 17.5).homeWin).toBe(0.5);
  });

  it("an unrated game is home field only, none at a neutral site", () => {
    const m = new CfbModel(P);
    expect(m.project({ season: 2026, home: "a", away: "b", neutral: false }).margin).toBe(3);
    expect(m.project({ season: 2026, home: "a", away: "b", neutral: true }).margin).toBe(0);
  });

  it("a win moves the margin rating toward the winner, capped", () => {
    const m = CfbModel.from(P, [res({ homeScore: 45, awayScore: 10 })]);
    const p = m.project({ season: 2026, home: "alabama", away: "georgia", neutral: true });
    // miss 35 - 3 = 32, k 0.3: each side moves 4.8, so 9.6 apart.
    expect(p.margin).toBeCloseTo(9.6, 1);
  });

  it("points ratings learn offense and defense, carried into a new season", () => {
    const r = new PointsRatings(P.points);
    r.add(res({ homeScore: 60, awayScore: 0, neutral: true }));
    const e = r.expect(2026, "alabama", "georgia", true);
    expect(e.home).toBeGreaterThan(e.away);
    const next = r.expect(2027, "alabama", "georgia", true);
    expect(next.home - next.away).toBeLessThan(e.home - e.away);
  });

  it("the fitted params load and project", () => {
    const m = new CfbModel(PARAMS as CfbParams);
    expect(Number.isFinite(m.project({ season: 2026, home: "a", away: "b", neutral: false }).total)).toBe(true);
  });
});

const proj = (spread: number, total = 55) => projectedScore(-spread, total, 17.5);
const snap = (o: Partial<CfbSnap> & { spread: number }): CfbSnap => ({ at: "2026-10-27T12:00:00Z", line: -3, total: 52, proj: proj(o.spread), ...o });
const tracked = (o: Partial<CfbTracked> & { spread?: number; line?: number; open?: number }): CfbTracked => {
  const s = snap({ spread: o.spread ?? -7, line: o.line ?? -3, ...(o.open !== undefined ? { open: o.open } : {}) });
  return { week: 9, home: "alabama", away: "georgia", kickoff: "2026-10-31T19:30:00Z", neutral: false, conf: true, first: s, last: s, ...o };
};

describe("college model tracking", () => {
  it("first read sticks, later pregame reads replace the last, reads after kickoff never count", () => {
    const base = { week: 9, home: "a", away: "b", kickoff: "2026-10-31T19:30:00Z", neutral: false, conf: true };
    const a = foldRead(undefined, base, snap({ spread: -7, at: "2026-10-27T12:00:00Z" }))!;
    expect(a.first).toBe(a.last);
    expect(foldRead(a, base, snap({ spread: -7, at: "2026-10-27T13:00:00Z" }))).toBeNull();
    const b = foldRead(a, base, snap({ spread: -7, line: -4, at: "2026-10-28T12:00:00Z" }))!;
    expect(b.first.line).toBe(-3);
    expect(b.last.line).toBe(-4);
    expect(foldRead(b, base, snap({ spread: -9, at: "2026-10-31T20:00:00Z" }))).toBeNull();
  });

  it("signals: side, edge, favorite, line move, total", () => {
    // ours home -7, line home -3: we like home by 4, home is the favorite.
    const s = signalOf(tracked({ spread: -7, line: -3, open: -2 }))!;
    expect(s).toMatchObject({ side: "home", edge: 4, fav: true, withMove: true });
    expect(s.total).toEqual({ side: "over", edge: 3 });
    // ours home +2, line home -3: we like away (the dog) by 5; line went from -4 to -3, toward away.
    expect(signalOf(tracked({ spread: 2, line: -3, open: -4 }))).toMatchObject({ side: "away", edge: 5, fav: false, withMove: true });
    expect(signalOf(tracked({ spread: 2, line: -3, open: -2 }))?.withMove).toBe(false);
    expect(signalOf(tracked({ spread: -3, line: -3 }))).toBeNull();
  });

  it("grades cover margins and CLV from each side", () => {
    expect(coverMargin("home", -3, { home: 30, away: 20 })).toBe(7);
    expect(coverMargin("away", -3, { home: 30, away: 20 })).toBe(-7);
    expect(clvOf("home", -3, -5)).toBe(2);
    expect(clvOf("away", -3, -5)).toBe(-2);
  });

  it("candidates: one bet per game per slice at -110, fades the other side, only finals", () => {
    const won = tracked({ spread: -12, line: -3, final: { home: 30, away: 20 } });
    const open = tracked({ home: "x", away: "y", spread: -12, line: -3 });
    const closes = new Map([[gameKey(won), { open: -2, close: -5, totalClose: 54 }]]);
    const c = new Map(cfbCandidates([won, open], closes).map((x) => [x.id, x]));
    expect(c.get("cfbm:lean")!.bets).toEqual([{ game: "9|alabama|georgia", key: "9|alabama|georgia|home", week: 9, at: won.kickoff, net: 0.909, toward: 1 }]);
    expect(c.get("cfbm:edge7")!.bets).toHaveLength(1);
    expect(c.get("cfbm:fade7")!.bets[0]).toMatchObject({ key: "9|alabama|georgia|away", net: -1, toward: -1 });
    expect(c.get("cfbm:dog")!.bets).toHaveLength(0);
    expect(c.get("cfbm:conf")!.bets).toHaveLength(1);
    // total 52, ours 55: over; final 50 -> loses; close 54 moved toward the over.
    expect(c.get("cfbm:total")!.bets[0]).toMatchObject({ key: "9|alabama|georgia|over", net: -1, toward: 1 });
    expect(c.get("cfbm:total5")!.bets).toHaveLength(0);
    expect(CFB_SLICES.every(([id]) => c.has(id))).toBe(true);
  });

  it("forward record and live marks", () => {
    const g = tracked({ spread: -12, line: -3, final: { home: 30, away: 20 } });
    const r = forwardRecord([g, tracked({ home: "x", away: "y" })], new Map([[gameKey(g), { open: null, close: -5, totalClose: null }]]));
    expect(r).toMatchObject({ games: 2, graded: 1, w: 1, l: 0, units: 0.91, clv: 2, suW: 1, suL: 0 });
    const live = [{ id: "cfbm:edge7", status: "active" as const, activatedAt: "2026-10-20T00:00:00Z" }];
    expect(liveSlicesFor(live, g)).toEqual(["Our side, 7+ pts from the line"]);
    expect(liveSlicesFor([{ ...live[0], activatedAt: "2026-11-01T00:00:00Z" }], g)).toEqual([]);
  });
});
