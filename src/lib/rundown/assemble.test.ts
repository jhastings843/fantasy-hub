import { describe, expect, it } from "vitest";
import { assembleRundown, etDay, oneSentence, streakOf, yesterdayEt, type MarketSource, type Play } from "./assemble";

const play = (day: string, result: Play["result"], net: number | null, label = "x", price: string | null = null): Play => ({ day, at: `${day}T23:00:00Z`, result, net, label, price });

const nflSpreads: MarketSource = {
  key: "nfl-spreads", label: "NFL spreads", sport: "nfl", issued: true, hasUnits: true,
  plays: [play("2026-10-25", "W", 0.91), play("2026-10-29", "W", 1.82, "BUF -2.5", "-110"), play("2026-10-29", "L", -1), play("2026-10-30", "W", 0.91)],
};
const cfbTotals: MarketSource = { key: "cfb-totals", label: "College totals", sport: "cfb", issued: true, hasUnits: true, plays: [play("2026-10-24", "L", -1)] };
const nflSu: MarketSource = { key: "nfl-straight-up", label: "NFL straight up", sport: "nfl", issued: true, hasUnits: false, plays: [play("2026-10-29", "W", null, "BUF")] };
const fb: MarketSource = {
  key: "nba-first-basket", label: "NBA first basket", sport: "nba", issued: false, hasUnits: true,
  plays: [play("2026-10-25", "L", -1), play("2026-10-26", "W", 3), play("2026-10-27", "W", 2), play("2026-10-28", "W", 4), play("2026-10-29", "W", 4.5, "Wembanyama", "+450"), play("2026-10-29", "P", 0)],
};
const survivor: MarketSource = {
  key: "survivor-main", label: "Survivor (500-entry pool)", sport: "nfl", issued: false, hasUnits: false,
  plays: [play("2026-10-29", "W", null, "SEA beat WAS 24-20")],
  survivor: { pool: "500-entry pool", alive: true, losses: 0, strikes: 1 },
};

const run = (events = [] as Parameters<typeof assembleRundown>[0]["events"]) =>
  assembleRundown({ date: "2026-10-29", now: new Date("2026-10-30T12:00:00Z"), baseUrl: "https://h.example", sources: [nflSpreads, cfbTotals, nflSu, fb, survivor], events });

describe("rundown assembly", () => {
  it("counts only issued, unit-graded plays from that night in totals", () => {
    const r = run();
    // Spreads 1-1 +0.82u. Straight up is issued but has no units; first basket is shadow.
    expect(r.totals).toEqual({ wins: 1, losses: 1, pushes: 0, units: 0.82, seasonUnits: 0.73 });
    expect(r.boardUrl).toBe("https://h.example/today");
    expect(r.recordsUrl).toBe("https://h.example/records");
  });

  it("lists only markets that settled that night, issued first, with season numbers through the date", () => {
    const r = run();
    expect(r.markets.map((m) => m.key)).toEqual(["nfl-spreads", "nfl-straight-up", "nba-first-basket", "survivor-main"]);
    const s = r.markets[0];
    expect(s).toMatchObject({ wins: 1, losses: 1, units: 0.82, seasonWins: 2, seasonLosses: 1, seasonUnits: 1.73, hits: [{ label: "BUF -2.5", price: "-110" }] });
    expect(r.markets.find((m) => m.key === "nfl-straight-up")).toMatchObject({ issued: true, units: null, seasonUnits: null });
    expect(r.markets.find((m) => m.key === "nba-first-basket")).toMatchObject({ issued: false, wins: 1, pushes: 1, units: 4.5, streak: { kind: "W", n: 4 } });
  });

  it("derives movers from data: rollback first, then survivor, season best, streak; at most three", () => {
    const r = run([
      { day: "2026-10-29", kind: "rollback", text: "Rolled back the edge 3+ cut.", market: "cfb-totals" },
      { day: "2026-10-28", kind: "review", text: "Not this night." },
    ]);
    expect(r.movers).toEqual([
      { kind: "rollback", text: "Rolled back the edge 3+ cut." },
      { kind: "survivor", text: "Survivor, 500-entry pool: SEA beat WAS 24-20, still alive." },
      { kind: "record", text: "NBA first basket had its best night of the season at +4.50u (1-0-1)." },
    ]);
    // A mover's market is listed even with nothing settled that night.
    expect(r.markets.find((m) => m.key === "cfb-totals")).toMatchObject({ wins: 0, losses: 0, units: 0, seasonLosses: 1 });
    const all = assembleRundown({ date: "2026-10-29", now: new Date(), baseUrl: "", sources: [fb], events: [] });
    expect(all.movers.map((m) => m.kind)).toEqual(["record", "streak"]);
    expect(all.movers[1].text).toBe("NBA first basket has won 4 straight (tracked only).");
  });

  it("returns an empty night cleanly", () => {
    const r = assembleRundown({ date: "2026-07-01", now: new Date(), baseUrl: "", sources: [nflSpreads], events: [] });
    expect(r.markets).toEqual([]);
    expect(r.totals).toEqual({ wins: 0, losses: 0, pushes: 0, units: 0, seasonUnits: 0 });
  });
});

describe("rundown helpers", () => {
  it("dates by Eastern time and finds yesterday across midnight UTC", () => {
    expect(etDay("2026-10-30T02:30:00Z")).toBe("2026-10-29"); // a 10:30pm ET finish
    expect(yesterdayEt(new Date("2026-10-30T03:00:00Z"))).toBe("2026-10-28"); // still Oct 29 in ET
    expect(yesterdayEt(new Date("2026-11-01T15:00:00Z"))).toBe("2026-10-31");
  });
  it("streaks skip pushes", () => {
    expect(streakOf([play("2026-10-01", "L", -1), play("2026-10-02", "W", 1), play("2026-10-03", "P", 0), play("2026-10-04", "W", 1)])).toEqual({ kind: "W", n: 2 });
    expect(streakOf([])).toBeNull();
  });
  it("cuts a journal line to one sentence", () => {
    expect(oneSentence("Activated edge 2+. It beat the parent by 2.1 SE.")).toBe("Activated edge 2+.");
  });
});
