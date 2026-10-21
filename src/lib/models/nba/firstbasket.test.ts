import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { compactGame, type EspnNbaSummary } from "./box";
import { emptyTables, expectedJumper, fbBets, fbBoard, fieldNoVig, firstBasketOf, foldFb, forecast, starterShares, tipSkill, type FbParams } from "./firstbasket";
import { readPropBets, type PropBetRow } from "../lines";
import FB from "./fb-params.json";

const P = FB as FbParams;
const g = compactGame("401909088", JSON.parse(readFileSync("test/fixtures/models/espn-nba-summary-401909088.json", "utf8")) as EspnNbaSummary)!;

describe("first basket tables (BOS at DET, 2026-10-20)", () => {
  const t = emptyTables();
  foldFb(t, g);
  it("credits the tip to the jumper whose team gained possession", () => {
    // Mitchell Robinson (BOS, 4351852) vs Jalen Duren (DET, 4433621); Boston gained it.
    expect(t.tips["4351852"]).toEqual({ n: 1, w: 1 });
    expect(t.tips["4433621"]).toEqual({ n: 1, w: 0 });
    expect(tipSkill(t, "4351852", P)).toBeGreaterThan(tipSkill(t, "4433621", P));
  });
  it("records the first basket against the tip", () => {
    expect(firstBasketOf(g)).toEqual({ player: "3908845", team: "DET" });
    expect(t.tipTeamFirst).toEqual({ n: 1, first: 0 });
    expect(t.starts["3908845"].first).toBe(1);
  });
});

describe("forecast", () => {
  const t = emptyTables();
  foldFb(t, g);
  const team = (x: string) => ({ team: x, starters: g.players.filter((p) => p.team === x && p.starter).map((p) => ({ id: p.id, pos: p.pos })) });
  it("adds to 1 across the ten starters", () => {
    const f = forecast(t, team("DET"), team("BOS"), P);
    expect(f.players).toHaveLength(10);
    expect(f.players.reduce((a, x) => a + x.p, 0)).toBeCloseTo(1, 9);
    expect(f.jumpers.BOS).toBe("4351852");
  });
  it("shares within a team add to 1", () => {
    const ids = team("DET").starters.map((x) => x.id);
    expect(starterShares(t, ids, P).reduce((a, x) => a + x, 0)).toBeCloseTo(1, 9);
  });
  it("picks the starter with the most jumps", () => {
    expect(expectedJumper(t, team("DET").starters)).toBe("4433621");
  });
});

describe("DK First Basket (ATL at ORL 2026-10-21)", () => {
  const lines = readPropBets((JSON.parse(readFileSync("test/fixtures/models/espn-propbets-nba-401909834.json", "utf8")) as { items: PropBetRow[] }).items, "nba");
  const dk = [...lines.values()].filter((l) => l.type === "First Basket").map((l) => ({ id: l.athlete, price: l.current.over! }));
  it("takes the vig out across the field", () => {
    const f = fieldNoVig(dk);
    expect([...f.values()].reduce((a, x) => a + x, 0)).toBeCloseTo(1, 9);
    expect(dk).toHaveLength(10);
  });
  it("builds a board from DK's field as the starters, and settles edges", () => {
    const names = new Map(dk.map((x, i) => [x.id, { name: `P${i}`, team: i < 5 ? "ORL" : "ATL", pos: "G" }]));
    const b = fbBoard("ORL", "ATL", dk, {}, names, emptyTables(), P)!;
    expect(b.starters).toBe("dk");
    expect(b.players).toHaveLength(10);
    // With no history every starter is even inside his team and the tip is a coin flip.
    expect(b.tip).toBe(0.5);
    const edges = b.players.filter((x) => x.edge);
    const won = edges[0];
    const bets = fbBets({ ...b, result: won ? { player: won.id, team: won.team } : null });
    expect(bets.length).toBe(edges.length);
    if (won) expect(bets.find((x) => x.id === won.id)!.net).toBeCloseTo(won.price! / 100, 2);
    expect(fbBets(b)).toEqual([]); // ungraded
  });
});
