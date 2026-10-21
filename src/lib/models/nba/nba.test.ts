import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { compactGame, type EspnNbaSummary } from "./box";
import { ingest, rotation, summarize, type PlayerEntry, type TeamEntry } from "./history";
import { cdf, lgamma, nbPmf, overUnder, projectGame, shareMinutes, toTeamMinutes, type LeagueBase, type NbaParams, type PlayerInput } from "./props";
import { noVig, ourMarkets } from "./market";
import { readPropBets, type PropBetRow } from "../lines";
import { ourPropCandidates } from "../learn";
import PARAMS from "./params.json";

const P = PARAMS as NbaParams;
const summary = JSON.parse(readFileSync("test/fixtures/models/espn-nba-summary-401909088.json", "utf8")) as EspnNbaSummary;

describe("compactGame (BOS at DET, 2026-10-20)", () => {
  const g = compactGame("401909088", summary)!;
  it("reads the box score", () => {
    expect(g.home).toBe("DET");
    expect(g.away).toBe("BOS");
    expect(g.score).toEqual({ DET: 121, BOS: 113 });
    const pg = g.players.find((p) => p.name === "Paul George")!;
    expect(pg).toMatchObject({ team: "BOS", starter: true, min: 31, pts: 38, reb: 5, ast: 3, threes: 7 });
  });
  it("reads DraftKings' spread from the home side, and the total", () => {
    expect(g.spread).toBe(1.5);
    expect(g.total).toBe(220.5);
  });
  it("reads the opening tip and the shots up to the first make", () => {
    expect(g.jump).toEqual({ jumpers: ["4351852", "4433621"], team: "BOS" });
    expect(g.shots.map((s) => s.made)).toEqual([false, false, true]);
    expect(g.shots.at(-1)).toEqual({ player: "3908845", team: "DET", made: true });
  });
  it("counts possessions per team", () => {
    expect(g.poss.BOS).toBeGreaterThan(90);
    expect(g.poss.DET).toBeGreaterThan(90);
  });
  it("is null until the game is final", () => {
    const pre = { ...summary, header: { competitions: [{ ...summary.header!.competitions![0], status: { type: { completed: false } } }] } };
    expect(compactGame("x", pre)).toBeNull();
  });
});

describe("history tables", () => {
  const g = compactGame("401909088", summary)!;
  it("summarizes a season into priors and baselines", () => {
    const s = summarize([g]);
    expect(s.priors["4251"]).toMatchObject({ games: 1, min: 31, pts: 38 });
    expect(s.base.minStarter).toBeGreaterThan(s.base.minBench);
    expect(s.base.rotationSize).toBe(g.players.length / 2);
  });
  it("ingests a final and keeps the rotation", () => {
    const players: { [id: string]: PlayerEntry } = {};
    const teams: { [t: string]: TeamEntry } = {};
    ingest(players, teams, g);
    expect(players["4251"].games).toHaveLength(1);
    expect(rotation(teams.BOS).length).toBe(g.players.filter((p) => p.team === "BOS").length);
  });
});

describe("distributions", () => {
  it("lgamma matches factorials", () => {
    expect(lgamma(5)).toBeCloseTo(Math.log(24), 8);
    expect(lgamma(0.5)).toBeCloseTo(Math.log(Math.sqrt(Math.PI)), 8);
  });
  it("negative binomial sums to 1 with the right mean", () => {
    let s = 0;
    let m = 0;
    for (let k = 0; k < 200; k++) {
      const p = nbPmf(k, 4.2, 12);
      s += p;
      m += k * p;
    }
    expect(s).toBeCloseTo(1, 6);
    expect(m).toBeCloseTo(4.2, 4);
  });
  it("a half-point line has no push, over + under = 1", () => {
    const x = overUnder("reb", 6.3, 5.5, P);
    expect(x.push).toBe(0);
    expect(x.over + x.under).toBeCloseTo(1, 9);
    expect(x.over).toBeGreaterThan(0.5);
  });
  it("a whole line splits off the push", () => {
    const x = overUnder("pts", 20, 20, P);
    expect(x.push).toBeGreaterThan(0);
    expect(x.over + x.under + x.push).toBeCloseTo(1, 9);
  });
  it("points cdf is monotone", () => {
    expect(cdf("pts", 10, 20, P)).toBeLessThan(cdf("pts", 20, 20, P));
  });
});

