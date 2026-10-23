import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseCsv, readGames, readStats } from "./data";
import { NflRunning, summarizeNfl, teamGames } from "./history";
import { gammaP, nflCdf, nflMedian, nflOverUnder, projectNflGame, type NflParams } from "./props";
import { ourNflMarkets } from "./market";
import { readPropBets, type PropBetRow } from "../lines";
import PARAMS from "./params.json";

const P = PARAMS as NflParams;
const rows = readStats(readFileSync("test/fixtures/models/nflverse-week-2026-ne-chi.csv", "utf8"));

describe("nflverse readers", () => {
  it("reads quoted CSV fields with commas", () => {
    expect(parseCsv('a,b\n"x, y",2\n')).toEqual([["a", "b"], ["x, y", "2"]]);
  });
  it("reads skill players' weekly rows", () => {
    const maye = rows.filter((r) => r.name === "Drake Maye");
    expect(maye[0]).toMatchObject({ team: "NE", week: 1, att: 33, passYds: 178, pos: "QB" });
    expect(rows.every((r) => ["QB", "RB", "WR", "TE"].includes(r.pos))).toBe(true);
  });
  it("reads the games file: spread as the home margin, total, ESPN id", () => {
    const g = readGames(readFileSync("test/fixtures/models/nflverse-games.csv", "utf8")).find((x) => x.game === "2026_07_NE_CHI")!;
    expect(g).toMatchObject({ home: "CHI", away: "NE", homeMargin: 3, total: 50.5, espn: "401873010" });
  });
});

describe("history", () => {
  it("adds team totals per game", () => {
    const t = teamGames(rows).get(`${rows[0].game}|${rows[0].team}`)!;
    const mine = rows.filter((r) => r.game === t.game && r.team === t.team);
    expect(t.att).toBe(mine.reduce((a, r) => a + r.att, 0));
  });
  it("summarizes a season and runs one forward", () => {
    const s = summarizeNfl(rows);
    expect(s.base.tgtPerAtt).toBeGreaterThan(0.5);
    expect(s.base.pos.WR.tgtShare).toBeGreaterThan(s.base.pos.QB.tgtShare);
    const run = new NflRunning();
    for (const w of [1, 2, 3, 4, 5, 6]) run.addWeek(rows.filter((r) => r.week === w));
    const id = rows.find((r) => r.name === "Drake Maye")!.id;
    expect(run.player(id, "NE", "QB", s).games).toHaveLength(6);
    expect(run.rotation("NE").length).toBeGreaterThan(5);
  });
});

describe("distributions", () => {
  it("regularized gamma matches closed forms", () => {
    expect(gammaP(1, 1)).toBeCloseTo(1 - Math.exp(-1), 9);
    expect(gammaP(2, 3)).toBeCloseTo(1 - 4 * Math.exp(-3), 9);
    // 1 - e^-20 (1 + 20 + 200 + 1333.3 + 6666.7)
    expect(gammaP(5, 20)).toBeCloseTo(1 - Math.exp(-20) * (1 + 20 + 200 + 8000 / 6 + 160000 / 24), 9);
  });
  it("yardage over and under add to 1 on a half line, and the median splits it", () => {
    const x = nflOverUnder("rec_yds", 55, 49.5, { ...P, calib: 1 });
    expect(x.over + x.under).toBeCloseTo(1, 9);
    const med = nflMedian("rec_yds", 55, P);
    expect(med).toBeLessThan(55); // skewed right
    expect(nflCdf("rec_yds", med, 55, P)).toBeCloseTo(0.5, 4);
  });
  it("receptions count on whole numbers", () => {
    const x = nflOverUnder("rec", 4.2, 4, P);
    expect(x.push).toBeGreaterThan(0);
    expect(x.over + x.under + x.push).toBeCloseTo(1, 9);
  });
});

describe("projectNflGame", () => {
  const s = summarizeNfl(rows);
  const run = new NflRunning();
  for (const w of [1, 2, 3, 4, 5, 6]) run.addWeek(rows.filter((r) => r.week === w));
  const ne = run.rotation("NE");
  const players = ne.map((id) => run.player(id, "NE", "", s));
  const teams = { NE: run.team("NE", s), CHI: run.team("CHI", s) };
  it("projects a QB's passing and nobody else's", () => {
    const pr = projectNflGame(players, teams, "CHI", 3, s.base, P);
    const maye = pr.find((x) => x.id === rows.find((r) => r.name === "Drake Maye")!.id)!;
    expect(maye.mean.pass_yds).toBeGreaterThan(150);
    expect(pr.filter((x) => x.mean.pass_yds > 0).length).toBeLessThanOrEqual(players.filter((p) => p.pos === "QB").length);
  });
  it("hands an absent receiver's targets to the rest when sharing is on", () => {
    const wr = players.filter((p) => p.pos === "WR");
    const [gone, ...rest] = wr;
    const others = players.filter((p) => p !== gone);
    const tg = (absent: typeof players, share: boolean) => projectNflGame(others, teams, "CHI", 3, s.base, { ...P, share }, absent).reduce((a, x) => a + x.tgt, 0);
    expect(tg([gone], true)).toBeGreaterThan(tg([], true));
    expect(tg([gone], false)).toBeCloseTo(tg([], false), 9);
    expect(rest.length).toBeGreaterThanOrEqual(0);
  });
});

describe("ourNflMarkets (DK lines, NE at CHI 2026-10-22, no prices posted)", () => {
  const lines = readPropBets((JSON.parse(readFileSync("test/fixtures/models/espn-propbets-nfl-401873010.json", "utf8")) as { items: PropBetRow[] }).items, "nfl");
  const rec = [...lines.values()].find((l) => l.type === "Total Receiving Yards (incl. overtime)")!;
  const names = new Map([[rec.athlete, { name: "Test Receiver", team: "NE" }]]);
  const proj = (y: number) => new Map([[rec.athlete, { id: "x", team: "NE", tgt: 6, car: 0, att: 0, mean: { rec: 4, rec_yds: y, rush_yds: 0, pass_yds: 0 } }]]);
  it("assumes -110 when neither ESPN nor David has a price, says so, and claims no edge", () => {
    const { markets, extra } = ourNflMarkets(lines, proj(rec.current.line! * 2), names, () => null, P);
    const m = markets.find((x) => x.stat === "rec_yds")!;
    expect(m.books[0]).toMatchObject({ over: -110, under: -110 });
    expect(extra[m.id].price).toBe("assumed");
    // Our number still leans over, but with no real price there is no edge to claim.
    expect(m.lean).toBe("over");
    expect(m.side).toBeNull();
    expect(m.clears).toBe(false);
  });
  it("takes David's price when his line matches", () => {
    const { markets, extra } = ourNflMarkets(lines, proj(rec.current.line!), names, () => ({ over: -120, under: 100 }), P);
    const m = markets.find((x) => x.stat === "rec_yds")!;
    expect(m.books[0]).toMatchObject({ over: -120, under: 100 });
    expect(extra[m.id].price).toBe("david");
  });
  it("moves to DK's line from the morning read when ESPN's differs, and keeps ESPN's", () => {
    const at = rec.current.line! + 2;
    const { markets, extra } = ourNflMarkets(lines, proj(rec.current.line!), names, () => ({ over: -112, under: -112, line: at, source: "odds-api" }), P);
    const m = markets.find((x) => x.stat === "rec_yds")!;
    expect(m.line).toBe(at);
    expect(m.books[0]).toMatchObject({ line: at, over: -112, under: -112 });
    expect(extra[m.id]).toMatchObject({ price: "odds-api", espnLine: rec.current.line });
  });
});
