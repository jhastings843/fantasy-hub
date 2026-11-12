import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { davidPreOf, mergeDavid, parseDavidCbb, type DavidCbbRow } from "./david";
import { matchRows, type BoardTeams } from "./harris";
import { CBB_SLICES, cbbCandidates, davidRead } from "./learn";
import type { TrackedCbbGame } from "./track";

// Fixtures: davidsasser.com/cbb as served 2026-11-12 (24 games, his first day
// up) and ESPN's Division I board for that day trimmed to ids, tips and names.
const ROOT = path.join(__dirname, "../../../..");
const HTML = readFileSync(path.join(ROOT, "test/fixtures/picks/ds-cbb-board.html"), "utf8");
const BOARD = JSON.parse(readFileSync(path.join(ROOT, "test/fixtures/models/cbb/david/board-2026-11-12.json"), "utf8")) as BoardTeams[];

describe("parseDavidCbb (Nov 12 page)", () => {
  const p = parseDavidCbb(HTML);

  it("reads every card, his date and his updated stamp", () => {
    expect(p.rows).toHaveLength(24);
    expect(p.unread).toBe(0);
    expect(p.date).toBe("2026-11-12");
    expect(p.updated).toBe("2026-11-12T15:50:18.136Z");
  });

  it("Kansas City vs. George Mason (neutral): lines are George Mason's, he takes Kansas City +15.5", () => {
    expect(p.rows[0]).toMatchObject({ away: "Kansas City", home: "George Mason", neutral: true, model: -15, spread: -15.5, total: 142.1, postedTotal: 141.5, pick: "away", edge: 0.5, davidTip: "2026-11-12T20:00:00.000Z" });
  });

  it("a line printed for the road team turns into the home team's: Bradley vs. Coppin State", () => {
    // "Model spread Bradley −14.8", "Consensus spread Coppin State +11.5".
    expect(p.rows[1]).toMatchObject({ away: "Bradley", home: "Coppin State", model: 14.8, spread: 11.5, pick: "away" });
  });

  it("West Florida at Alabama A&M: model favors the road team while the market has the home team", () => {
    const r = p.rows.find((x) => x.home === "Alabama A&M")!;
    expect(r).toMatchObject({ model: 1.2, spread: -7, pick: "away", edge: 8.2 });
  });

  it("on every card his pick is the side his model and the consensus line favor, and Edge is their gap", () => {
    for (const r of p.rows) {
      const side = r.model! < r.spread! ? "home" : "away";
      expect(r.pick).toBe(side);
      expect(Math.abs(Math.abs(r.model! - r.spread!) - r.edge!)).toBeLessThan(0.11);
    }
  });

  it("throws when cards are there but none read (layout change), and is empty without cards", () => {
    expect(() => parseDavidCbb("<article><p>nothing</p></article>")).toThrow(/layout changed/);
    expect(parseDavidCbb("<main>Coming soon</main>").rows).toEqual([]);
  });
});

describe("matching to the ESPN board", () => {
  const m = matchRows(parseDavidCbb(HTML).rows, BOARD);

  it("all 24 match by name, no problems", () => {
    expect(m.problems).toEqual([]);
    expect(m.rows.filter((r) => r.event)).toHaveLength(24);
  });

  it("George Mason is his home team and ESPN's", () => {
    const r = m.rows[0];
    expect(r).toMatchObject({ event: "401920073", homeId: "2244", awayId: "140" });
  });
});

describe("pregame copies", () => {
  const rows = matchRows(parseDavidCbb(HTML).rows, BOARD).rows as DavidCbbRow[];
  const gm = rows[0];

  it("a read before tip sets pre; a read after keeps it; a dropped game keeps its pre", () => {
    const a = mergeDavid(undefined, rows, "2026-11-12T16:00:00.000Z");
    expect(a[0].pre).toMatchObject({ model: -15, total: 142.1, at: "2026-11-12T16:00:00.000Z" });
    const later = mergeDavid(a, [{ ...gm, model: -20 }], "2026-11-12T21:00:00.000Z");
    expect(later[0].pre?.model).toBe(-15);
    expect(later).toHaveLength(24);
    const pre = davidPreOf(later);
    expect(pre["401920073"]).toMatchObject({ homeId: "2244", model: -15, total: 142.1, spread: -15.5 });
  });
});

const game = (over: Partial<TrackedCbbGame> = {}): TrackedCbbGame => {
  const snap = { at: "2026-11-12T15:00:00Z", spread: -15.5, homePrice: -110, awayPrice: -110, total: 141.5, overPrice: -110, underPrice: -110, open: { spread: -15.5, total: 141.5 }, ours: { spread: -14, total: 145, homeWin: 0.88 }, parts: { ours: { margin: 14, total: 145 }, trank: null } };
  return { event: "401920073", home: "2244", away: "140", homeName: "George Mason", awayName: "Kansas City", tip: "2026-11-12T20:00Z", neutral: true, first: snap, last: snap, ...over };
};
const DPRE = { homeId: "2244", model: -15, total: 142.1, spread: -15.5, postedTotal: 141.5, at: "2026-11-12T16:00:00.000Z" };

describe("David's read and slices", () => {
  it("his side against our saved line: George Mason -15.5 vs his -15 is Kansas City by 0.5; total 142.1 vs 141.5 is over", () => {
    expect(davidRead(game(), DPRE)).toEqual({ side: "away", edge: 0.5, total: { side: "over", edge: 0.6 } });
  });

  it("turns his line when ESPN has the teams the other way round", () => {
    const g = game({ home: "140", away: "2244", first: { ...game().first, spread: 15.5 } });
    expect(davidRead(g, DPRE)?.side).toBe("home");
  });

  it("no read after tip and none without a pregame copy", () => {
    expect(davidRead(game(), { ...DPRE, at: "2026-11-12T20:30:00.000Z" })).toBeUndefined();
    expect(davidRead(game(), undefined)).toBeUndefined();
  });

  it("grades his spread and total slices at our first saved price; our side when he disagrees", () => {
    // Final GMU 80, KC 66: GMU by 14, KC +15.5 covers; 146 points, over 141.5 hits.
    const g = game({ final: { home: 80, away: 66 } });
    const c = Object.fromEntries(cbbCandidates([g], 2026, {}, { [g.event]: DPRE }).map((x) => [x.id, x.bets]));
    expect(c["cbb:david"]).toHaveLength(1);
    expect(c["cbb:david"][0].net).toBeCloseTo(0.909, 2);
    expect(c["cbb:david3"]).toEqual([]);
    expect(c["cbb:david-total"][0].net).toBeCloseTo(0.909, 2);
    // Ours: home -14 vs -15.5 line = away side too, so David agrees.
    expect(c["cbb:david-agree"]).toHaveLength(1);
    expect(c["cbb:david-split"]).toEqual([]);
    expect(c["cbb:david-total-agree"]).toHaveLength(1);
  });

  it("every David slice id is unique and has a known parent", () => {
    const ids = CBB_SLICES.map((s) => s[0]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const [, , parent] of CBB_SLICES.filter((s) => s[0].startsWith("cbb:david"))) if (parent) expect(ids).toContain(parent);
  });
});
