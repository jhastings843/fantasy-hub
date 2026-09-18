import { describe, expect, it } from "vitest";
import type { PlayerValueLike } from "@/lib/dynasty/power-rankings";
import { blendWithJingles, type SeasonList } from "./jingles-values";

function market(entries: [string, string, number][]): Record<string, PlayerValueLike> {
  const sorted = [...entries].sort((a, b) => b[2] - a[2]);
  const out: Record<string, PlayerValueLike> = {};
  const perPos: Record<string, number> = {};
  sorted.forEach(([id, position, value], i) => {
    perPos[position] = (perPos[position] ?? 0) + 1;
    out[id] = { value, position, overallRank: i + 1, positionRank: perPos[position] };
  });
  return out;
}

function list(ranked: [string, string][]): SeasonList {
  const perPos: Record<string, number> = {};
  const entries = ranked.map(([sleeperId, position], i) => {
    perPos[position] = (perPos[position] ?? 0) + 1;
    return { sleeperId, position, rank: i + 1, positionRank: perPos[position] };
  });
  return { entries, byId: Object.fromEntries(entries.map((e) => [e.sleeperId, e])) };
}

// Market: a 1000, b 800, c 600, d 400, e 200.
const MARKET = market([["a", "RB", 1000], ["b", "WR", 800], ["c", "RB", 600], ["d", "WR", 400], ["e", "TE", 200]]);

describe("blendWithJingles", () => {
  it("leaves a player alone when he and the market agree", () => {
    const { values } = blendWithJingles(MARKET, list([["a", "RB"], ["b", "WR"], ["c", "RB"], ["d", "WR"], ["e", "TE"]]));
    expect(values.a.value).toBe(1000);
    expect(values.a.marketValue).toBe(1000);
    expect(values.a.jinglesRank).toBe(1);
  });

  it("moves a player halfway to the value the market pays at his position rank", () => {
    // He has d as his WR1. The market pays 800 for its WR1; d sits at 400.
    const { values } = blendWithJingles(MARKET, list([["a", "RB"], ["d", "WR"], ["b", "WR"], ["c", "RB"], ["e", "TE"]]));
    expect(values.d.value).toBe(600);
    expect(values.d.marketValue).toBe(400);
    expect(values.d.marketPositionRank).toBe(2);
    expect(values.d.jinglesRank).toBe(2);
    expect(values.d.jinglesPositionRank).toBe(1);
  });

  it("treats a market top player he left off as ranked just below his list at that position", () => {
    // He ranked one WR (d) and never mentioned b, the market's WR1.
    // b reads as his WR2: the market pays 400 there, so b lands at 600.
    const { values, moved } = blendWithJingles(MARKET, list([["a", "RB"], ["c", "RB"], ["d", "WR"]]));
    expect(values.b.value).toBe(600);
    expect(values.b.jinglesRank).toBeNull();
    expect(values.b.marketValue).toBe(800);
    expect(moved).toBeGreaterThan(0);
  });

  it("leaves a player alone when he ranked nobody at the position", () => {
    const { values } = blendWithJingles(MARKET, list([["a", "RB"], ["b", "WR"], ["c", "RB"]]));
    expect(values.e.value).toBe(200);
    expect(values.e.marketValue).toBeUndefined();
  });

  it("leaves a player alone when the market has them below the last one he ranked at the position", () => {
    const { values } = blendWithJingles(MARKET, list([["a", "RB"], ["b", "WR"], ["c", "RB"]]));
    expect(values.d.value).toBe(400);
    expect(values.d.marketValue).toBeUndefined();
  });

  it("compares within position, so a QB ranked late on a one-QB board is not a fade", () => {
    // Market prices the QB as the top asset; his board has the QB 40th overall
    // but QB1. That is agreement, not a fade.
    const mkt = market([["qb", "QB", 6000], ["rb1", "RB", 5000], ["rb2", "RB", 4000], ["wr1", "WR", 3000]]);
    const ranked: [string, string][] = [["rb1", "RB"], ["rb2", "RB"], ["wr1", "WR"], ["qb", "QB"]];
    const { values } = blendWithJingles(mkt, list(ranked));
    expect(values.qb.value).toBe(6000);
    expect(values.qb.jinglesRank).toBe(4);
    expect(values.qb.jinglesPositionRank).toBe(1);
  });

  it("re-ranks players by blended value so the row labels match the numbers", () => {
    const { values } = blendWithJingles(MARKET, list([["a", "RB"], ["d", "WR"], ["b", "WR"], ["c", "RB"], ["e", "TE"]]));
    // d (his WR1) rises to 600 and b (his WR2) falls to 600, tying c at 600.
    // Ties keep market order: b 800, c 600, d 400 before the blend.
    expect(values.b.overallRank).toBe(2);
    expect(values.c.overallRank).toBe(3);
    expect(values.d.overallRank).toBe(4);
    expect(values.d.positionRank).toBe(2);
    expect(values.b.positionRank).toBe(1);
  });

  it("counts how many players moved", () => {
    const same = blendWithJingles(MARKET, list([["a", "RB"], ["b", "WR"], ["c", "RB"], ["d", "WR"], ["e", "TE"]]));
    expect(same.moved).toBe(0);
    const swapped = blendWithJingles(MARKET, list([["c", "RB"], ["a", "RB"], ["b", "WR"], ["d", "WR"], ["e", "TE"]]));
    expect(swapped.moved).toBe(2);
    expect(swapped.values.c.value).toBe(800);
    expect(swapped.values.a.value).toBe(800);
  });
});
