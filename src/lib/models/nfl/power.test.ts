import { describe, expect, it } from "vitest";
import { PlayAgg, carryRatings, edges, packRatings, powerLine, powerMargin, ratingsByDay, solveRatings, splitCsvLine, unpackRatings, type PowerParams, type Rating, type TeamGame } from "./power";
import { powerSignals, signalRecords, trackedGames } from "./spread-track";
import type { ForecastSnapshot } from "@/lib/picks/forecasts";

const tg = (game: string, gameday: string, team: string, opp: string, passEpa: number, rushEpa = 0, season = 2026): TeamGame => ({ game, season, gameday, team, opp, passEpa, passN: 40, rushEpa, rushN: 25 });
const P: PowerParams = { prior: 800, carry: 0.5, wp: 0, hfa: 2, kPass: 40, kRush: 40, kRest: 0.2, kQb: -2.5 };

describe("play aggregation", () => {
  const head = "game_id,season,season_type,game_date,posteam,defteam,pass,rush,epa,wp,qb_kneel,qb_spike,two_point_attempt";
  const fold = (rows: string[], wp = 0) => {
    const a = new PlayAgg(wp);
    a.header(splitCsvLine(head));
    for (const r of rows) a.row(splitCsvLine(r));
    return a.teamGames();
  };

  it("sums dropbacks and runs per team-game, skipping kneels, spikes, two-point tries and non-plays", () => {
    const g = fold([
      "2026_01_KC_BUF,2026,REG,2026-09-10,KC,BUF,1,0,0.5,0.5,0,0,0",
      "2026_01_KC_BUF,2026,REG,2026-09-10,KC,BUF,0,1,-0.2,0.5,0,0,0",
      "2026_01_KC_BUF,2026,REG,2026-09-10,KC,BUF,0,1,-1,0.5,1,0,0", // kneel
      "2026_01_KC_BUF,2026,REG,2026-09-10,KC,BUF,1,0,2,0.5,0,0,1", // two-point try
      "2026_01_KC_BUF,2026,REG,2026-09-10,KC,BUF,0,0,1,0.5,0,0,0", // punt
      "2026_01_KC_BUF,2026,PRE,2026-08-10,KC,BUF,1,0,1,0.5,0,0,0", // preseason
    ]);
    expect(g).toEqual([{ game: "2026_01_KC_BUF", season: 2026, gameday: "2026-09-10", team: "KC", opp: "BUF", passEpa: 0.5, passN: 1, rushEpa: -0.2, rushN: 1 }]);
  });

  it("drops garbage time by win chance and modernizes old team codes", () => {
    const g = fold(["2015_01_SD_STL,2015,REG,2015-09-13,SD,STL,1,0,0.3,0.97,0,0,0", "2015_01_SD_STL,2015,REG,2015-09-13,SD,STL,1,0,0.1,0.6,0,0,0"], 0.05);
    expect(g[0]).toMatchObject({ team: "LAC", opp: "LA", passN: 1, passEpa: 0.1 });
  });
});

describe("ratings", () => {
  it("with no plays, a team sits at its carried prior", () => {
    const last = new Map<string, Rating>([["KC", { offPass: 0.2, defPass: -0.1, offRush: 0.04, defRush: 0 }]]);
    const prior = carryRatings(last, 0.5);
    expect(prior.get("KC")).toEqual({ offPass: 0.1, defPass: -0.05, offRush: 0.02, defRush: 0 });
    expect(solveRatings([], prior, 800).get("KC")).toEqual(prior.get("KC"));
  });

  it("adjusts for the opponent: a big passing day against a bad defense counts for less", () => {
    // A and B each threw for +0.3/play, A against C (who also gave up +0.3 to D), B against E (who held F to -0.1).
    const obs = [tg("1", "2026-09-10", "A", "C", 12), tg("2", "2026-09-10", "B", "E", 12), tg("3", "2026-09-17", "D", "C", 12), tg("4", "2026-09-17", "F", "E", -4)];
    const r = solveRatings(obs, new Map(), 20);
    expect(r.get("B")!.offPass).toBeGreaterThan(r.get("A")!.offPass);
    expect(r.get("C")!.defPass).toBeGreaterThan(r.get("E")!.defPass); // C gives up more
  });

  it("shrinks toward the prior: more prior plays, smaller move", () => {
    const obs = [tg("1", "2026-09-10", "A", "B", 20), tg("1", "2026-09-10", "B", "A", -20)];
    const loose = solveRatings(obs, new Map(), 10).get("A")!.offPass;
    const tight = solveRatings(obs, new Map(), 1000).get("A")!.offPass;
    expect(Math.abs(loose)).toBeGreaterThan(Math.abs(tight));
    expect(tight).toBeGreaterThan(0);
  });

  it("is leak-free: a day's ratings never see that day's or later plays", () => {
    const obs = [tg("1", "2026-09-10", "A", "B", 20), tg("1", "2026-09-10", "B", "A", -20), tg("2", "2026-09-17", "A", "B", -40), tg("2", "2026-09-17", "B", "A", 40)];
    const out = [...ratingsByDay(obs, 100, 0.5)];
    const day = (d: string) => out.find((x) => "day" in x && x.day === d) as { ratings: Map<string, Rating> };
    expect(day("2026-09-10").ratings.get("A")?.offPass ?? 0).toBe(0); // nothing before week 1
    expect(day("2026-09-17").ratings.get("A")!.offPass).toBeGreaterThan(0); // week 1 only: A good
    const fin = out.find((x) => "final" in x) as { final: Map<string, Rating> };
    expect(fin.final.get("A")!.offPass).toBeLessThan(0); // the week 2 blowout lands only in the final
  });

  it("carries a season's final ratings into the next, pulled toward average", () => {
    const obs = [tg("1", "2025-09-10", "A", "B", 20, 0, 2025), tg("1", "2025-09-10", "B", "A", -20, 0, 2025), tg("2", "2026-09-10", "A", "B", 0, 0, 2026)];
    const out = [...ratingsByDay(obs, 100, 0.5)];
    const f25 = (out.find((x) => "final" in x && x.season === 2025) as { final: Map<string, Rating> }).final;
    const d26 = (out.find((x) => "day" in x && x.season === 2026) as { ratings: Map<string, Rating> }).ratings;
    expect(d26.get("A")!.offPass).toBeCloseTo(f25.get("A")!.offPass * 0.5, 10);
  });

  it("packs and unpacks for the params file", () => {
    const r = new Map<string, Rating>([["KC", { offPass: 0.123456, defPass: -0.01, offRush: 0, defRush: 0.02 }]]);
    expect(unpackRatings(packRatings(r)).get("KC")).toEqual({ offPass: 0.12346, defPass: -0.01, offRush: 0, defRush: 0.02 });
  });
});

