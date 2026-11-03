import { describe, expect, it } from "vitest";
import { readCbbLine, spreadAgainstMoneyline, type CbbOdds } from "./lines";
import GONZAGA from "./fixtures-gonzaga-odds.json";

// 2026-11-02 Purdue vs Gonzaga, neutral floor. ESPN's scoreboard has Gonzaga (2250)
// at home and DraftKings at GONZ -5.5; its odds feed files Purdue (2509) under
// "home" at +5.5. Read by the word "home", the board showed GONZ +5.5.
describe("CBB lines are oriented by team, not by the feed's 'home'", () => {
  it("reads Gonzaga -5.5 when the scoreboard's home is Gonzaga", () => {
    const l = readCbbLine(GONZAGA as CbbOdds, "now", "2250")!;
    expect(l.spread).toBe(-5.5);
    expect(l.open.spread).toBe(-4.5);
    expect(l.mlHome).toBeLessThan(0);
    expect(l.mlAway).toBeGreaterThan(0);
    expect(l.total).toBe(153.5);
    expect(l.fixed).toBe("team");
  });
  it("leaves it alone when the feed's home is the scoreboard's home", () => {
    const l = readCbbLine(GONZAGA as CbbOdds, "now", "2509")!;
    expect(l.spread).toBe(5.5);
    expect(l.fixed).toBeUndefined();
  });
  it("without team ids, the moneyline still catches a spread on the wrong side", () => {
    const d: CbbOdds = { items: [{ provider: { name: "DraftKings" }, homeTeamOdds: { current: { pointSpread: { american: "+6.5" }, moneyLine: { american: "-250" } } }, awayTeamOdds: { current: { pointSpread: { american: "-6.5" }, moneyLine: { american: "+205" } } } }] };
    const l = readCbbLine(d)!;
    expect(l.spread).toBe(-6.5);
    expect(l.fixed).toBe("moneyline");
  });
  it("flags only a real disagreement, never a pick'em", () => {
    expect(spreadAgainstMoneyline(-5.5, -245, 200)).toBe(false);
    expect(spreadAgainstMoneyline(5.5, -245, 200)).toBe(true);
    expect(spreadAgainstMoneyline(0.5, -115, -105)).toBe(false);
    expect(spreadAgainstMoneyline(3, undefined, 120)).toBe(false);
  });
});

import { orientTracked, type TrackedCbbGame } from "./track";

// Saved while ESPN listed Purdue (2509) at home: Purdue +5.5, Gonzaga the favorite.
// Later the scoreboard lists Gonzaga (2250) at home; the saved game must read GONZ -5.5.
describe("a saved game is lined up with the scoreboard's home team", () => {
  const snap = { at: "2026-11-02T22:00:00Z", spread: 5.5, homePrice: -110, awayPrice: -110, total: 153.5, mlHome: 200, mlAway: -245, open: { spread: 4.5, total: 151.5 }, ours: { spread: 3, total: 151, homeWin: 0.41 }, parts: { ours: { margin: -2, total: 150 }, trank: { margin: -5, total: 152 } } };
  const t: TrackedCbbGame = { event: "401921704", home: "2509", away: "2250", homeName: "Purdue", awayName: "Gonzaga", tip: "2026-11-03T00:30:00Z", neutral: true, first: snap, last: snap, close: { spread: 6, total: 154 }, final: { home: 70, away: 78 } };
  it("turns everything around when the scoreboard's home is the other team", () => {
    const o = orientTracked(t, "2250");
    expect([o.home, o.away, o.homeName]).toEqual(["2250", "2509", "Gonzaga"]);
    expect(o.first.spread).toBe(-5.5);
    expect(o.first.open.spread).toBe(-4.5);
    expect([o.first.mlHome, o.first.mlAway]).toEqual([-245, 200]);
    expect(o.first.ours.spread).toBe(-3);
    expect(o.first.ours.homeWin).toBeCloseTo(0.59);
    expect(o.first.parts.trank!.margin).toBe(5);
    expect(o.close).toEqual({ spread: -6, total: 154 });
    expect(o.final).toEqual({ home: 78, away: 70 });
  });
  it("leaves a matching or unrelated game alone", () => {
    expect(orientTracked(t, "2509")).toBe(t);
    expect(orientTracked(t, "999")).toBe(t);
  });
});
