import { describe, expect, it } from "vitest";
import { american, bestTicket, ticket, buildParlay, buildNightParlay, gradeParlay, pickLegs, pickNightLegs, tickets, type ParlayGame, type ParlayLeg } from "./attd-parlay";
import type { AttdRow } from "./anytime";

const row = (key: string, anytime: number, dk?: number): AttdRow => ({ id: key, name: key.toUpperCase(), team: "KC", key, m: 0.5, anytime, two: 0.1, dk });
const game = (slug: string, rows: AttdRow[]): ParlayGame => ({ slug, game: slug, kickoff: "2026-11-01T18:00Z", rows });
const NOW = new Date("2026-11-01T14:00:00Z");

describe("ATTD parlay of the day", () => {
  it("needs Venom above break-even and a 5-point edge on OUR number; one leg per game, best first", () => {
    const games = [
      game("g1", [row("a", 0.55, 100), row("b", 0.6, 100)]), // a: gap .05; b: gap .10 -> b
      game("g2", [row("c", 0.52, 120)]), // be .455, gap .065
      game("g3", [row("d", 0.4, 100)]), // ours below break-even: out even though Venom loves him
      game("g4", [row("e", 0.6, 100)]), // not a Venom pick
      game("g5", [row("f", 0.46, 140)]), // be .417, gap .043: under 5 pts
      game("g6", [row("g", 0.5, 140)]), // gap .083
      game("g7", [row("h", 0.6, 100)]), // Venom .45 under break-even: out
    ];
    const venom = new Map([["a", 0.57], ["b", 0.56], ["c", 0.51], ["d", 0.9], ["f", 0.46], ["g", 0.5], ["h", 0.45]]);
    const legs = pickLegs(games, venom);
    expect(legs.map((l) => l.key)).toEqual(["b", "g", "c"]);
    expect(legs[0].chance).toBe(0.6);
  });

  it("a backup Venom loves at a long price no longer qualifies on Venom's number (Holani, Week 10)", () => {
    // ours .095 at +1200 (be .077): 1.8 pts over on ours, under the 5-pt bar. The old blend (.243) made it a 16.6-pt gap.
    const legs = pickLegs([game("g1", [row("holani", 0.095, 1200)])], new Map([["holani", 0.39]]));
    expect(legs).toEqual([]);
  });

  it("pools up to 6 legs and needs 2", () => {
    const games = Array.from({ length: 8 }, (_, i) => game(`g${i}`, [row(`p${i}`, 0.6 + i / 100, 100)]));
    const venom = new Map(games.map((g) => [g.rows[0].key, 0.6]));
    expect(pickLegs(games, venom)).toHaveLength(6);
    expect(buildParlay(2026, 8, pickLegs(games.slice(0, 1), venom), NOW)).toBeNull();
    expect(tickets(pickLegs(games, venom)).map((t) => t.legs.length)).toEqual([2, 3, 4, 5, 6]);
  });

  it("tracks the leg count with the best Kelly growth, not the most or fewest legs", () => {
    const leg = (key: string, chance: number, price: number): ParlayLeg => ({ slug: key, game: key, key, name: key, team: "KC", price, ours: chance, venom: chance, chance, gap: chance - 100 / (price + 100) });
    // Two strong short legs, then long shots with thin edges: growth peaks at 2.
    const pool = [leg("a", 0.6, 100), leg("b", 0.58, 100), leg("c", 0.12, 900), leg("d", 0.1, 1000)];
    const all = tickets(pool);
    expect(bestTicket(pool)!.legs.length).toBe(2);
    expect(all[2].ev).toBeGreaterThan(all[0].ev); // more legs pays more on paper, but growth says no
    const p = buildParlay(2026, 8, pool, NOW)!;
    expect(p.legs.map((l) => l.key)).toEqual(["a", "b"]);
    expect(p.pool).toHaveLength(4);
  });

  it("prices the ticket as DK does across games", () => {
    const legs = pickLegs([game("g1", [row("a", 0.58, 100)]), game("g2", [row("b", 0.52, 120)]), game("g3", [row("c", 0.48, 140)])], new Map([["a", 0.58], ["b", 0.52], ["c", 0.48]]));
    const p = ticket(legs);
    expect(p.price).toBe(956); // 2 x 2.2 x 2.4 = 10.56 decimal
    expect(p.chance).toBeCloseTo(0.145, 3);
    expect(p.ev).toBeCloseTo(0.529, 2);
    expect(american(1.5)).toBe(-200);
  });

  it("grades: a miss settles early, voids drop out, a win waits for every leg", () => {
    const legs = pickLegs([game("g1", [row("a", 0.6, 100)]), game("g2", [row("b", 0.6, 100)]), game("g3", [row("c", 0.6, 100)])], new Map([["a", 0.6], ["b", 0.6], ["c", 0.6]]));
    const p = { ...buildParlay(2026, 8, legs, NOW)!, legs }; // grade all three legs
    expect(gradeParlay(p, { g1: { a: 1 } })).toEqual({ status: "open" });
    expect(gradeParlay(p, { g1: { a: 0 } })).toEqual({ status: "lost", net: -1 });
    expect(gradeParlay(p, { g1: { a: 2 }, g2: { b: null }, g3: { c: 1 } })).toEqual({ status: "won", net: 3 });
    expect(gradeParlay(p, { g1: { a: null }, g2: { b: null }, g3: { c: null } })).toEqual({ status: "void", net: 0 });
  });

  it("night ticket: 2 legs, same game allowed, ours and Venom above break-even, no 5-point bar", () => {
    const g = game("chi_sea", [row("a", 0.55, 100), { ...row("b", 0.5, 120), team: "CHI" }, row("c", 0.4, 100), row("d", 0.6, 100), row("e", 0.46, 120)]);
    // a gap .05; b gap .045; c ours under .5; d not Venom; e ours .46 > .455 but Venom .44 under
    const venom = new Map([["a", 0.51], ["b", 0.46], ["c", 0.7], ["e", 0.44]]);
    const pool = pickNightLegs([g], venom);
    expect(pool.map((l) => l.key)).toEqual(["a", "b"]);
    const p = buildNightParlay(2026, 9, "mnf", pool, NOW)!;
    expect(p.slate).toBe("mnf");
    expect(p.legs).toHaveLength(2);
    expect(p.price).toBe(340); // 2 x 2.2 = 4.4 decimal
    expect(buildNightParlay(2026, 9, "mnf", pool.slice(0, 1), NOW)).toBeNull();
    expect(gradeParlay({ ...p, voided: "test" }, { chi_sea: { a: 1, b: 1 } })).toEqual({ status: "void", net: 0 });
  });

  it("night ticket: one leg per team", () => {
    const sea = (k: string, a: number, dk: number): AttdRow => ({ ...row(k, a, dk), team: "SEA" });
    const g = game("chi_sea", [sea("w", 0.5, 350), sea("h", 0.3, 600), row("s", 0.55, 100)]);
    const pool = pickNightLegs([g], new Map([["w", 0.46], ["h", 0.34], ["s", 0.52]]));
    expect(pool.map((l) => l.key)).toEqual(["w", "s"]);
  });
});