describe("margin and line", () => {
  const r = new Map<string, Rating>([
    ["KC", { offPass: 0.1, defPass: -0.05, offRush: 0.02, defRush: 0 }],
    ["LV", { offPass: -0.1, defPass: 0.05, offRush: -0.02, defRush: 0.02 }],
  ]);

  it("edges are home minus away expected EPA per play", () => {
    const e = edges(r, "KC", "LV");
    expect(e.pass).toBeCloseTo(0.1 + 0.05 - (-0.1 + -0.05), 10); // 0.3
    expect(e.rush).toBeCloseTo(0.02 + 0.02 - (-0.02 + 0), 10); // 0.06
    expect(edges(r, "LV", "KC").pass).toBeCloseTo(-0.3, 10);
  });

  it("turns edges into a home margin and a home spread (negative = home favored)", () => {
    const x = { ...edges(r, "KC", "LV"), rest: 0, qb: 0, neutral: false };
    expect(powerMargin(x, P)).toBeCloseTo(2 + 40 * 0.3 + 40 * 0.06, 10); // 16.4
    expect(powerLine(x, P)).toBe(-16.4);
    expect(powerLine({ ...x, neutral: true }, P)).toBe(-14.4); // no home field
    expect(powerLine({ pass: 0, rush: 0, rest: 0, qb: 1, neutral: true }, P)).toBe(2.5); // home has a new QB
    expect(Object.is(powerLine({ pass: 0, rush: 0, rest: 0, qb: 0, neutral: true }, P), -0)).toBe(false);
  });
});

describe("play-by-play signals", () => {
  const snap = (at: string, line: number, power?: number): ForecastSnapshot => ({
    at,
    week: 9,
    home: "KC",
    away: "LV",
    ref: { line, homePrice: -110, awayPrice: -105, kickoff: "2026-11-08T18:00:00Z", source: "test", fetchedAt: at },
    ours: { market: line, model: line - 0.1, ...(power !== undefined ? { power } : {}) },
  });

  it("fires on the side our line likes, at 1.5+ and 3+", () => {
    expect(powerSignals(snap("2026-11-03T12:00:00Z", -3, -4))).toEqual([]); // 1 point off
    expect(powerSignals(snap("2026-11-03T12:00:00Z", -3, -4.5))).toEqual([{ id: "power", side: "home", price: -110 }]);
    expect(powerSignals(snap("2026-11-03T12:00:00Z", -3, 0.5)).map((x) => `${x.id}:${x.side}`)).toEqual(["power:away", "power3:away"]);
    expect(powerSignals(snap("2026-11-03T12:00:00Z", -3))).toEqual([]);
  });

  it("is judged from the first read that had our line, at that read's number", () => {
    // First read (no play-by-play line yet) at -3; the line ships on the second read at -2.5, liking home by 3.5.
    const games = trackedGames(
      [snap("2026-11-02T12:00:00Z", -3), snap("2026-11-03T12:00:00Z", -2.5, -6), snap("2026-11-05T12:00:00Z", -4, -6)],
      [{ week: 9, home: "KC", away: "LV", open: -3, close: -4, totalOpen: null, totalClose: null, final: { home: 24, away: 21 } }],
    );
    expect(games).toHaveLength(1);
    expect(games[0].line).toBe(-3);
    expect(games[0].signals.filter((x) => x.id.startsWith("power"))).toEqual([
      { id: "power", side: "home", price: -110, line: -2.5 },
      { id: "power3", side: "home", price: -110, line: -2.5 },
    ]);
    const rec = signalRecords(games).find((r) => r.id === "power")!;
    expect([rec.w, rec.l]).toEqual([1, 0]); // won by 3 laying 2.5
    expect(rec.clv).toBe(1.5); // took -2.5, closed -4
  });
});
