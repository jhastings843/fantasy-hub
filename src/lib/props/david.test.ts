import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { davidBox, davidFor, davidTrends, gradeDavid, parseDavidSlate, type DavidProp } from "./david";
import { gradeGame, type EspnBoxTeam } from "./grade";
import { parsePropsPage } from "./parse";
import { propTrends } from "./trends";

const fx = (f: string) => readFileSync(path.resolve(import.meta.dirname, "../../../test/fixtures/props", f), "utf8");
const slate = parseDavidSlate(fx("david-2026_06.html"))!;

const box: EspnBoxTeam[] = [
  {
    statistics: [
      { name: "passing", keys: ["completions/passingAttempts", "passingYards"], athletes: [{ athlete: { displayName: "Sam Darnold" }, stats: ["27/51", "278"] }] },
      { name: "rushing", keys: ["rushingAttempts", "rushingYards"], athletes: [{ athlete: { displayName: "Emanuel Wilson" }, stats: ["14", "52"] }] },
      { name: "receiving", keys: ["receptions", "receivingYards"], athletes: [{ athlete: { displayName: "Jaxon Smith-Njigba" }, stats: ["12", "134"] }] },
    ],
  },
];

const prop = (o: Partial<DavidProp>): DavidProp => ({
  id: "x",
  player: "Sam Darnold",
  team: "SEA",
  gameId: "2026_06_SEA_DEN",
  kickoff: "2026-10-16T00:15:00.000Z",
  market: "pass_attempts",
  projection: 36,
  line: 34.5,
  over: -120,
  under: 100,
  lower: 25,
  upper: 45,
  ...o,
});

describe("David's prop board", () => {
  it("reads the whole slate from the page's RSC payload", () => {
    expect(slate).toMatchObject({ season: 2026, week: 6, updatedAt: "Oct 16, 4:45 AM CT" });
    expect(slate.props).toHaveLength(350);
    expect(slate.props[0]).toMatchObject({
      player: "C.J. Stroud",
      team: "HOU",
      gameId: "2026_06_HOU_JAX",
      market: "pass_attempts",
      projection: 35.2,
      line: 35.5,
      over: -125,
      under: -102,
      lower: 21,
      upper: 50,
    });
    expect(new Set(slate.props.map((p) => p.market)).size).toBe(6);
  });

  it("returns null on a page without a slate", () => {
    expect(parseDavidSlate("<html></html>")).toBeNull();
  });

  it("reads attempts out of the box score", () => {
    const b = davidBox(box);
    expect(b.get("samdarnold")).toMatchObject({ pass_attempts: 51, passing_yards: 278 });
    expect(b.get("emanuelwilson")).toMatchObject({ rush_attempts: 14, rushing_yards: 52, receptions: 0 });
  });

  it("grades his side at DraftKings' total and price, voids a missing player", () => {
    const [win, loss, dnp, tie] = gradeDavid(
      [prop({ id: "a" }), prop({ id: "b", player: "Emanuel Wilson", market: "rushing_yards", projection: 70, line: 60.5 }), prop({ id: "c", player: "Nobody" }), prop({ id: "d", projection: 34.5 })],
      box,
    );
    expect(win).toMatchObject({ actual: 51, side: "over", outcome: "W", inRange: false });
    expect(win.net).toBeCloseTo(0.833, 3);
    expect(loss).toMatchObject({ actual: 52, side: "over", outcome: "L", net: -1 });
    expect(dnp).toMatchObject({ actual: null, outcome: null });
    expect(tie).toMatchObject({ side: null, outcome: null, net: 0 });
  });

  it("builds a record by market", () => {
    const props = [prop({ id: "a" }), prop({ id: "b", player: "Emanuel Wilson", market: "rushing_yards", projection: 70, line: 60.5 })];
    const t = davidTrends([{ gameId: "2026_06_SEA_DEN", kickoff: "", props, capturedAt: "", firstSeenAt: "", first: { a: 33.5 }, updatedAt: "", result: gradeDavid(props, box) }]);
    const all = t.slices.find((x) => x.id === "all")!;
    expect(all).toMatchObject({ n: 2, w: 1, l: 1 });
    expect(t.slices.find((x) => x.id === "pass_attempts")!.move).toBe(1);
    expect(t.accuracy.find((a) => a.market === "pass_attempts")).toMatchObject({ n: 1, model: 15, line: 16.5, closer: 1, inRange: 0 });
  });

  it("matches his numbers onto Sam's markets and grades the lean", () => {
    const g = parsePropsPage("2026_06_SEA_DEN", fx("props-2026_06_SEA_DEN.html"))!;
    const darnold = g.markets.find((m) => m.id === "pass_yds|Sam Darnold")!;
    const d = davidFor("2026_06_SEA_DEN", g.markets, [prop({ market: "passing_yards", projection: darnold.line + 20 }), prop({ gameId: "2026_06_DAL_GB", market: "passing_yards" })]);
    expect(d).toEqual({ [darnold.id]: darnold.line + 20 });
    const r = gradeGame(g, box, { david: d });
    expect(r.markets.find((m) => m.id === darnold.id)!.david).toMatchObject({ side: "over", outcome: darnold.line < 278 ? "W" : "L" });
    const t = propTrends([{ week: 6, slug: g.slug, game: g, result: r, david: d }]);
    expect(t.slices.find((x) => x.id === "david:all")!.n).toBe(1);
    expect(t.accuracy.find((a) => a.stat === "pass_yds")!.david).toBe(Math.abs(278 - darnold.line - 20));
  });
});
