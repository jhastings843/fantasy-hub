import { describe, expect, it } from "vitest";
import { GameRatings, ourNumbers, type GameParams, type GameRow } from "./game";
import { num, readOpenClose } from "./game-lines";
import { clv, result, signalRecords, signalsOf, type GameSnap, type TrackedNbaGame } from "./game-track";

const RP = { ppp0: 114, pace0: 100, hfa: 2, k: 0.05, kPace: 0.1, carry: 0.5 };
const game = (id: string, date: string, home: string, away: string, sh: number, sa: number): GameRow => ({
  id,
  date,
  home,
  away,
  score: { [home]: sh, [away]: sa },
  poss: { [home]: 100, [away]: 100 },
});

describe("game lines", () => {
  it("reads American spread strings", () => {
    expect(num("-5.5")).toBe(-5.5);
    expect(num("+1.5")).toBe(1.5);
    expect(num("PK")).toBe(0);
    expect(num("o229.5")).toBe(229.5);
    expect(num("x")).toBeNull();
    expect(num(undefined)).toBeNull();
  });

  it("prefers DraftKings, skips live odds, falls back to current before the close", () => {
    const l = readOpenClose({
      items: [
        { provider: { name: "ESPN Bet - Live Odds" }, homeTeamOdds: { current: { pointSpread: { american: "-1.5" } } } },
        { provider: { name: "ESPN BET" }, homeTeamOdds: { open: { pointSpread: { american: "-6.5" } }, close: { pointSpread: { american: "-5.5" } } } },
        { provider: { name: "DraftKings" }, homeTeamOdds: { open: { pointSpread: { american: "-7.5" } }, current: { pointSpread: { american: "-5" } } }, open: { total: { american: "228.5" } }, current: { total: { american: "229.5" } } },
      ],
    });
    expect(l).toEqual({ provider: "DraftKings", open: { spread: -7.5, total: 228.5 }, close: { spread: -5, total: 229.5 } });
  });
});

describe("game ratings", () => {
  it("learns from margins and flags a back-to-back", () => {
    const r = new GameRatings(RP);
    r.newSeason("2025");
    r.add(game("1", "2025-11-01T23:00:00Z", "BOS", "NY", 130, 100), -4);
    expect(r.expect("BOS", "NY").margin).toBeGreaterThan(r.expect("NY", "BOS").margin);
    const f = r.features({ date: "2025-11-02T23:00:00Z", home: "BOS", away: "MIA" }, -3, 225, { spread: -2, total: 224 }, { home: -4, away: 0 });
    expect(f.spread.b2b).toBe(1);
    expect(f.spread.avail).toBe(-4);
    expect(f.spread.move).toBe(1); // market margin 3 now, 2 at the open
    expect(f.total.moveT).toBe(1);
    expect(f.spread.cover).toBe(26); // BOS beat -4 by 26, MIA has none
  });

  it("carries ratings into a new season at the carry share", () => {
    const r = new GameRatings(RP);
    r.newSeason("2025");
    r.add(game("1", "2025-11-01T23:00:00Z", "BOS", "NY", 130, 100));
    const before = r.off.get("BOS")!;
    r.newSeason("2026");
    expect(r.off.get("BOS")).toBeCloseTo(before * 0.5);
    expect(r.rest("BOS", "2026-10-22").b2b).toBe(0);
  });

  it("moves the market's numbers by the predicted residuals", () => {
    const p = { spread: { w: { gap: 0, avail: 0, move: 0, rest: 0, b2b: -1, cover: 0 }, b: 0 }, total: { w: { gapT: 0, availT: 0, moveT: 0, b2bT: 0 }, b: 1 } } as unknown as GameParams;
    const x = { spread: { gap: 0, avail: 0, move: 0, rest: 0, b2b: 1, cover: 0 }, total: { gapT: 0, availT: 0, moveT: 0, b2bT: 0 } };
    // Home on a back-to-back: predicted home margin 1 pt worse, so home -5 becomes -4.
    expect(ourNumbers(-5, 220, x, p)).toEqual({ spread: -4, total: 221 });
  });
});

const snap = (o: Partial<GameSnap>): GameSnap => ({
  at: "2026-10-26T15:00:00Z",
  spread: -5,
  total: 220,
  open: { spread: -5, total: 220 },
  ours: { spread: -6.5, total: 223 },
  res: 1.5,
  x: { spread: { gap: 0, avail: 0, move: 0, rest: 0, b2b: -1, cover: 0 }, total: { gapT: 0, availT: 0, moveT: 0, b2bT: 0 } },
  ...o,
});

describe("game model tracking", () => {
  it("fires lean, strong, b2b and total", () => {
    expect(signalsOf(snap({}), 1.02)).toEqual([
      { id: "lean", side: "home" },
      { id: "strong", side: "home" },
      { id: "b2b", side: "home" }, // away on the back-to-back
      { id: "total", side: "over" },
    ]);
    expect(signalsOf(snap({ res: -0.5, ours: { spread: -4.5, total: 219 } }), 1.02).map((x) => `${x.id}:${x.side}`)).toEqual(["lean:away", "b2b:home", "total:under"]);
  });

  it("grades at the first number and measures CLV to the close", () => {
    const s = snap({});
    expect(result("home", s, { home: 110, away: 104 })).toBe(1); // won by 6, laid 5
    expect(result("away", s, { home: 110, away: 105 })).toBe(0);
    expect(result("over", s, { home: 110, away: 109 })).toBe(-1);
    expect(clv("home", s, { spread: -7, total: 222 })).toBe(2);
    expect(clv("away", s, { spread: -7, total: 222 })).toBe(-2);
    expect(clv("over", s, { spread: -7, total: 222 })).toBe(2);
    expect(clv("under", s, { spread: null, total: null })).toBeNull();
  });

  it("records per signal", () => {
    const g: TrackedNbaGame = { event: "1", home: "BOS", away: "NY", tip: "2026-10-26T23:30:00Z", first: snap({}), last: snap({}), close: { spread: -6, total: 221 }, final: { home: 112, away: 100 } };
    const rec = signalRecords([g], 1.02);
    const lean = rec.find((r) => r.id === "lean")!;
    expect(lean).toMatchObject({ games: 1, weeks: 1, w: 1, l: 0, clv: 1, verdict: "collecting" });
    expect(rec.find((r) => r.id === "total")).toMatchObject({ w: 0, l: 1, units: -1 });
  });
});
