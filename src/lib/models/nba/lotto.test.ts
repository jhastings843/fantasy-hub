import { describe, expect, it } from "vitest";
import { CAP, CAP_FROM, DEFAULT_RECIPE, LOTTO_CHECK, RECIPES, checkedChance, recipeRecords, rungsOf, summarize, ticket, tickets, type LottoBoard } from "./lotto";
import { implied } from "@/lib/props/parse";
import { LONG_MAX, LONG_MIN, longRungs } from "./market";
import PARAMS from "./params.json";
import type { NbaParams } from "./props";

const P = PARAMS as unknown as NbaParams;

// One player per game; `ours` and the price set each rung's value.
function board(id: string, tip: string, player: string, longs: { line: number; over: number; ours: number }[], actual?: number | null): LottoBoard {
  const mid = `pts|${player}`;
  return {
    espnId: id,
    kickoff: tip,
    away: `A${id}`,
    home: `H${id}`,
    game: { markets: [{ id: mid, player, stat: "pts", statLabel: "Points" }] },
    extra: { [mid]: { over: 0.5, under: 0.5, min: 30, games: 5, longs: longs.map((l) => ({ ...l, raw: l.ours })) } },
    ...(actual !== undefined ? { result: { markets: [{ id: mid, actual, play: null, lean: null }], void: 0 } } : {}),
  };
}

describe("longRungs", () => {
  it("keeps only the +250 to +2000 band, with our chance falling as the line rises", () => {
    const ladder = [9.5, 14.5, 19.5, 24.5, 29.5, 39.5].map((line, i) => ({ line, over: [-300, 120, 300, 600, 1500, 5000][i] }));
    const r = longRungs("pts", 15, ladder, 1.05, P);
    expect(r.map((x) => x.line)).toEqual([19.5, 24.5, 29.5]);
    expect(r.every((x) => x.over >= LONG_MIN && x.over <= LONG_MAX)).toBe(true);
    expect(r[0].ours).toBeGreaterThan(r[1].ours);
    expect(r[1].ours).toBeGreaterThan(r[2].ours);
  });
});

describe("lotto ticket", () => {
  const tip = "2026-10-27T23:10:00Z"; // 7:10pm ET Oct 27
  const boards = [
    board("1", tip, "Tyson", [{ line: 14.5, over: 420, ours: 0.25 }]), // value 0.30
    board("2", tip, "Hardaway", [{ line: 14.5, over: 500, ours: 0.2 }, { line: 19.5, over: 900, ours: 0.12 }]), // 0.20, 0.20
    board("3", tip, "Jakucionis", [{ line: 14.5, over: 630, ours: 0.16 }]), // 0.168
    board("4", tip, "Nobody", [{ line: 19.5, over: 400, ours: 0.1 }]), // no value
  ];

  // The old default (3 legs, best value); the default is market-checked from 2026-11-13.
  const V = RECIPES.find((r) => r.id === "l3-value")!;
  it("takes each game's best-value rung, top 3 games, priced as the product", () => {
    const t = ticket("2026-10-27", rungsOf(boards), V)!;
    expect(t.legs.map((l) => l.player)).toEqual(["Tyson", "Hardaway", "Jakucionis"]);
    expect(t.price).toBe(22676); // 5.2 x 6 x 7.3 = 227.76x, Sam's Oct 26 ticket
    expect(t.chance).toBeCloseTo(0.25 * 0.2 * 0.16, 6);
    expect(t.outcome).toBeNull();
  });

  it("needs 3 games with value", () => {
    expect(ticket("2026-10-27", rungsOf(boards.slice(0, 2).concat(boards[3])), V)).toBeNull();
  });

  it("grades: a void leg drops out and the rest pay", () => {
    const g = [
      board("1", tip, "Tyson", [{ line: 14.5, over: 420, ours: 0.25 }], 18),
      board("2", tip, "Hardaway", [{ line: 14.5, over: 500, ours: 0.2 }], null),
      board("3", tip, "Jakucionis", [{ line: 14.5, over: 630, ours: 0.16 }], 15),
    ];
    const t = tickets(rungsOf(g), V)[0];
    expect(t.outcome).toBe("W");
    expect(t.price).toBe(3696); // 5.2 x 7.3 = 37.96x
    const sum = summarize(rungsOf(g), [t]);
    expect(sum.rungs.n).toBe(2);
    expect(sum.rungs.hits).toBe(2);
    expect(sum.tickets.net).toBeCloseTo(3.696, 3);
  });

  it("a miss loses the stake", () => {
    const g = [
      board("1", tip, "Tyson", [{ line: 14.5, over: 420, ours: 0.25 }], 14),
      board("2", tip, "Hardaway", [{ line: 14.5, over: 500, ours: 0.2 }], 20),
      board("3", tip, "Jakucionis", [{ line: 14.5, over: 630, ours: 0.16 }], 15),
    ];
    const t = tickets(rungsOf(g), V)[0];
    expect(t.outcome).toBe("L");
    expect(summarize(rungsOf(g), [t]).tickets.net).toBeCloseTo(-0.1, 6);
  });
});

