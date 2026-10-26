import { describe, expect, it } from "vitest";
import { adotYpt, impliedPoints, oppFactor, projectNflGame, teamVolume, type NflBase, type NflParams, type NflPlayerInput, type NflTeamInput } from "./props";
import { defenseTables } from "./history";
import PARAMS from "./params.json";

const P = PARAMS as NflParams;
const pos = { tgtShare: 0.15, carShare: 0.3, attShare: 0.9, ypt: 8, cr: 0.65, ypc: 4.3, ypa: 6.8 };
const base: NflBase = { att: 34, car: 26, tgtPerAtt: 0.9, pos: { QB: pos, RB: pos, WR: pos, TE: pos } };
const off: NflParams = { ...P, implied: undefined, kOpp: undefined, adot: undefined };

describe("candidate inputs", () => {
  it("implied points split the total by the margin", () => {
    expect(impliedPoints(47, 3)).toBe(25);
    expect(impliedPoints(47, -3)).toBe(22);
  });

  it("opponent factor shrinks toward 1 and is 1 with no games", () => {
    expect(oppFactor(0, 0, 250, 16)).toBe(1);
    expect(oppFactor(300 * 4, 4, 250, 16)).toBeCloseTo((1200 + 16 * 250) / (20 * 250));
    expect(oppFactor(500, 2, 0, 16)).toBe(1);
  });

  it("depth of target maps air yards to yards per target, shrunk toward the mean", () => {
    const q = { w: 1, a: 6, b: 0.2, k: 10, mean: 8 };
    expect(adotYpt(undefined, q)).toBeCloseTo(7.6);
    expect(adotYpt({ yds: 120, tgt: 10 }, q)).toBeCloseTo(6 + 0.2 * 10);
  });

  it("team volume scales with implied points, and not at all when off", () => {
    const t: NflTeamInput = { team: "A", games: [{ att: 34, car: 26 }] };
    expect(teamVolume(t, 0, base, off, 30)).toEqual(teamVolume(t, 0, base, off));
    const on = teamVolume(t, 0, base, { ...off, implied: { e: 0.3, mean: 22.65 } }, 30);
    expect(on.att / teamVolume(t, 0, base, off).att).toBeCloseTo(Math.pow(30 / 22.65, 0.3));
  });

  it("the opponent's defense moves passing yards; inputs off reproduce the old projection", () => {
    const qb: NflPlayerInput = { id: "q", team: "A", pos: "QB", games: [{ week: 1, team: "A", att: 34, passYds: 240, car: 2, rushYds: 5, tgt: 0, rec: 0, recYds: 0, teamAtt: 34, teamCar: 26, teamTgt: 31 }] };
    const league = { "QB:pass_yds": 220 };
    const teams = (allowed: number): { [t: string]: NflTeamInput } => ({
      A: { team: "A", games: [{ att: 34, car: 26 }] },
      B: { team: "B", games: [{ att: 34, car: 26 }], defense: { games: 4, allowed: { "QB:pass_yds": allowed }, league } },
    });
    const plain = projectNflGame([qb], teams(880), "A", 0, base, off)[0].mean.pass_yds;
    const soft = projectNflGame([qb], teams(1200), "A", 0, base, { ...off, kOpp: { pass_yds: 16 } })[0].mean.pass_yds;
    expect(projectNflGame([qb], teams(1200), "A", 0, base, off)[0].mean.pass_yds).toBe(plain);
    expect(soft / plain).toBeCloseTo(oppFactor(1200, 4, 220, 16));
  });
});


describe("defenseTables", () => {
  it("totals what each defense allowed by position and averages the league per team-game", () => {
    const r = (game: string, team: string, opp: string, pos: string, recYds: number) =>
      ({ id: `${team}${pos}`, name: "", pos, season: 2026, week: 1, game, team, opp, att: 0, passYds: 0, passTd: 0, car: 0, rushYds: 0, rushTd: 0, tgt: 0, rec: 1, recYds, recTd: 0 }) as never;
    const t = defenseTables([r("g1", "KC", "BUF", "WR", 100), r("g1", "BUF", "KC", "WR", 60), r("g2", "KC", "BUF", "TE", 40)]);
    expect(t.BUF.games).toBe(2);
    expect(t.BUF.allowed["WR:rec_yds"]).toBe(100);
    expect(t.BUF.allowed["TE:rec_yds"]).toBe(40);
    expect(t.KC.games).toBe(1);
    expect(t.KC.league["WR:rec_yds"]).toBeCloseTo(160 / 3, 6);
  });
});
