import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { nbaSeasonOf, nbaWeek, parseNbaPropsLinks, parseNbaPropsPage, samVsMarket, type PropMarket } from "./parse";
import { gradeGame, nbaBoxStats, type EspnBoxTeam } from "./grade";
import { NBA_SLICES, propTrends, slicesFor, SLICES, type GradedPropsGame } from "./trends";

const fx = (f: string) => readFileSync(path.resolve(import.meta.dirname, "../../../test/fixtures/props", f), "utf8");
// Sam's BOS at DET page, opening night 2026 (saved 2026-10-19).
const g = parseNbaPropsPage("0022600001", fx("nba-props-0022600001.html"), 1)!;

describe("Sam's NBA props pages", () => {
  it("finds the game links on the NBA board", () => {
    expect(parseNbaPropsLinks('<a href="props/0022600001.html">x</a><a href="props/0022600002.html"><a href="props/2026_06_WAS_SF.html">')).toEqual(["0022600001", "0022600002"]);
  });

  it("reads the same template as the NFL pages", () => {
    expect(g).toMatchObject({ season: 2026, week: 1, away: "BOS", home: "DET", breakEven: 0.024 });
    expect(g.markets).toHaveLength(40);
    expect(new Set(g.markets.map((m) => m.stat))).toEqual(new Set(["pts", "reb", "ast", "threes"]));
    expect(g.markets.filter((m) => m.clears)).toHaveLength(5);
    // Book count, not a team, sits in the NFL team slot; it is dropped.
    expect(g.markets.every((m) => m.team === "")).toBe(true);
    // Sam 25.4 vs the market's 23.5: over, at the best over price on 23.5 (DK -119), 8% off so not a play.
    const cade = g.markets.find((m) => m.id === "pts|Cade Cunningham")!;
    expect(cade).toMatchObject({ model: 25.4, line: 23.5, gap: 0.081, clears: false, weight: 0, consensus: 23.5, side: "over", lean: "over" });
    expect(cade.books.find((b) => b.win)).toMatchObject({ book: "DraftKings", line: 23.5, over: -119 });
    expect(g.markets.find((m) => m.id === "reb|Derrick White")).toMatchObject({ clears: true, side: "over", line: 3.5, gap: 0.229 });
    expect(g.favorites[0]).toMatchObject({ rank: 1, player: "John Collins", team: "", side: "under", line: 12.5, price: -125, book: "DraftKings" });
  });

  it("files a game id under its season", () => {
    expect(nbaSeasonOf("0022600001")).toBe(2026);
    expect(nbaSeasonOf("2026_06_WAS_SF")).toBeNull();
  });

  it("counts Monday-to-Sunday weeks from the week holding October 21", () => {
    expect(nbaWeek(new Date("2026-10-20T23:00:00Z"), 2026)).toBe(1); // opening night, Tuesday
    expect(nbaWeek(new Date("2026-10-26T02:30:00Z"), 2026)).toBe(1); // Sunday 10:30pm ET
    expect(nbaWeek(new Date("2026-10-26T23:00:00Z"), 2026)).toBe(2); // Monday
    expect(nbaWeek(new Date("2027-01-04T23:00:00Z"), 2026)).toBe(12);
  });
});

const box: EspnBoxTeam[] = [
  {
    team: { abbreviation: "DET" },
    statistics: [
      {
        keys: ["minutes", "points", "fieldGoalsMade-fieldGoalsAttempted", "threePointFieldGoalsMade-threePointFieldGoalsAttempted", "rebounds", "assists"],
        athletes: [
          { athlete: { displayName: "Cade Cunningham" }, stats: ["36", "22", "8-19", "2-6", "7", "9"] },
          { athlete: { displayName: "Jalen Duren" }, stats: [], didNotPlay: true },
        ],
      },
    ],
  },
];

describe("Sam vs the market", () => {
  const m = (x: Partial<PropMarket>): PropMarket => ({
    id: "pts|X", stat: "pts", statLabel: "Points", player: "X", team: "", model: 20, line: 0, gap: null, clears: false, weight: 0, consensus: 16.5, side: null, lean: null,
    books: [
      { book: "A", line: 16.5, over: -115, under: -105, win: true },
      { book: "B", line: 16.5, over: -105, under: -115, win: false },
      { book: "C", line: 15.5, over: -140, under: 110, win: false },
    ],
    ...x,
  });
  it("bets Sam's side of the consensus at the best price on that line, ignoring his page's book", () => {
    const r = samVsMarket(m({}));
    expect(r).toMatchObject({ side: "over", line: 16.5, clears: true, gap: 0.212 });
    expect(r.books.find((b) => b.win)!.book).toBe("B");
  });
  it("needs 15% and half a unit, and a price no worse than -150", () => {
    expect(samVsMarket(m({ model: 18 })).clears).toBe(false); // 9%
    expect(samVsMarket(m({ model: 0.9, consensus: 0.5, books: [{ book: "A", line: 0.5, over: -210, under: 160, win: false }] })).clears).toBe(false);
    expect(samVsMarket(m({ model: 0.9, consensus: 0.5, books: [{ book: "A", line: 0.5, over: -130, under: 100, win: false }] })).clears).toBe(false); // under half a unit
  });
});

describe("grading NBA props", () => {
  it("reads points, rebounds, assists and made threes, and leaves out a player who sat", () => {
    const b = nbaBoxStats(box);
    expect(b.get("cadecunningham")).toEqual({ pts: 22, reb: 7, ast: 9, threes: 2 });
    expect(b.has("jalenduren")).toBe(false);
  });

  it("grades Sam's play at the playing book and voids a player who sat", () => {
    const r = gradeGame(g, box, {}, "nba");
    const cade = r.markets.find((m) => m.id === "pts|Cade Cunningham")!;
    expect(cade.actual).toBe(22);
    expect(cade.play).toBeNull(); // 8% off: not a play
    expect(cade.lean).toMatchObject({ side: "over", line: 23.5, price: -119, book: "DraftKings", outcome: "L" });
    expect(r.markets.find((m) => m.id === "ast|Cade Cunningham")!.play).toMatchObject({ side: "over", line: 8.5, price: -128, outcome: "W" }); // 9 assists
    expect(r.markets.find((m) => m.id.endsWith("|Jalen Duren"))).toMatchObject({ actual: null, play: null });
  });
});

describe("NBA slices", () => {
  it("are the NFL checks with NBA stats, and no feeds the NBA lacks", () => {
    const ids = NBA_SLICES.map((x) => x[0]);
    expect(slicesFor("nfl")).toBe(SLICES);
    expect(ids).toEqual(expect.arrayContaining(["play:all", "play:pts", "play:threes", "play:edge-hi", "play:fav", "lean:all", "lean:ast", "lean:noplay"]));
    expect(ids.some((id) => /pass_yds|rw|espn|david|dk-|all3|gap-|play:agree|play:against|play:off/.test(id))).toBe(false);
  });

  it("slice a graded NBA game by stat", () => {
    const list: GradedPropsGame[] = [{ week: 1, slug: g.slug, game: g, result: gradeGame(g, box, {}, "nba") }];
    const t = propTrends(list, "nba");
    expect(t.slices.find((x) => x.id === "play:ast")).toMatchObject({ w: 1, l: 0 });
    expect(t.slices.find((x) => x.id === "lean:pts")).toMatchObject({ w: 0, l: 1 });
    expect(t.accuracy.map((a) => a.stat)).toContain("pts");
  });
});