describe("minutes", () => {
  it("scales a team to 240 with nobody above 44", () => {
    const m = toTeamMinutes([40, 38, 36, 30, 30, 25, 20, 15, 10]);
    expect(m.reduce((a, x) => a + x, 0)).toBeCloseTo(240, 1);
    expect(Math.max(...m)).toBeLessThanOrEqual(44);
  });
  it("hands an absent guard's minutes to the guards first", () => {
    const m = shareMinutes([30, 30, 30, 20, 20], ["G", "G", "F", "F", "C"], [{ min: 20, pos: "G" }], true);
    expect(m[0]).toBeCloseTo(40);
    expect(m[2]).toBe(30);
  });
  it("never pushes a team past 240", () => {
    const m = shareMinutes([40, 40, 40, 40, 40, 30], ["G", "G", "F", "F", "C", "C"], [{ min: 30, pos: "C" }], false);
    expect(m.reduce((a, x) => a + x, 0)).toBeLessThanOrEqual(240.01);
  });
});

const base: LeagueBase = {
  minStarter: 31,
  minBench: 17,
  rate: { G: { pts: 0.45, reb: 0.12, ast: 0.13, threes: 0.06 }, F: { pts: 0.45, reb: 0.2, ast: 0.08, threes: 0.05 }, C: { pts: 0.45, reb: 0.3, ast: 0.07, threes: 0.02 } },
  pace: 100,
  rotationSize: 10,
};
const player = (id: string, team: string, ppm: number): PlayerInput => ({
  id,
  team,
  pos: "G",
  games: [],
  prior: { games: 70, min: 70 * 32, pts: 70 * 32 * ppm, reb: 70 * 32 * 0.12, ast: 70 * 32 * 0.13, threes: 70 * 32 * 0.06, pos: "G" },
});

describe("projectGame", () => {
  it("projects from last season when there is nothing this season", () => {
    const [a] = projectGame([player("1", "AAA", 0.8)], { AAA: { team: "AAA", poss: [] }, BBB: { team: "BBB", poss: [] } }, null, base, { ...P, normalize: "none" });
    expect(a.min).toBeCloseTo(32 * P.minScale, 5);
    // Rate shrinks from 0.8 toward the guard rate 0.45 by kPrior minutes of 2240.
    const rate = (0.8 * 2240 + P.kPrior * 0.45) / (2240 + P.kPrior);
    expect(a.mean.pts).toBeCloseTo(a.min * rate, 4);
  });
  it("a fast opponent raises the projection when pace is on", () => {
    const teams = (opp: number) => ({ AAA: { team: "AAA", poss: [], priorPace: 98 }, BBB: { team: "BBB", poss: [], priorPace: opp } });
    const slow = projectGame([player("1", "AAA", 0.6)], teams(96), null, base, { ...P, pace: true })[0].mean.pts;
    const fast = projectGame([player("1", "AAA", 0.6)], teams(104), null, base, { ...P, pace: true })[0].mean.pts;
    expect(fast).toBeGreaterThan(slow);
  });
});

describe("ourMarkets (DK lines, ATL at ORL 2026-10-21)", () => {
  const lines = readPropBets((JSON.parse(readFileSync("test/fixtures/models/espn-propbets-nba-401909834.json", "utf8")) as { items: PropBetRow[] }).items, "nba");
  it("takes the vig out", () => {
    const f = noVig(-113, -113);
    expect(f.over).toBeCloseTo(0.5, 9);
  });
  it("marks a side only when our chance beats DK's break-even", () => {
    // Athlete 6478: Total Points 8.5 at -113/-113. A 12-point projection is an over edge; 8.5 is none.
    const names = new Map([["6478", { name: "Test Player", team: "ORL" }]]);
    const proj = (pts: number) => new Map([["6478", { id: "6478", team: "ORL", min: 25, mean: { pts, reb: 3, ast: 2, threes: 1 } }]]);
    const hi = ourMarkets(lines, proj(12), names, P).markets.find((m) => m.stat === "pts")!;
    expect(hi.line).toBe(8.5);
    expect(hi.side).toBe("over");
    expect(hi.clears).toBe(true);
    expect(hi.books[0]).toMatchObject({ book: "DraftKings", over: -113, under: -113, win: true });
    expect(hi.gap).toBeGreaterThan(0);
    const even = ourMarkets(lines, proj(8.5), names, P).markets.find((m) => m.stat === "pts")!;
    expect(even.side).toBeNull();
    expect(even.clears).toBe(false);
  });
});

describe("our learning candidates", () => {
  it("builds edge and lean slices with parents", () => {
    const c = ourPropCandidates([], ["pts", "reb", "ast", "threes"]);
    expect(c.find((x) => x.id === "edge:pts")?.parent).toBe("edge:all");
    expect(c.find((x) => x.id === "lean:all")?.parent).toBeUndefined();
    expect(c.every((x) => x.bets.length === 0)).toBe(true);
  });
});
