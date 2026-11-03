import { describe, expect, it } from "vitest";
import { SKILL_OUT_GUARD, UsageBook, bigOut, bookFromRows, injuryHeld, injuryRead, normTeam, outIds, rosterReport, teamOut } from "./injuries";

describe("normTeam", () => {
  it("folds the old codes into the current ones", () => {
    expect(normTeam("STL")).toBe("LA");
    expect(normTeam("SD")).toBe("LAC");
    expect(normTeam("OAK")).toBe("LV");
    expect(normTeam("KC")).toBe("KC");
  });
});

describe("UsageBook", () => {
  it("shares over the window, games he missed counting zero", () => {
    const b = new UsageBook(2);
    b.add("KC", [{ id: "a", opp: 10 }, { id: "b", opp: 30 }]);
    b.add("KC", [{ id: "b", opp: 40 }, { id: "c", opp: 10 }]);
    expect(b.share("KC", "a")).toBeCloseTo(10 / 90);
    expect(b.share("KC", "b")).toBeCloseTo(70 / 90);
    // A third game pushes the first out of a 2-game window.
    b.add("KC", [{ id: "c", opp: 50 }]);
    expect(b.share("KC", "a")).toBe(0);
    expect(b.share("KC", "c")).toBeCloseTo(60 / 100);
    expect(b.share("BUF", "a")).toBe(0);
  });
});

describe("teamOut", () => {
  const book = new UsageBook();
  book.add("KC", [{ id: "kelce", opp: 60 }, { id: "pacheco", opp: 100 }, { id: "rice", opp: 240 }]);
  const share = (id: string) => book.share("KC", id);
  it("the header's worked example", () => {
    const report = [
      { id: "kelce", pos: "TE", status: "Doubtful" },
      { id: "pacheco", pos: "RB", status: "Out" },
      { id: "mahomes", pos: "QB", status: "Questionable" },
    ];
    expect(teamOut(report, { lastQb: "mahomes", prevOut: new Set(["pacheco"]), share })).toEqual({ qbOut: 0, skillOut: 0.15 });
  });
  it("last game's starter out sets qbOut; Questionable and non-skill players don't count", () => {
    const report = [
      { id: "mahomes", pos: "QB", status: "Out" },
      { id: "rice", pos: "WR", status: "Questionable" },
      { id: "jones", pos: "DT", status: "Out" },
    ];
    expect(teamOut(report, { lastQb: "mahomes", prevOut: new Set(), share })).toEqual({ qbOut: 1, skillOut: 0 });
    expect(teamOut(report, { lastQb: "backup", prevOut: new Set(), share }).qbOut).toBe(0);
  });
  it("outIds keeps Out, Doubtful, IR and Suspension", () => {
    const ids = outIds([
      { id: "a", pos: "WR", status: "Out" },
      { id: "b", pos: "WR", status: "Doubtful" },
      { id: "c", pos: "WR", status: "Questionable" },
      { id: "d", pos: "WR", status: "" },
      { id: "e", pos: "WR", status: "Injured Reserve" },
    ]);
    expect([...ids].sort()).toEqual(["a", "b", "e"]);
  });
});

describe("the guard", () => {
  it("flags a missing QB or a big enough usage share on either side", () => {
    const none = { qbOut: 0, skillOut: 0 };
    expect(bigOut({ qbOut: 1, skillOut: 0 }, SKILL_OUT_GUARD)).toBe(true);
    expect(bigOut({ qbOut: 0, skillOut: 0.15 }, SKILL_OUT_GUARD)).toBe(true);
    expect(bigOut({ qbOut: 0, skillOut: 0.14 }, SKILL_OUT_GUARD)).toBe(false);
    expect(bigOut(undefined, SKILL_OUT_GUARD)).toBe(false);
    expect(injuryRead(none, { qbOut: 0, skillOut: 0.2 }).flagged).toBe(true);
    expect(injuryRead(none, none).flagged).toBe(false);
  });
  it("injuryHeld reads the flag off our line", () => {
    expect(injuryHeld({ injury: { flagged: true } })).toBe(true);
    expect(injuryHeld({ injury: { flagged: false } })).toBe(false);
    expect(injuryHeld({})).toBe(false);
    expect(injuryHeld(undefined)).toBe(false);
  });
});

describe("live helpers", () => {
  it("bookFromRows: one team-game per season, week and team, in order, old codes folded", () => {
    const rows = [
      { id: "a", season: 2026, week: 2, team: "LA", tgt: 5, car: 5 },
      { id: "a", season: 2025, week: 18, team: "LA", tgt: 0, car: 0 },
      { id: "b", season: 2025, week: 18, team: "LA", tgt: 10, car: 0 },
      { id: "b", season: 2026, week: 1, team: "LA", tgt: 10, car: 0 },
    ];
    // Window 2: 2026 weeks 1 and 2 only.
    expect(bookFromRows(rows, 2).share("LA", "a")).toBeCloseTo(10 / 20);
    expect(bookFromRows(rows, 3).share("LA", "b")).toBeCloseTo(20 / 30);
    expect(bookFromRows([{ id: "x", season: 2015, week: 1, team: "STL", tgt: 1, car: 0 }]).share("LA", "x")).toBe(1);
  });
  it("rosterReport keeps matched athletes with a status", () => {
    const players = new Map([["traviskelce", { id: "00-1", pos: "TE" }]]);
    expect(rosterReport([{ key: "traviskelce", status: "Out" }, { key: "nobody", status: "Out" }, { key: "traviskelce" }], players)).toEqual([{ id: "00-1", pos: "TE", status: "Out" }]);
  });
});

import { teamOut as teamOutNamed } from "./injuries";
describe("teamOut names for the display flag", () => {
  it("names the starting QB and skill players with 5%+ of usage, not depth guys", () => {
    const t = teamOutNamed(
      [{ id: "qb", pos: "QB", status: "Out" }, { id: "wr", pos: "WR", status: "Doubtful" }, { id: "te3", pos: "TE", status: "Out" }],
      { lastQb: "qb", prevOut: new Set(), share: (id) => (id === "wr" ? 0.2 : 0.02), nameOf: (id) => ({ qb: "Jalen Hurts", wr: "A.J. Brown", te3: "Depth Guy" })[id] },
    );
    expect(t.names).toEqual(["Jalen Hurts (QB)", "A.J. Brown (WR)"]);
    expect(t.qbOut).toBe(1);
  });
});
