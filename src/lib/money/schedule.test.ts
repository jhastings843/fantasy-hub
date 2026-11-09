import { describe, expect, it } from "vitest";
import { clock, nextRun } from "./schedule";
import { activeDesks, feedRows } from "@/components/hh/activity-client";

describe("feedRows", () => {
  const now = new Date("2026-11-09T19:12:00Z");
  const i = "intraday" as const;
  it("drops finished runs' steps, folds repeats, keeps the live run's steps", () => {
    const rows = feedRows(
      [
        { at: "2026-11-09T19:10:30Z", desk: i, text: "Checking 541 stocks" },
        { at: "2026-11-09T19:10:00Z", desk: i, text: "Checking open trades" },
        { at: "2026-11-09T19:05:40Z", desk: i, text: "Scanned 541 stocks, no new breakouts", done: true },
        { at: "2026-11-09T19:05:10Z", desk: i, text: "Checking 541 stocks" },
        { at: "2026-11-09T19:00:40Z", desk: i, text: "Scanned 541 stocks, no new breakouts", done: true },
        { at: "2026-11-09T18:55:40Z", desk: i, text: "Scanned 541 stocks, no new breakouts", done: true },
        { at: "2026-11-09T18:50:40Z", desk: i, text: "Scanned 541 stocks; bought NVDA", done: true },
      ],
      now,
    );
    expect(rows.map((r) => [r.text, r.times])).toEqual([
      ["Checking 541 stocks", 1],
      ["Checking open trades", 1],
      ["Scanned 541 stocks, no new breakouts", 3],
      ["Scanned 541 stocks; bought NVDA", 1],
    ]);
    expect(rows[2].since).toBe("2026-11-09T18:55:40Z");
  });
});

// Mon Nov 9 2026, 1:52pm New York (EST, UTC-5).
const MON = new Date("2026-11-09T18:52:00Z");

describe("nextRun", () => {
  it("Day Trader: the next 5-minute slot", () => {
    expect(nextRun("intraday", MON)?.toISOString()).toBe("2026-11-09T18:55:00.000Z");
  });
  it("Day Trader after the close: tomorrow's 9:00 premarket", () => {
    expect(nextRun("intraday", new Date("2026-11-09T21:10:00Z"))?.toISOString()).toBe("2026-11-10T14:00:00.000Z");
  });
  it("Day Trader on Friday evening skips the weekend", () => {
    expect(nextRun("intraday", new Date("2026-11-13T23:00:00Z"))?.toISOString()).toBe("2026-11-16T14:00:00.000Z");
  });
  it("Trends on a Monday: Tuesday 6:30am, since it does not run Sun or Mon", () => {
    expect(nextRun("trends", MON)?.toISOString()).toBe("2026-11-10T11:30:00.000Z");
  });
  it("Stock books after Saturday's run: Tuesday", () => {
    expect(nextRun("books", new Date("2026-11-07T11:31:00Z"))?.toISOString()).toBe("2026-11-10T11:30:00.000Z");
  });
  it("Options: 3:55pm after the morning slot", () => {
    expect(nextRun("options", MON)?.toISOString()).toBe("2026-11-09T20:55:00.000Z");
  });
  it("Weather: the next :20", () => {
    expect(nextRun("weather", MON)?.toISOString()).toBe("2026-11-09T19:20:00.000Z");
  });
  it("Phil: an hour after the last check, rolled forward past now", () => {
    expect(nextRun("phil", MON, "2026-11-09T16:30:00Z")?.toISOString()).toBe("2026-11-09T19:30:00.000Z");
    expect(nextRun("phil", MON, null)).toBeNull();
  });
  it("DST: summer slots land an hour earlier in UTC", () => {
    expect(nextRun("trends", new Date("2026-07-06T12:00:00Z"))?.toISOString()).toBe("2026-07-07T10:30:00.000Z");
  });
});

describe("clock", () => {
  it("same day is the time only, other days carry the weekday", () => {
    expect(clock("2026-11-09T18:55:00Z", MON)).toBe("1:55pm");
    expect(clock("2026-11-10T11:30:00Z", MON)).toBe("Tue 6:30am");
    expect(clock("2026-11-07T11:30:00Z", MON)).toBe("Sat 6:30am");
  });
});

describe("activeDesks", () => {
  it("a desk is working while its newest line is recent and not done", () => {
    const lines = [
      { at: "2026-11-09T18:51:00Z", desk: "intraday" as const, text: "Checking NVDA" },
      { at: "2026-11-09T18:50:00Z", desk: "intraday" as const, text: "Checking 42 stocks" },
      { at: "2026-11-09T18:40:00Z", desk: "phil" as const, text: "Done", done: true },
      { at: "2026-11-09T18:30:00Z", desk: "options" as const, text: "Pricing SPY calls" },
    ];
    const a = activeDesks(lines, MON);
    expect([...a.keys()]).toEqual(["intraday"]);
    expect(a.get("intraday")?.text).toBe("Checking NVDA");
  });
});
