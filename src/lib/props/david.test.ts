import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { agreeEdge, davidBox, davidPropsLinks, davidEdge, davidFor, davidSliceSide, davidTrends, gradeDavid, isDavidPlay, isDavidSlice, parseDavidSlate, type DavidProp } from "./david";
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

  it("builds his record by market, and the head to head with Sam at the same DraftKings price", () => {
    const props = [prop({ id: "a" }), prop({ id: "b", player: "Emanuel Wilson", market: "rushing_yards", projection: 70, line: 60.5 })];
    const games = [{ week: 6, gameId: "2026_06_SEA_DEN", kickoff: "", props, capturedAt: "", firstSeenAt: "", first: { a: 33.5 }, updatedAt: "", result: gradeDavid(props, box) }];
    // Sam: agrees on Darnold's attempts (over), splits on Wilson's yards (under).
    const sam = new Map([
      ["2026_06_SEA_DEN|samdarnold|SEA|pass_attempts", 40],
      ["2026_06_SEA_DEN|emanuelwilson|SEA|rushing_yards", 50],
    ]);
    const t = davidTrends(games, sam);
    const sl = (id: string) => t.slices.find((x) => x.id === id)!;
    expect(sl("dboard:all")).toMatchObject({ n: 2, w: 1, l: 1 });
    expect(sl("dboard:pass_attempts").move).toBe(1);
    expect(sl("h2h:sam")).toMatchObject({ n: 2, w: 2, l: 0 });
    expect(sl("h2h:david")).toMatchObject({ n: 2, w: 1, l: 1 });
    expect(sl("h2h:agree")).toMatchObject({ n: 1, w: 1 });
    expect(sl("h2h:split-sam")).toMatchObject({ n: 1, w: 1 });
    expect(sl("h2h:split-david")).toMatchObject({ n: 1, l: 1 });
    expect(t.shared).toBe(2);
    expect(t.accuracy.find((a) => a.market === "pass_attempts")).toMatchObject({ n: 1, model: 15, line: 16.5, closer: 1, inRange: 0 });
    expect(t.h2h.find((a) => a.market === "rushing_yards")).toMatchObject({ n: 1, sam: 2, david: 18, samCloser: 1 });
    // Without Sam, the head to head is empty and David's board still grades.
    expect(davidTrends(games, new Map()).slices.find((x) => x.id === "h2h:david")!.n).toBe(0);
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

describe("Both agree, by estimated edge", () => {
  const strong = prop({ market: "rushing_yards", projection: 57.5, line: 67.5, over: -111, under: -109, lower: 40, upper: 80 });
  const thin = prop({}); // David 36 over 34.5 at -120

  it("uses the less confident model and nets out the price", () => {
    // Sam 57.2 vs David 57.5: David's 10 under is the smaller gap. 10 / (40 / 2.563) = z 0.64, about 74%, less -109's 52.2%.
    expect(agreeEdge(strong, 57.2)).toBeCloseTo(0.217, 2);
    // Half a yard past the line barely beats a coin flip, short of -120's 54.5%.
    expect(agreeEdge(thin, 35)!).toBeLessThan(0);
  });

  it("is null when they split or Sam has no number", () => {
    expect(agreeEdge(thin, 30)).toBeNull();
    expect(agreeEdge(thin, undefined)).toBeNull();
  });

  it("sorts agreements into the two edge bands", () => {
    expect(davidSliceSide("h2h:agree-edge-hi", strong, 57.2)).toBe("under");
    expect(davidSliceSide("h2h:agree-edge-lo", strong, 57.2)).toBeNull();
    expect(davidSliceSide("h2h:agree-edge-lo", thin, 35)).toBe("over");
    expect(davidSliceSide("h2h:agree-edge-hi", thin, 30)).toBeNull();
  });
});

describe("David's plays", () => {
  const strong = prop({ market: "rushing_yards", projection: 57.5, line: 67.5, over: -111, under: -109, lower: 40, upper: 80 });
  const thin = prop({}); // David 36 over 34.5 at -120

  it("is his own chance off his 80% range, less the price, at a 10% bar", () => {
    // Same numbers as the agree case with Sam out of it: 10 under, about 74% less -109's 52.2%.
    expect(davidEdge(strong)).toBeCloseTo(0.217, 2);
    expect(isDavidPlay(strong)).toBe(true);
    expect(isDavidPlay(thin)).toBe(false);
    expect(davidEdge(prop({ projection: 34.5 }))).toBeNull();
  });

  it("tracks plays as their own slices, graded from his board", () => {
    // Darnold attempts 49.5 over 34.5 with a 25 to 45 range: far past the total, a play; Wilson barely over, not one.
    const props = [prop({ id: "a", projection: 49.5 }), prop({ id: "b", player: "Emanuel Wilson", market: "rushing_yards", projection: 61, line: 60.5 })];
    const games = [{ week: 6, gameId: "2026_06_SEA_DEN", kickoff: "", props, capturedAt: "", firstSeenAt: "", first: {}, updatedAt: "", result: gradeDavid(props, box) }];
    const t = davidTrends(games, new Map([["2026_06_SEA_DEN|samdarnold|SEA|pass_attempts", 40]]));
    const sl = (id: string) => t.slices.find((x) => x.id === id)!;
    expect(sl("dplay:all")).toMatchObject({ group: "dplay", n: 1, w: 1 });
    expect(sl("dplay:pass_attempts").n).toBe(1);
    expect(sl("dplay:rushing_yards").n).toBe(0);
    expect(sl("dplay:sam-agree").n).toBe(1);
    expect(sl("dboard:all").n).toBe(2);
    expect(t.plays).toHaveLength(1);
    expect(t.plays[0]).toMatchObject({ week: 6, actual: 51, samProj: 40, bet: { side: "over", outcome: "W" } });
    expect(isDavidSlice("dplay:all") && isDavidSlice("dboard:all") && isDavidSlice("h2h:agree")).toBe(true);
    expect(isDavidSlice("play:all") || isDavidSlice("david:all")).toBe(false);
  });
});

describe("davidPropsLinks", () => {
  it("finds props links on his pages and skips build files", () => {
    const html = `<a href="/nfl">NFL</a><a href="/nfl/player-props?w=9">Props</a><link href="/_next/static/props-x.js"><a href="/nfl/matchups/1">m</a><a href="/NFL/Props">P</a>`;
    expect(davidPropsLinks(html)).toEqual(["/nfl/player-props", "/NFL/Props"]);
  });
  it("finds nothing on today's rebuilt page", () => {
    expect(davidPropsLinks(`<a href="/cfb">c</a><a href="/nfl/matchups/401873023">m</a>`)).toEqual([]);
  });
});
