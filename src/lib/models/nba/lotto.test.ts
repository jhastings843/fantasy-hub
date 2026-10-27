import { describe, expect, it } from "vitest";
import { RECIPES, recipeRecords, rungsOf, summarize, ticket, tickets, type LottoBoard } from "./lotto";
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

  it("takes each game's best-value rung, top 3 games, priced as the product", () => {
    const t = ticket("2026-10-27", rungsOf(boards))!;
    expect(t.legs.map((l) => l.player)).toEqual(["Tyson", "Hardaway", "Jakucionis"]);
    expect(t.price).toBe(22676); // 5.2 x 6 x 7.3 = 227.76x, Sam's Oct 26 ticket
    expect(t.chance).toBeCloseTo(0.25 * 0.2 * 0.16, 6);
    expect(t.outcome).toBeNull();
  });

  it("needs 3 games with value", () => {
    expect(ticket("2026-10-27", rungsOf(boards.slice(0, 2).concat(boards[3])))).toBeNull();
  });

  it("grades: a void leg drops out and the rest pay", () => {
    const g = [
      board("1", tip, "Tyson", [{ line: 14.5, over: 420, ours: 0.25 }], 18),
      board("2", tip, "Hardaway", [{ line: 14.5, over: 500, ours: 0.2 }], null),
      board("3", tip, "Jakucionis", [{ line: 14.5, over: 630, ours: 0.16 }], 15),
    ];
    const t = tickets(rungsOf(g))[0];
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
    const t = tickets(rungsOf(g))[0];
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

  it("is a fixed list of 12, the original first", () => {
    expect(RECIPES).toHaveLength(12);
    expect(recipeRecords(rungs)[0].recipe.id).toBe("l3-value");
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
