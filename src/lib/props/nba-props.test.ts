import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { nbaSeasonOf, nbaWeek, parseNbaPropsLinks, parseNbaPropsPage } from "./parse";
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
    expect(g.markets.filter((m) => m.clears)).toHaveLength(10);
    // Book count, not a team, sits in the NFL team slot; it is dropped.
    expect(g.markets.every((m) => m.team === "")).toBe(true);
    const cade = g.markets.find((m) => m.id === "pts|Cade Cunningham")!;
    expect(cade).toMatchObject({ model: 25.4, line: 24.5, gap: 0.057, clears: true, weight: 0, consensus: 23.5, side: "under", lean: "over" });
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
    expect(cade.play).toMatchObject({ side: "under", line: 24.5, price: -125, book: "ESPN BET", outcome: "W" });
    expect(cade.lean).toMatchObject({ side: "over", outcome: "L" });
    expect(r.markets.find((m) => m.id.endsWith("|Jalen Duren"))).toMatchObject({ actual: null, play: null });
  });
});

describe("NBA slices", () => {
  it("are the NFL checks with NBA stats, and no feeds the NBA lacks", () => {
    const ids = NBA_SLICES.map((x) => x[0]);
    expect(slicesFor("nfl")).toBe(SLICES);
    expect(ids).toEqual(expect.arrayContaining(["play:all", "play:pts", "play:threes", "play:gap-hi", "play:fav", "lean:all", "lean:ast", "lean:noplay"]));
    expect(ids.some((id) => /pass_yds|rw|espn|david|dk-|all3/.test(id))).toBe(false);
  });

  it("slice a graded NBA game by stat", () => {
    const list: GradedPropsGame[] = [{ week: 1, slug: g.slug, game: g, result: gradeGame(g, box, {}, "nba") }];
    const t = propTrends(list, "nba");
    expect(t.slices.find((x) => x.id === "play:pts")).toMatchObject({ w: 1, l: 0 });
    expect(t.accuracy.map((a) => a.stat)).toContain("pts");
  });
});
