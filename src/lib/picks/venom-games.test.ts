import { describe, expect, it } from "vitest";
import { VENOM_CUTS, cutsFor, gradeGame, matches, read, type VenomLine } from "./engine";
import { venomCompare, venomTotalsCompare } from "./research";
import { parseGames } from "../../../scripts/venom-reader.mjs";

const cut = (id: string) => VENOM_CUTS.find((c) => c.id === id)!.test;
const v = (model: number, extra: Partial<VenomLine> = {}): VenomLine => ({ model, market: -3, modelTotal: 44, total: 44, edgeSide: null, edgeTotal: null, ...extra });

describe("Venom's Game Cheat Code", () => {
  it("reads the board text into home-side lines and his flags", () => {
    const text = ["JAX", "@", "BAL", "THU, NOV 5 · 20:15 ET", "SPREAD", "TOTAL", "MARKET", "JAX -10", "39.5", "VENOM", "JAX -5", "44", "VENOM EDGE BAL", "VENOM EDGE OVER", "LINE MOVEMENT · 10 DAYS ▾",
      "CIN", "@", "ATL", "SUN, NOV 8 · 09:30 ET", "SPREAD", "TOTAL", "MARKET", "CIN -3", "52.5", "VENOM", "PK", "45", "VENOM EDGE UNDER", "LINE MOVEMENT · 10 DAYS ▾"].join("\n");
    expect(parseGames(text)).toEqual([
      { away: "JAX", home: "BAL", kickoff: "THU, NOV 5 · 20:15 ET", market: 10, total: 39.5, model: 5, modelTotal: 44, edgeSide: "home", edgeTotal: "over" },
      { away: "CIN", home: "ATL", kickoff: "SUN, NOV 8 · 09:30 ET", market: 3, total: 52.5, model: 0, modelTotal: 45, edgeSide: null, edgeTotal: "under" },
    ]);
  });

  it("is a third vote on Sam and David agreeing, NFL only", () => {
    const sam = { model: -6, market: -3 }, david = { model: -5, market: -3 };
    expect(matches(read(sam, david, undefined, undefined, v(-4)), cut("venom-agree"))).toBe(true);
    expect(matches(read(sam, david, undefined, undefined, v(-1)), cut("venom-disagree"))).toBe(true);
    expect(matches(read(sam, david), cut("venom-agree"))).toBe(false);
    expect(cutsFor("nfl").some((c) => c.id === "venom-agree")).toBe(true);
    expect(cutsFor("cfb").some((c) => c.id === "venom-agree")).toBe(false);
    expect(VENOM_CUTS.every((c) => !c.candidate)).toBe(true);
  });

  it("grades his spread at Sam and David's average line; totals live in the totals research", () => {
    // Market home -3 everywhere; home wins 27-20 (covers -3); 47 points.
    const base = { week: 4, home: "BAL", away: "JAX", final: { home: 27, away: 20 }, sam: { model: -6, market: -3 }, david: { model: -5, market: -3 } };
    const games = [
      gradeGame({ ...base, venom: v(-5, { modelTotal: 49, total: 44, edgeSide: "home", edgeTotal: "over" }) }), // home side W, over 44 W
      gradeGame({ ...base, home: "ATL", away: "CIN", venom: v(0, { modelTotal: 40, total: 44 }) }), // road side L, under L
    ];
    const r = venomCompare(games, new Map());
    const row = (id: string) => r.rows.find((x) => x.id === id)!.record;
    expect(r.games).toBe(2);
    expect(row("venom")).toMatchObject({ w: 1, l: 1 });
    expect(row("agree-v")).toMatchObject({ w: 1, l: 0 });
    expect(row("agree-not-v")).toMatchObject({ w: 1, l: 0 }); // graded on Sam and David's side, which covered
    expect(row("flag")).toMatchObject({ w: 1, l: 0 });
    expect(r.rows.some((x) => x.id.startsWith("total"))).toBe(false);
  });

  it("grades his totals at his board's number, and against Sam and David at the archived total", () => {
    const key = (g: { week: number; home: string; away: string }) => `${g.week}:${g.away}@${g.home}`;
    const venom = new Map([
      ["4:JAX@BAL", { modelTotal: 49, total: 44, edgeTotal: "over" as const }], // over 44 W
      ["4:CIN@ATL", { modelTotal: 40, total: 44, edgeTotal: null }], // under 44 L
    ]);
    const points = new Map([["4:JAX@BAL", 47], ["4:CIN@ATL", 47]]);
    const seen = [
      { week: 4, home: "BAL", away: "JAX", sam: 48, david: 47, line: 45 }, // both over 45, Venom over: W
      { week: 4, home: "ATL", away: "CIN", sam: 48, david: 46, line: 45 }, // both over 45, Venom under: W for the models
    ];
    const r = venomTotalsCompare(venom, seen, points, key);
    const row = (id: string) => r.rows.find((x) => x.id === id)!.record;
    expect(r.games).toBe(2);
    expect(row("agree")).toMatchObject({ w: 2, l: 0 });
    expect(row("agree-v")).toMatchObject({ w: 1, l: 0 });
    expect(row("agree-not-v")).toMatchObject({ w: 1, l: 0 });
    expect(row("total")).toMatchObject({ w: 1, l: 1 });
    expect(row("total-3")).toMatchObject({ w: 1, l: 1 });
    expect(row("total-flag")).toMatchObject({ w: 1, l: 0 });
  });
});