describe("ticket recipes", () => {
  const tip = "2026-10-27T23:10:00Z";
  const boards = [
    board("1", tip, "Tyson", [{ line: 14.5, over: 420, ours: 0.25 }], 20), // value 0.30, hits
    board("2", tip, "Hardaway", [{ line: 14.5, over: 500, ours: 0.2 }, { line: 19.5, over: 900, ours: 0.12 }], 16), // 14.5 hits, 19.5 misses
    board("3", tip, "Jakucionis", [{ line: 14.5, over: 630, ours: 0.16 }], 10), // misses
  ];
  const rungs = rungsOf(boards);
  const by = (id: string) => RECIPES.find((r) => r.id === id)!;

  it("is a fixed list of 12, the two Sam-style tickets and the market-checked default", () => {
    expect(RECIPES).toHaveLength(15);
    expect(DEFAULT_RECIPE.id).toBe("l3-checked");
    expect(recipeRecords(rungs)[0].recipe.id).toBe("l3-checked");
  });

  it("the market-checked ticket takes only checked value at +700 or shorter", () => {
    const all = rungsOf(boards);
    const t = ticket("2026-10-27", all, DEFAULT_RECIPE);
    for (const l of t?.legs ?? []) expect(l.over <= 700 && l.checkedEv > 0).toBe(true);
    // With every rung past +700 nothing qualifies.
    const long = rungsOf([board("1", tip, "A", [{ line: 30.5, over: 900, ours: 0.3 }]), board("2", tip, "B", [{ line: 30.5, over: 900, ours: 0.3 }]), board("3", tip, "C", [{ line: 30.5, over: 900, ours: 0.3 }])]);
    expect(ticket("2026-10-27", long, DEFAULT_RECIPE)).toBeNull();
  });
  it("picks each game's leg by the recipe", () => {
    expect(ticket("2026-10-27", rungs, by("l2-chance"))!.legs.map((l) => `${l.player} ${l.line}`)).toEqual(["Tyson 14.5", "Hardaway 14.5"]);
    expect(ticket("2026-10-27", rungs, by("l2-long"))!.legs.map((l) => `${l.player} ${l.line}`)).toEqual(["Hardaway 19.5", "Jakucionis 14.5"]);
    expect(ticket("2026-10-27", rungs, by("l4-value"))).toBeNull(); // only 3 games
  });
  it("grades each recipe on its own", () => {
    const rec = Object.fromEntries(recipeRecords(rungs).map((x) => [x.recipe.id, x]));
    expect(rec["l2-chance"]).toMatchObject({ n: 1, won: 1 });
    expect(rec["l2-long"]).toMatchObject({ n: 1, won: 0, net: -0.1 });
    expect(rec["l5-value"].n).toBe(0);
  });
});

