import { describe, expect, it } from "vitest";
import { lockedTeams, type LockGame } from "./locks";

function game(over: Partial<LockGame> & { home: string; away: string }): LockGame {
  return { kickoff: "2026-09-13T17:00:00Z", completed: false, ...over };
}

// The real Week 1 shape on the morning this bug was reported: Thursday night
// played, everything else still to come.
const WEEK_1: LockGame[] = [
  game({ home: "SEA", away: "SF", kickoff: "2026-09-11T00:15:00Z", completed: true }),
  game({ home: "LAR", away: "NE", kickoff: "2026-09-11T00:15:00Z", completed: true }),
  game({ home: "TEN", away: "NYJ", kickoff: "2026-09-13T17:00:00Z" }),
  game({ home: "PHI", away: "WSH", kickoff: "2026-09-13T20:25:00Z" }),
];

const FRIDAY = new Date("2026-09-11T12:50:00Z");

describe("lockedTeams", () => {
  it("locks both teams in a game that has been played", () => {
    const locked = lockedTeams(WEEK_1, FRIDAY);
    expect(locked.has("SF")).toBe(true);
    expect(locked.has("SEA")).toBe(true);
  });

  it("leaves Sunday alone on a Friday", () => {
    const locked = lockedTeams(WEEK_1, FRIDAY);
    expect(locked.has("NYJ")).toBe(false);
    expect(locked.has("TEN")).toBe(false);
  });

  it("locks on kickoff passing, without waiting for the game to finish", () => {
    const kickedOff = new Date("2026-09-13T17:30:00Z");
    const locked = lockedTeams(WEEK_1, kickedOff);
    expect(locked.has("NYJ")).toBe(true);
    expect(locked.has("TEN")).toBe(true);
    expect(locked.has("PHI")).toBe(false);
  });

  it("locks a completed game whatever the clock says", () => {
    const locked = lockedTeams(
      [game({ home: "KC", away: "DEN", kickoff: "2099-01-01T00:00:00Z", completed: true })],
      FRIDAY,
    );
    expect(locked.has("KC")).toBe(true);
  });

  it("normalises team codes so a Sleeper roster can be compared against it", () => {
    const locked = lockedTeams(WEEK_1, new Date("2026-09-13T21:00:00Z"));
    expect(locked.has("WAS")).toBe(true);
    expect(locked.has("WSH")).toBe(false);
  });

  it("ignores a game with an unparseable kickoff rather than locking it", () => {
    const locked = lockedTeams([game({ home: "KC", away: "DEN", kickoff: "not a date" })], FRIDAY);
    expect(locked.size).toBe(0);
  });

  it("locks nothing before the week starts", () => {
    // The same slate as ESPN reports it on the Wednesday: nothing kicked off,
    // nothing complete.
    const ahead = WEEK_1.map((g) => ({ ...g, completed: false }));
    expect(lockedTeams(ahead, new Date("2026-09-09T12:00:00Z")).size).toBe(0);
  });
});
