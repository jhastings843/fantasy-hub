import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseDavidBoard, parseSamBoard, parseSamRecord, parseSheetWeek, weekOf } from "./parse";
import { join, strategies, suRecords, tierBoard } from "./engine";

const fx = (f: string) => readFileSync(path.resolve(__dirname, "../../../test/fixtures/picks", f), "utf8");
const rec = (r: { w: number; l: number; p: number }) => `${r.w}-${r.l}-${r.p}`;

// The numbers below were first worked out by hand from the same pages
// (Weeks 3 and 4, 2026) and match each site's own published record.
describe("NFL backtest, weeks 3 and 4", () => {
  const sam = parseSamRecord("nfl", fx("sam-record.html"), (d) => weekOf("nfl", d));
  const david = [3, 4].flatMap((w) => parseSheetWeek("nfl", w, fx(`ds-week${w}.csv`)));
  const j = join(sam, david);
  const s = strategies("nfl", j.graded);
  const cut = (id: string) => s.cuts.find((x) => x.id === id)!.record;

  it("joins every game", () => {
    expect(j.graded).toHaveLength(32);
    expect(j.onlySam + j.onlyDavid).toBe(0);
    expect(j.scoreMismatches).toHaveLength(1);
  });
  it("matches each site's own record", () => {
    expect(rec(s.baselines[0].record)).toBe("25-6-1");
    expect(rec(s.baselines[1].record)).toBe("21-10-1");
    expect(rec(s.baselines[2].record)).toBe("20-11-1");
  });
  it("reproduces the cuts", () => {
    expect(rec(cut("agree"))).toBe("18-4-1");
    expect(rec(cut("dog"))).toBe("14-2-0");
    expect(rec(cut("fav"))).toBe("4-2-1");
    expect(rec(cut("dog-e2"))).toBe("10-1-0");
    expect(rec(cut("near-vegas"))).toBe("11-3-0");
    expect(rec(cut("dog-6.5"))).toBe("3-1-0");
    expect(rec(cut("road-dog"))).toBe("7-0-0");
    expect(rec(s.splits.sam)).toBe("6-3-0");
  });
  it("picks a rule with a real sample", () => {
    expect(s.rule).not.toBeNull();
    expect(s.rule!.games).toBeGreaterThanOrEqual(10);
  });
  it("straight up: average of the models beats the Vegas favorite", () => {
    const su = suRecords("nfl", j.graded);
    const m = (id: string) => su.methods.find((x) => x.id === id)!;
    expect(`${m("avg").w}-${m("avg").l}`).toBe("21-11");
    expect(`${m("vegas").w}-${m("vegas").l}`).toBe("17-15");
    expect(su.bands.map((b) => `${b.w}-${b.l}`)).toEqual(["6-1", "9-3", "6-7"]);
  });
  it("tiers the week 5 board", () => {
    const sb = parseSamBoard("nfl", fx("sam-board.html"));
    const db = parseDavidBoard("nfl", fx("ds-board.html"));
    const d = new Map(db.rows.map((r) => [`${r.away}@${r.home}`, r]));
    const rows = sb.rows.map((r) => ({ home: r.home, away: r.away, sam: r.line, david: d.get(`${r.away}@${r.home}`)?.line }));
    const board = tierBoard("nfl", rows, s);
    expect(board).toHaveLength(15);
    expect(board.filter((g) => g.tier === "split").map((g) => g.home).sort()).toEqual(["ATL", "GB", "NO"]);
    expect(board.find((g) => g.home === "DAL")!.play).toBe("TB +8.5");
  });
});

describe("college backtest", () => {
  it("joins most games across the two sites' team names", () => {
    const sam = parseSamRecord("cfb", fx("sam-cfb-record.html"), (d) => weekOf("cfb", d));
    const david = [1, 2, 3, 4, 5].flatMap((w) => parseSheetWeek("cfb", w, fx(`ds-cfb-week${w}.csv`)));
    const j = join(sam, david);
    expect(j.graded.length).toBeGreaterThan(80);
  });
});
