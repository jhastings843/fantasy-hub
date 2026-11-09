import { describe, expect, it } from "vitest";
import { clock, nextRun } from "./schedule";
import { activeDesks } from "@/components/hh/activity-client";

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
