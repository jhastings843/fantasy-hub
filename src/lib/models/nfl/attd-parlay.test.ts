import { describe, expect, it } from "vitest";
import { american, buildParlay, gradeParlay, pickLegs, type ParlayGame } from "./attd-parlay";
import type { AttdRow } from "./anytime";

const row = (key: string, anytime: number, dk?: number): AttdRow => ({ id: key, name: key.toUpperCase(), team: "KC", key, m: 0.5, anytime, two: 0.1, dk });
const game = (slug: string, rows: AttdRow[]): ParlayGame => ({ slug, game: slug, kickoff: "2026-11-01T18:00Z", rows });
const NOW = new Date("2026-11-01T14:00:00Z");

describe("ATTD parlay of the day", () => {
  it("needs Venom, our lean and a 5-point blended edge; one leg per game, best first", () => {
    const games = [
      game("g1", [row("a", 0.55, 100), row("b", 0.6, 100)]), // a: blend .56 gap .06; b: blend .58 gap .08 -> b
      game("g2", [row("c", 0.52, 120)]), // be .455, blend .515 gap .06
      game("g3", [row("d", 0.4, 100)]), // ours below break-even: out even though Venom loves him
      game("g4", [row("e", 0.6, 100)]), // not a Venom pick
      game("g5", [row("f", 0.47, 140)]), // be .417, blend .465 gap .048: under 5 pts
      game("g6", [row("g", 0.5, 140)]), // blend .5 gap .083
    ];
    const venom = new Map([["a", 0.57], ["b", 0.56], ["c", 0.51], ["d", 0.9], ["f", 0.46], ["g", 0.5]]);
    const legs = pickLegs(games, venom);
    expect(legs.map((l) => l.key)).toEqual(["g", "b", "c"]);
    expect(legs[1].chance).toBe(0.58);
  });

  it("caps at 5 legs and needs 3", () => {
    const games = Array.from({ length: 7 }, (_, i) => game(`g${i}`, [row(`p${i}`, 0.6 + i / 100, 100)]));
    const venom = new Map(games.map((g) => [g.rows[0].key, 0.6]));
    expect(pickLegs(games, venom)).toHaveLength(5);
    expect(buildParlay(2026, 8, pickLegs(games.slice(0, 2), venom), NOW)).toBeNull();
  });

  it("prices the ticket as DK does across games", () => {
    const legs = pickLegs([game("g1", [row("a", 0.58, 100)]), game("g2", [row("b", 0.52, 120)]), game("g3", [row("c", 0.48, 140)])], new Map([["a", 0.58], ["b", 0.52], ["c", 0.48]]));
    const p = buildParlay(2026, 8, legs, NOW)!;
    expect(p.price).toBe(956); // 2 x 2.2 x 2.4 = 10.56 decimal
    expect(p.chance).toBeCloseTo(0.145, 3);
    expect(p.ev).toBeCloseTo(0.529, 2);
    expect(american(1.5)).toBe(-200);
  });

  it("grades: a miss settles early, voids drop out, a win waits for every leg", () => {
    const legs = pickLegs([game("g1", [row("a", 0.6, 100)]), game("g2", [row("b", 0.6, 100)]), game("g3", [row("c", 0.6, 100)])], new Map([["a", 0.6], ["b", 0.6], ["c", 0.6]]));
    const p = buildParlay(2026, 8, legs, NOW)!;
    expect(gradeParlay(p, { g1: { a: 1 } })).toEqual({ status: "open" });
    expect(gradeParlay(p, { g1: { a: 0 } })).toEqual({ status: "lost", net: -1 });
    expect(gradeParlay(p, { g1: { a: 2 }, g2: { b: null }, g3: { c: 1 } })).toEqual({ status: "won", net: 3 });
    expect(gradeParlay(p, { g1: { a: null }, g2: { b: null }, g3: { c: null } })).toEqual({ status: "void", net: 0 });
  });
});
