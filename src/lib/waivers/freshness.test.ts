import { describe, expect, it } from "vitest";
import { isFreshForRun, mergeWire, rankWire, usageFrom, usageText, weekStartEt } from "./freshness";

// Tuesday 2026-09-15, 10pm ET.
const TUESDAY = new Date("2026-09-16T02:00:00Z");

describe("weekStartEt", () => {
  it("finds Monday midnight Eastern of the current week", () => {
    const start = weekStartEt(TUESDAY);
    // Monday 2026-09-14 00:00 EDT is 04:00Z.
    expect(start.toISOString()).toBe("2026-09-14T04:00:00.000Z");
  });

  it("treats Sunday as the end of the week, not the start", () => {
    const sunday = new Date("2026-09-20T18:00:00Z"); // Sunday 2pm ET
    expect(weekStartEt(sunday).toISOString()).toBe("2026-09-14T04:00:00.000Z");
  });
});

describe("isFreshForRun", () => {
  it("rejects a list posted before the week began", () => {
    expect(isFreshForRun("2026-09-05T15:23:04.000Z", TUESDAY)).toBe(false);
    expect(isFreshForRun("2026-09-13T23:00:00.000Z", TUESDAY)).toBe(false);
  });

  it("accepts a list posted Monday or Tuesday", () => {
    expect(isFreshForRun("2026-09-14T12:00:00.000Z", TUESDAY)).toBe(true);
    expect(isFreshForRun("2026-09-15T20:00:00.000Z", TUESDAY)).toBe(true);
  });

  it("rejects a missing or unreadable date", () => {
    expect(isFreshForRun(null, TUESDAY)).toBe(false);
    expect(isFreshForRun("last Tuesday", TUESDAY)).toBe(false);
  });
});

describe("rankWire", () => {
  const u = (snaps: number) => ({ week: 1, points: 0, snaps, targets: 0, carries: 0 });

  it("orders by adds and drops players who did not play", () => {
    const ranked = rankWire([
      { playerId: "a", adds: 500, lastWeek: u(2), onBye: false },
      { playerId: "b", adds: 300, lastWeek: u(40), onBye: false },
      { playerId: "c", adds: 900, lastWeek: u(30), onBye: false },
    ]);
    expect(ranked.map((c) => c.playerId)).toEqual(["c", "b"]);
  });

  it("keeps a bye-week player and a player with no stat line", () => {
    const ranked = rankWire([
      { playerId: "bye", adds: 100, lastWeek: u(0), onBye: true },
      { playerId: "new", adds: 50, lastWeek: null, onBye: false },
    ]);
    expect(ranked.map((c) => c.playerId)).toEqual(["bye", "new"]);
  });
});

describe("usage", () => {
  it("reads snaps, targets and carries off a stat row", () => {
    const usage = usageFrom({ off_snp: 53, rec_tgt: 1 }, 0.4, 1);
    expect(usage).toEqual({ week: 1, points: 0.4, snaps: 53, targets: 1, carries: 0 });
    expect(usageText(usage!)).toBe("Wk 1: 0.4 pts, 53 snaps, 1 tgt");
  });

  it("is null when the player has no row", () => {
    expect(usageFrom(undefined, undefined, 1)).toBeNull();
  });
});

describe("mergeWire", () => {
  it("leads with the research and fills in behind without repeats", () => {
    const merged = mergeWire(
      [{ playerId: "a" }, { playerId: "b" }],
      [{ playerId: "b" }, { playerId: "c" }, { playerId: "a" }, { playerId: "d" }],
    );
    expect(merged.map((p) => p.playerId)).toEqual(["a", "b", "c", "d"]);
  });
});
