import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parsePropsLinks, parsePropsPage, playSide, type PropsGame } from "./parse";
import { boxStats, gradeGame, settle, type EspnBoxTeam } from "./grade";
import { indexProjections, projectionsFor } from "./rotowire";
import { MIN_BETS, propTrends, sliceBets, type GradedPropsGame } from "./trends";

const fx = (f: string) => readFileSync(path.resolve(import.meta.dirname, "../../../test/fixtures/props", f), "utf8");
const g = parsePropsPage("2026_06_SEA_DEN", fx("props-2026_06_SEA_DEN.html"))!;

describe("Sam's props pages", () => {
  it("finds props links on the board", () => {
    expect(parsePropsLinks('<a href="props/2026_06_SEA_DEN.html">x</a><a href="firsttd/2026_06_SEA_DEN.html">')).toEqual(["2026_06_SEA_DEN"]);
  });

  it("reads every market, the favorites and the break-even", () => {
    expect(g).toMatchObject({ season: 2026, week: 6, away: "SEA", home: "DEN", breakEven: 0.024 });
    expect(g.markets).toHaveLength(28);
    expect(g.favorites[0]).toMatchObject({ rank: 1, player: "Troy Franklin", side: "over", line: 15.5, price: -115, book: "betmgm" });
    const nix = g.markets.find((m) => m.id === "pass_yds|Bo Nix")!;
    expect(nix).toMatchObject({ model: 187.1, line: 200.5, gap: 0.017, clears: false, weight: 0.25, consensus: 197.5, side: "under", lean: "under" });
    expect(nix.books.find((b) => b.win)).toMatchObject({ book: "betmgm", line: 200.5, over: 105, under: -140 });
    const sutton = g.markets.find((m) => m.id === "rec|Courtland Sutton")!;
    expect(sutton).toMatchObject({ gap: 0.109, clears: true, consensus: 3, side: "over" });
    // A dash means no play.
    expect(g.markets.find((m) => m.id === "rush_yds|RJ Harvey")).toMatchObject({ gap: null, clears: false });
    expect(g.markets.filter((m) => m.clears)).toHaveLength(10);
  });

  it("reads the side of a same-line price play from the cheapest side", () => {
    const books = [
      { book: "a", line: 6.5, over: -136, under: 107, win: false },
      { book: "b", line: 6.5, over: -150, under: 110, win: true },
    ];
    expect(playSide(books, 6.5)).toBe("under");
  });
});

describe("grading props", () => {
  const box = JSON.parse(fx("espn-box-tb-dal.json")).boxscore.players as EspnBoxTeam[];

  it("reads passing, rushing and receiving from the box score", () => {
    const st = boxStats(box);
    expect(st.get("dakprescott")).toMatchObject({ pass_yds: 316 });
    expect(st.get("buckyirving")).toMatchObject({ rush_yds: 165 });
    expect(st.get("georgepickens")).toMatchObject({ rec: 9, rec_yds: 130 });
    expect(settle("over", 2.5, 3)).toBe("W");
    expect(settle("under", 3, 3)).toBe("P");
  });

  it("grades plays and leans at the playing book, voids a player who didn't play", () => {
    const game: PropsGame = {
      ...g,
      markets: [
        { ...g.markets.find((m) => m.id === "rec|Courtland Sutton")!, id: "rec|George Pickens", player: "George Pickens", team: "DAL" },
        g.markets.find((m) => m.id === "pass_yds|Bo Nix")!,
      ],
    };
    const r = gradeGame(game, box, { "rec|George Pickens": 2 });
    const p = r.markets[0];
    expect(p.actual).toBe(9);
    expect(p.play).toMatchObject({ side: "over", line: 2.5, price: -172, book: "draftkings", outcome: "W" });
    expect(p.play!.net).toBeCloseTo(0.581, 3);
    expect(p.rw).toMatchObject({ side: "under", outcome: "L", net: -1 });
    expect(r.markets[1]).toEqual({ id: "pass_yds|Bo Nix", actual: null, play: null, lean: null });
    expect(r.void).toBe(1);
  });
});

describe("Rotowire via Sleeper", () => {
  it("matches by name and team and maps LAR to LA", () => {
    const idx = indexProjections([
      { team: "SEA", player: { first_name: "Jaxon", last_name: "Smith-Njigba" }, stats: { rec: 6.66, rec_yd: 100.52 } },
      { team: "LAR", player: { first_name: "Puka", last_name: "Nacua" }, stats: { rec: 7 } },
    ]);
    expect(idx.has("pukanacua|LA")).toBe(true);
    const out = projectionsFor(g.markets, idx);
    expect(out["rec_yds|Jaxon Smith-Njigba"]).toBe(100.5);
    expect(out["rec|Jaxon Smith-Njigba"]).toBe(6.7);
    expect(out["rec_yds|Troy Franklin"]).toBeUndefined();
  });
});

describe("prop trends", () => {
  const box = JSON.parse(fx("espn-box-tb-dal.json")).boxscore.players as EspnBoxTeam[];
  const pick = { ...g.markets.find((m) => m.id === "rec|Courtland Sutton")!, id: "rec|George Pickens", player: "George Pickens", team: "DAL" };
  const game: PropsGame = { ...g, favorites: [], markets: [pick] };
  const one = (week: number): GradedPropsGame => ({ week, slug: `s${week}`, game, result: gradeGame(game, box), first: { [pick.id]: 2.5 } });

  it("counts units, wins needed and line movement", () => {
    const t = propTrends([one(6)]);
    const all = t.slices.find((x) => x.id === "play:all")!;
    expect(all).toMatchObject({ n: 1, w: 1, verdict: "early", move: 0.5 });
    expect(all.needed).toBeCloseTo(0.6, 1);
    expect(t.accuracy[0]).toMatchObject({ stat: "rec", n: 1, model: 5.7, market: 6 });
  });

  it("calls a slice profitable only past the sample bar", () => {
    const many = Array.from({ length: MIN_BETS }, (_, i) => one(6 + (i % 3)));
    const t = propTrends(many);
    expect(t.slices.find((x) => x.id === "play:all")!.verdict).toBe("profitable");
    expect(t.slices.find((x) => x.id === "play:rec")!.verdict).toBe("profitable");
    expect(t.slices.find((x) => x.id === "play:under")!.n).toBe(0);
    expect(t.findings[0]).toMatch(/beating the prices/);
    expect(sliceBets(many, "play:all").filter((b) => b.week >= 8)).toHaveLength(33);
  });
});
