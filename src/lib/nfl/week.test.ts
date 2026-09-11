import { describe, expect, it } from "vitest";
import { fixtureMap, lockedTeams, teamsWithStats, type LockGame } from "./week";

function game(over: Partial<LockGame> & { home: string; away: string }): LockGame {
  return { kickoff: "2026-09-13T17:00:00Z", completed: false, ...over };
}

// The real Week 1 shape on the morning this bug was reported: Thursday night
// played, everything else still to come.
const WEEK_1: LockGame[] = [
  game({ home: "SEA", away: "NE", kickoff: "2026-09-10T00:20:00Z", completed: true }),
  game({ home: "LAR", away: "SF", kickoff: "2026-09-11T00:35:00Z", completed: true }),
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

describe("fixtureMap", () => {
  it("gives both sides of a game, one home and one away", () => {
    const f = fixtureMap(WEEK_1);
    expect(f.get("SF")).toEqual({ opponent: "LAR", home: false });
    expect(f.get("LAR")).toEqual({ opponent: "SF", home: true });
  });

  it("normalises both teams, so a Sleeper roster can look itself up", () => {
    const f = fixtureMap(WEEK_1);
    expect(f.get("WAS")).toEqual({ opponent: "PHI", home: false });
    expect(f.get("WSH")).toBeUndefined();
    expect(f.get("PHI")).toEqual({ opponent: "WAS", home: true });
  });

  it("has nothing to say about a team on bye", () => {
    expect(fixtureMap(WEEK_1).get("KC")).toBeUndefined();
  });

  it("covers every team in the slate", () => {
    expect(fixtureMap(WEEK_1).size).toBe(WEEK_1.length * 2);
  });
});

// The Friday this shipped, Sleeper's week 1 stat feed carried 79 rows for SF,
// 73 for SEA, 72 for NE, 71 for LAR, and exactly one for Las Vegas: Bryce
// Cabeldue, an offensive tackle, with gp 1 and gms_active 1, for a game that
// kicked off two days later. Reading one row as "this team has played" locked
// every Raider, and two of them were on Jack's dynasty bench.
describe("teamsWithStats", () => {
  const played = (team: string, rows: number) => Array<string>(rows).fill(team);

  it("takes a team the feed is emphatic about", () => {
    expect(teamsWithStats(played("SF", 79)).has("SF")).toBe(true);
  });

  it("does not take a whole team's word from one stray row", () => {
    expect(teamsWithStats(played("LV", 1)).has("LV")).toBe(false);
  });

  it("separates the real slate from the stray row in the same feed", () => {
    const feed = [
      ...played("SF", 79), ...played("SEA", 73),
      ...played("NE", 72), ...played("LAR", 71),
      ...played("LV", 1),
    ];
    expect([...teamsWithStats(feed)].sort()).toEqual(["LAR", "NE", "SEA", "SF"]);
  });

  it("normalises codes, so the set can be compared against a Sleeper roster", () => {
    expect(teamsWithStats(played("JAC", 40)).has("JAX")).toBe(true);
  });

  it("ignores rows whose player has no team", () => {
    expect(teamsWithStats([null, null, null, null, null, null]).size).toBe(0);
  });
});
