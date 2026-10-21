import { describe, expect, it } from "vitest";
import { FEATURES, Ratings, fitRidge, rateAll, solve, type Features, type RatingParams, type SpreadGame } from "./spread";
import { signalRecords, signalsOf, trackedGames } from "./spread-track";
import type { ForecastSnapshot } from "@/lib/picks/forecasts";

const RP: RatingParams = { hfa: 2.5, kPerf: 0.1, cap: 28, carryPerf: 0.67, hfaMkt: 2.5, kMkt: 0.6, carryMkt: 0.67 };
const game = (o: Partial<SpreadGame>): SpreadGame => ({
  id: "x",
  season: 2025,
  week: 1,
  type: "REG",
  gameday: "2025-09-07",
  home: "KC",
  away: "BUF",
  homeScore: 30,
  awayScore: 10,
  line: 3,
  homeRest: 7,
  awayRest: 7,
  homeQb: "q1",
  awayQb: "q2",
  neutral: false,
  ...o,
});

describe("ratings", () => {
  it("same-day games don't see each other's results", () => {
    const a = game({ id: "a", home: "KC", away: "BUF", homeScore: 50, awayScore: 0 });
    const b = game({ id: "b", home: "KC", away: "DEN" });
    const both = rateAll([a, b], RP);
    expect(both.find((x) => x.game.id === "b")!.x).toEqual(rateAll([b], RP)[0].x);
  });
  it("a game's features never see its own result", () => {
    const a = rateAll([game({ homeScore: 40, awayScore: 0 })], RP)[0].x;
    const b = rateAll([game({ homeScore: 0, awayScore: 40 })], RP)[0].x;
    expect(a).toEqual(b);
  });
  it("a blowout moves the results rating, a line moves the market rating, a QB change is flagged", () => {
    const r = new Ratings(RP);
    r.add(game({}));
    const x = r.features(game({ id: "y", week: 2, gameday: "2025-09-14", homeQb: "q9" }), 3);
    expect(x.gap).toBeGreaterThan(0);
    expect(x.cover).toBeGreaterThan(0);
    expect(x.qb).toBe(1);
  });
});

describe("ridge", () => {
  it("solves a small system", () => {
    const x = solve([[2, 1], [1, 3]], [3, 5]);
    expect(x[0]).toBeCloseTo(0.8);
    expect(x[1]).toBeCloseTo(1.4);
  });
  it("recovers known weights with little shrinkage", () => {
    let seed = 1;
    const u = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    const rows = Array.from({ length: 2000 }, () => {
      const x = Object.fromEntries(FEATURES.map((f) => [f, u() * 5])) as Features;
      return { x, y: 0.5 + 0.3 * x.gap - 0.2 * x.move };
    });
    const f = fitRidge(rows, 0.001);
    expect(f.w.gap).toBeCloseTo(0.3, 3);
    expect(f.w.move).toBeCloseTo(-0.2, 3);
    expect(f.b).toBeCloseTo(0.5, 3);
  });
});

describe("forward test", () => {
  const snap = (at: string, line: number, model: number, x: Partial<Features> = {}): ForecastSnapshot => ({
    at,
    week: 8,
    home: "KC",
    away: "BUF",
    ref: { line, homePrice: -110, awayPrice: -110, kickoff: "2026-10-25T17:00:00Z", source: "DraftKings via ESPN", fetchedAt: at } as ForecastSnapshot["ref"],
    ours: { market: line, model, x: { gap: 0, move: 0, cover: 0, rest: 0, qb: 0, ...x } },
  });

  it("reads lean, strong and fade signals", () => {
    // model -3.5 vs market -3: our line is more home-favored, so lean home.
    const s = signalsOf(snap("2026-10-20T12:00:00Z", -3, -3.5, { move: 4, cover: -20 }));
    expect(s.map((x) => `${x.id}:${x.side}`)).toEqual(["lean:home", "strong:home", "fade-move:away", "fade-cover:home"]);
  });

  it("judges at the first snapshot with our line, CLV against the close", () => {
    const g = trackedGames(
      [snap("2026-10-20T12:00:00Z", -3, -3.5), snap("2026-10-24T12:00:00Z", -4, -4.1)],
      [{ week: 8, home: "KC", away: "BUF", open: -3, close: -4.5, totalOpen: null, totalClose: null, final: { home: 27, away: 20 } }],
    );
    expect(g).toHaveLength(1);
    expect(g[0].line).toBe(-3);
    const lean = signalRecords(g).find((r) => r.id === "lean")!;
    expect([lean.w, lean.l]).toEqual([1, 0]); // won by 7, laid 3
    expect(lean.clv).toBe(1.5); // took -3, closed -4.5
    expect(lean.verdict).toBe("collecting");
  });

  it("ignores snapshots after kickoff or with no kickoff", () => {
    expect(trackedGames([snap("2026-10-25T18:00:00Z", -3, -3.5)], [])).toHaveLength(0);
    const s = snap("2026-10-20T12:00:00Z", -3, -3.5);
    expect(trackedGames([{ ...s, ref: { ...s.ref!, kickoff: undefined } }], [])).toHaveLength(0);
  });
});