describe("Sam-style recipes", () => {
  const tip = "2026-10-27T23:10:00Z";
  const boards = [
    board("1", tip, "Tyson", [{ line: 9.5, over: 260, ours: 0.35 }, { line: 14.5, over: 420, ours: 0.25 }], 20),
    board("2", tip, "Hardaway", [{ line: 14.5, over: 500, ours: 0.2 }, { line: 19.5, over: 900, ours: 0.12 }], 16),
    board("3", tip, "Jakucionis", [{ line: 14.5, over: 630, ours: 0.16 }], 10),
  ];
  const rungs = rungsOf(boards);
  const by = (id: string) => RECIPES.find((r) => r.id === id)!;

  it("takes points legs priced +300 to +700 only", () => {
    const t = ticket("2026-10-27", rungs, by("sam-pts"))!;
    expect(t.legs.map((l) => `${l.player} ${l.line}`).sort()).toEqual(["Hardaway 14.5", "Jakucionis 14.5", "Tyson 14.5"]);
    expect(t.legs.every((l) => l.over >= 300 && l.over <= 700)).toBe(true);
  });
  it("waters down to the same players' shortest rungs", () => {
    const w = ticket("2026-10-27", rungs, by("sam-pts-water"))!;
    expect(w.legs.map((l) => `${l.player} ${l.line}`).sort()).toEqual(["Hardaway 14.5", "Jakucionis 14.5", "Tyson 9.5"]);
    expect(w.price).toBeLessThan(ticket("2026-10-27", rungs, by("sam-pts"))!.price);
  });
});

describe("market check (2026-11-04)", () => {
  it("lands between DK's de-vigged chance and our raw chance, nearer DK", () => {
    const fair = implied(400) / LOTTO_CHECK.hold;
    const c = checkedChance(0.25, 400);
    expect(c).toBeGreaterThan(fair);
    expect(c).toBeLessThan(0.25);
    expect(c - fair).toBeLessThan(0.25 - c);
  });
  it("flags one rung per player-stat-night: the best checked value", () => {
    const tip = "2026-10-27T23:10:00Z";
    const rungs = rungsOf([board("1", tip, "Tyson", [{ line: 19.5, over: 500, ours: 0.4 }, { line: 24.5, over: 900, ours: 0.3 }], 21)]);
    expect(rungs.every((r) => r.checkedEv > 0)).toBe(true);
    expect(rungs.filter((r) => r.bestOfLadder).map((r) => r.line)).toEqual([24.5]);
  });
  it("flags nothing when no rung has checked value", () => {
    const rungs = rungsOf([board("1", "2026-10-27T23:10:00Z", "Tyson", [{ line: 19.5, over: 500, ours: 0.12 }], 10)]);
    expect(rungs.filter((r) => r.bestOfLadder)).toHaveLength(0);
  });
});

describe("+700 cap (2026-11-05)", () => {
  const legs = (tip: string) => [
    board("1", tip, "Tyson", [{ line: 14.5, over: 420, ours: 0.25 }, { line: 24.5, over: 1500, ours: 0.1 }], 20),
    board("2", tip, "Hardaway", [{ line: 14.5, over: 500, ours: 0.2 }, { line: 24.5, over: 1200, ours: 0.12 }], 16),
    board("3", tip, "Jakucionis", [{ line: 14.5, over: 630, ours: 0.16 }, { line: 24.5, over: 900, ours: 0.15 }], 10),
  ];
  const long = RECIPES.find((r) => r.id === "l3-long")!;

  it("caps ticket legs at +700 from CAP_FROM on", () => {
    const t = ticket(CAP_FROM, rungsOf(legs(`${CAP_FROM}T23:10:00Z`)), long)!;
    expect(t.legs.every((l) => l.over <= CAP)).toBe(true);
  });
  it("leaves tickets before CAP_FROM as they were", () => {
    const t = ticket("2026-11-04", rungsOf(legs("2026-11-04T23:10:00Z")), long)!;
    expect(t.legs.some((l) => l.over > CAP)).toBe(true);
  });
  it("flags the best rung at +700 or shorter, one per ladder", () => {
    const rungs = rungsOf(legs("2026-11-04T23:10:00Z"));
    const ours = rungs.filter((r) => r.bestOursCapped);
    expect(ours.map((r) => r.player).sort()).toEqual(["Hardaway", "Jakucionis", "Tyson"]);
    expect(ours.every((r) => r.over <= CAP)).toBe(true);
    expect(rungs.filter((r) => r.bestCheckedCapped).every((r) => r.over <= CAP)).toBe(true);
  });
});
