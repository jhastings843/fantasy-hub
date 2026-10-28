import { describe, expect, it } from "vitest";
import { byeAlerts, irMoves, restOfSeasonShare, sundayPoints, weeksOut } from "./injury-timeline";

// Real cases from the week 8 card (2026-10-27). Breece Hall: Sleeper tagged
// him Out, ESPN had him Questionable with a return date of Sunday Nov 1. The
// bid card printed "Listed Out" and the chop simulation zeroed him in every
// lineup, while the card's own price treated him as three quarters of a player.
const TUESDAY_WEEK_8 = "2026-10-27T15:00:00Z";

describe("weeksOut", () => {
  it("reads a return date of this Sunday as no weeks missed", () => {
    expect(weeksOut({ status: "Questionable", returnDate: "2026-11-01" }, "Out", TUESDAY_WEEK_8)).toBe(0);
  });

  it("counts the Sundays before the return date", () => {
    // Out through Nov 22, back Nov 29: misses Nov 1, 8, 15 and 22.
    expect(weeksOut({ status: "Injured Reserve", returnDate: "2026-11-29" }, "IR", TUESDAY_WEEK_8)).toBe(4);
  });

  it("assumes the four-game minimum for IR with no date", () => {
    expect(weeksOut(null, "IR", TUESDAY_WEEK_8)).toBe(4);
  });

  it("assumes one week for Out with no date, none for healthy", () => {
    expect(weeksOut(null, "Out", TUESDAY_WEEK_8)).toBe(1);
    expect(weeksOut(null, null, TUESDAY_WEEK_8)).toBe(0);
    expect(weeksOut({ status: "Active", returnDate: null }, "Out", TUESDAY_WEEK_8)).toBe(0);
  });

  it("does not let a stale past return date keep an Out player out", () => {
    expect(weeksOut({ status: "Out", returnDate: "2026-10-18" }, "Out", TUESDAY_WEEK_8)).toBe(1);
  });
});

describe("restOfSeasonShare", () => {
  it("is the share of weeks left he is available for", () => {
    // Week 8 of 17 leaves 10 weeks; out 4 of them.
    expect(restOfSeasonShare(4, 8)).toBeCloseTo(0.6);
    expect(restOfSeasonShare(0, 8)).toBe(1);
    expect(restOfSeasonShare(12, 8)).toBe(0);
  });
});

describe("sundayPoints", () => {
  it("prices a questionable player at his chance of playing, not zero", () => {
    expect(sundayPoints({ weekPoints: 12, plays: 0.75, injuryStatus: "Out" })).toBeCloseTo(9);
  });

  it("zeroes a player nobody looked at when his tag says out", () => {
    expect(sundayPoints({ weekPoints: 12, injuryStatus: "Out" })).toBe(0);
    expect(sundayPoints({ weekPoints: 12, injuryStatus: null })).toBe(12);
  });
});

describe("irMoves", () => {
  const p = (playerId: string, name: string, injuryStatus: string | null, plays = 1, weeks = 0) => ({ playerId, name, injuryStatus, plays, weeksOut: weeks });

  it("says when a player in the IR slot is cleared and needs a roster spot", () => {
    const notes = irMoves([p("1", "Jacory Croskey-Merritt", null, 1)], ["1"], { slots: 1, allowOut: true });
    expect(notes[0]).toContain("Croskey-Merritt");
    expect(notes[0]).toContain("IR slot");
  });

  it("suggests moving an IR-eligible player when the slot is open", () => {
    const notes = irMoves([p("2", "Breece Hall", "IR", 0, 4)], [], { slots: 1, allowOut: true });
    expect(notes[0]).toContain("Move Breece Hall to IR");
  });

  it("only counts Out as eligible when the league allows it", () => {
    expect(irMoves([p("2", "X", "Out", 0, 2)], [], { slots: 1, allowOut: false })).toEqual([]);
    expect(irMoves([p("2", "X", "Out", 0, 2)], [], { slots: 1, allowOut: true })).toHaveLength(1);
  });

  it("says nothing when the slot is full of a player still hurt", () => {
    expect(irMoves([p("1", "A", "IR", 0, 4), p("2", "B", "IR", 0, 4)], ["1"], { slots: 1, allowOut: true })).toEqual([]);
  });
});

describe("byeAlerts", () => {
  // Jack's week 8 roster: SF and NYG off now, and week 11 takes five at once.
  const r = (playerId: string, name: string, position: string, byeWeek: number | null) => ({ playerId, name, position, byeWeek });
  const roster = [
    r("maye", "Drake Maye", "QB", 11),
    r("corum", "Blake Corum", "RB", 11),
    r("fannin", "Harold Fannin Jr.", "TE", 11),
    r("boston", "Denzel Boston", "WR", 11),
    r("jacobs", "Josh Jacobs", "RB", 11),
    r("tate", "Carnell Tate", "WR", 9),
    r("pollard", "Tony Pollard", "RB", 9),
    r("kittle", "George Kittle", "TE", 8),
    r("likely", "Isaiah Likely", "TE", 8),
    r("kelce", "Travis Kelce", "TE", 5),
  ];
  const starters = new Set(["maye", "jacobs", "fannin", "boston", "tate", "pollard", "kittle"]);

  it("groups by week, includes this week, and skips byes already past", () => {
    const alerts = byeAlerts(roster, 8, starters);
    expect(alerts).toHaveLength(3);
    expect(alerts[0]).toMatch(/^This week/);
    expect(alerts[0]).toContain("George Kittle");
    expect(alerts.join(" ")).not.toContain("Kelce");
  });

  it("flags the crunch week: the only QB and several season starters off at once", () => {
    const week11 = byeAlerts(roster, 8, starters).find((a) => a.startsWith("Week 11"))!;
    expect(week11).toContain("5 players off");
    expect(week11).toMatch(/no QB/i);
    expect(week11).toContain("4 of your season starters");
  });
});
