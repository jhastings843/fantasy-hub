import { describe, expect, it } from "vitest";
import { type SplitGame, matchSplits, nameScore, parseScoreboard, readMarket } from "./splits";

const at = "2026-10-21T16:00:00.000Z";
const outcome = (side: string, value: number, t: number | null, m: number | null) => ({ side, value, odds: -110, bet_info: t === null ? null : { tickets: { percent: t }, money: { percent: m } } });
const game = (over: Partial<Record<string, unknown>> = {}) => ({
  start_time: "2026-10-23T00:15:00.000Z",
  status: "scheduled",
  home_team_id: 1,
  away_team_id: 2,
  num_bets: 15000,
  teams: [
    { id: 1, location: "Chicago", display_name: "Bears", full_name: "Chicago Bears", abbr: "CHI" },
    { id: 2, location: "New England", display_name: "Patriots", full_name: "New England Patriots", abbr: "NE" },
  ],
  markets: {
    "30": { event: { spread: [outcome("home", -1.5, null, null), outcome("away", 1.5, null, null)] } },
    "68": { event: { spread: [outcome("home", -3, 25, 31), outcome("away", 3, 75, 69)], total: [outcome("over", 50.5, 26, 40), outcome("under", 50.5, 74, 60)] } },
  },
  ...over,
});

const feedGame = (home: string[], away: string[], start: string, dk?: number): SplitGame => ({ start, homeNames: home, awayNames: away, homeTickets: 50, homeMoney: 50, dk, at });

describe("parseScoreboard", () => {
  it("reads home-side splits, the open and DraftKings' line", () => {
    const [g] = parseScoreboard({ games: [game()] }, at);
    expect(g).toMatchObject({ homeTickets: 25, homeMoney: 31, overTickets: 26, overMoney: 40, open: -1.5, dk: -3, bets: 15000 });
    expect(g.homeNames).toContain("chi");
    expect(g.awayNames).toContain("new england");
  });
  it("skips a game whose splits are 0/0 (no bets counted yet)", () => {
    const empty = { "68": { event: { spread: [outcome("home", -3, 0, 0), outcome("away", 3, 0, 0)] } } };
    expect(parseScoreboard({ games: [game({ markets: empty })] }, at)).toEqual([]);
  });
  it("skips games already under way and tolerates junk", () => {
    expect(parseScoreboard({ games: [game({ status: "inprogress" })] }, at)).toEqual([]);
    expect(parseScoreboard(null, at)).toEqual([]);
  });
});

describe("matching", () => {
  it("scores an exact name above a word match", () => {
    expect(nameScore("kansas state", ["kansas state", "k-state"])).toBe(1);
    expect(nameScore("kansas state", ["kansas", "jayhawks"])).toBeLessThan(1);
  });
  it("does not let a shared 'state' match two schools", () => {
    expect(nameScore("georgia state", ["washington state", "cougars"])).toBe(0);
  });
  it("picks Kansas State over Kansas at the same kickoff", () => {
    const t = "2026-10-24T16:00:00.000Z";
    const ku = feedGame(["kansas", "jayhawks"], ["iowa", "hawkeyes"], t);
    const ksu = feedGame(["kansas state", "wildcats"], ["iowa", "hawkeyes"], t);
    expect(matchSplits({ home: "kansas state", away: "iowa", kickoff: "2026-10-24T16:00Z" }, [ku, ksu])).toBe(ksu);
  });
  it("needs the kickoff within an hour", () => {
    const g = feedGame(["chicago", "chi"], ["new england", "ne"], "2026-10-23T00:15:00.000Z");
    expect(matchSplits({ home: "CHI", away: "NE", kickoff: "2026-10-23T00:15Z" }, [g])).toBe(g);
    expect(matchSplits({ home: "CHI", away: "NE", kickoff: "2026-10-26T00:15Z" }, [g])).toBeUndefined();
  });
  it("reads the UMass alias", () => {
    const g = feedGame(["uconn"], ["umass", "minutemen"], "2026-10-23T23:00:00.000Z");
    expect(matchSplits({ home: "uconn", away: "massachusetts", kickoff: "2026-10-23T23:00Z" }, [g])).toBe(g);
  });
});

describe("readMarket", () => {
  const s = { homeTickets: 25, homeMoney: 31, open: -1.5, at };
  it("flags the public side and reverse line movement", () => {
    // 75% of tickets on NE, yet CHI went -1.5 -> -3: the line moved toward the minority.
    expect(readMarket("nfl", s, -3)).toEqual({ publicSide: "away", move: -1.5, movedToward: "home", rlm: "home" });
  });
  it("a move with the public is not RLM", () => {
    expect(readMarket("nfl", s, 0).rlm).toBeUndefined();
    expect(readMarket("nfl", s, 0).movedToward).toBe("away");
  });
  it("needs a bigger move in college", () => {
    expect(readMarket("cfb", { ...s, open: -3 }, -3.5).movedToward).toBeUndefined();
    expect(readMarket("nfl", { ...s, open: -3 }, -3.5).movedToward).toBe("home");
  });
  it("flags sharp money when money share beats ticket share by 10+", () => {
    expect(readMarket("nba", { homeTickets: 40, homeMoney: 55, at }, undefined).sharpSide).toBe("home");
    expect(readMarket("nba", { homeTickets: 60, homeMoney: 45, at }, undefined).sharpSide).toBe("away");
  });
});
