import { describe, expect, it } from "vitest";
import { gradeBet, netUnits, summarize, validateBet, type FinalGame, type MoneyBet } from "./bets";

const base = { placedAt: "2026-10-15T20:00:00Z", sport: "nfl", date: "2026-10-15", away: "SEA", home: "DEN", price: -110, units: 1 } as const;
const bet = (x: Partial<MoneyBet>): MoneyBet => ({ id: "t", label: "t", market: "spread", ...base, ...x }) as MoneyBet;

const box = new Map([["jaxonsmithnjigba", { pass_yds: 0, rush_yds: 0, rec_yds: 101, rec: 7 }], ["jaylenwaddle", { pass_yds: 0, rush_yds: 0, rec_yds: 46.5, rec: 3 }]]);
// SEA 24, DEN 20; first half SEA 10, DEN 10.
const game: FinalGame = { final: true, away: { abbr: "SEA", score: 24, h1: 10 }, home: { abbr: "DEN", score: 20, h1: 10 }, box };

describe("gradeBet", () => {
  it("covers a spread", () => expect(gradeBet(bet({ market: "spread", team: "SEA", line: -2.5 }), game)?.outcome).toBe("W"));
  it("misses a spread", () => expect(gradeBet(bet({ market: "spread", team: "SEA", line: -4.5 }), game)?.outcome).toBe("L"));
  it("pushes a whole-number spread", () => expect(gradeBet(bet({ market: "spread", team: "SEA", line: -4 }), game)?.outcome).toBe("P"));
  it("grades the dog's spread", () => expect(gradeBet(bet({ market: "spread", team: "DEN", line: 2.5 }), game)?.outcome).toBe("L"));
  it("a first-half moneyline tie is a push", () => expect(gradeBet(bet({ market: "h1_moneyline", team: "SEA" }), game)?.outcome).toBe("P"));
  it("first-half total uses the half", () => expect(gradeBet(bet({ market: "h1_total", side: "under", line: 20.5 }), game)?.outcome).toBe("W"));
  it("full total", () => expect(gradeBet(bet({ market: "total", side: "over", line: 44.5 }), game)?.outcome).toBe("L"));
  it("a prop from the box score", () => {
    const r = gradeBet(bet({ market: "prop", player: "Jaxon Smith-Njigba", stat: "rec_yds", side: "over", line: 92.5 }), game);
    expect(r).toEqual({ outcome: "W", actual: "101 receiving yards" });
  });
  it("a player not in the box score is void", () =>
    expect(gradeBet(bet({ market: "prop", player: "RJ Harvey", stat: "rec_yds", side: "over", line: 21.5 }), game)?.outcome).toBe("void"));
  it("waits for a final", () => expect(gradeBet(bet({ market: "spread", team: "SEA", line: -2.5 }), { ...game, final: false })).toBeNull());
  it("can't read a team that isn't in the game", () => expect(gradeBet(bet({ market: "moneyline", team: "KC" }), game)).toBeNull());
});

describe("netUnits", () => {
  it("pays at the price", () => expect(netUnits("W", 4, -110)).toBe(3.64));
  it("plus money", () => expect(netUnits("W", 1, 150)).toBe(1.5));
  it("loses the risk", () => expect(netUnits("L", 2, -110)).toBe(-2));
  it("push and void are zero", () => expect(netUnits("P", 2, -110) + netUnits("void", 2, -110)).toBe(0));
});

describe("summarize", () => {
  it("record, roi and a running curve in grading order", () => {
    const g = (id: string, outcome: "W" | "L" | "P", net: number, at: string, units = 1) =>
      bet({ id, units, result: { outcome, net, gradedAt: at, by: "espn" } });
    const s = summarize([g("b", "L", -1, "2026-10-16T01:00:00Z"), g("a", "W", 3.64, "2026-10-16T00:00:00Z", 4), g("c", "P", 0, "2026-10-16T02:00:00Z"), bet({ id: "d" })]);
    expect([s.wins, s.losses, s.pushes, s.pending]).toEqual([1, 1, 1, 1]);
    expect(s.net).toBe(2.64);
    expect(s.roi).toBe(0.528);
    expect(s.curve.map((c) => c.net)).toEqual([3.64, 2.64, 2.64]);
  });
});

describe("validateBet", () => {
  it("accepts a prop", () => {
    const v = validateBet({ id: "w6-jsn", label: "JSN o92.5", market: "prop", player: "Jaxon Smith-Njigba", stat: "rec_yds", side: "over", line: 92.5, ...base });
    expect(typeof v).toBe("object");
  });
  it("names the missing piece", () => {
    expect(validateBet({ id: "x-1", label: "x", market: "spread", team: "SEA", ...base })).toMatch(/line/);
    expect(validateBet({ id: "x-1", label: "x", market: "moneyline", team: "KC", ...base })).toMatch(/team/);
    expect(validateBet({ id: "X Y", label: "x", market: "moneyline", team: "SEA", ...base })).toMatch(/id/);
    expect(validateBet({ id: "x-1", label: "x", market: "prop", side: "over", line: 1, player: "a", stat: "td", ...base })).toMatch(/stat/);
  });
});
