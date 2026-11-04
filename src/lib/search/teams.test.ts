import { describe, expect, it } from "vitest";
import type { PicksReport } from "@/lib/picks/report";
import type { CbbBoard } from "@/lib/models/cbb/store";
import type { NbaBoard } from "@/lib/picks/nba-store";
import { buildTeamIndex, nbaAbbr, nflAbbr, searchTeams } from "./teams";

const cfb = {
  league: "cfb",
  names: { "South Carolina": "South Carolina", Texas: "Texas" },
  board: [{ away: "Texas", home: "South Carolina", tier: "pass", play: "", basis: "reference", ref: { line: 3, homeId: "2579", awayId: "251", source: "t", fetchedAt: "" } }],
} as unknown as PicksReport;

const team = (id: string, name: string, abbr: string) => ({ id, name, short: name, abbr });
const cbb = {
  days: [{ day: "20261103", rows: [{ g: { id: "401", home: team("2579", "South Carolina", "SC"), away: team("2", "Auburn", "AUB") } }] }],
} as unknown as CbbBoard;

const nba = {
  yesterday: null,
  days: [{ day: "20261103", games: [{ id: "9", home: { abbr: "GSW", name: "Golden State Warriors", short: "Warriors" }, away: { abbr: "DEN", name: "Denver Nuggets", short: "Nuggets" } }] }],
} as unknown as NbaBoard;

const nfl = { league: "nfl", names: {}, board: [{ away: "LA", home: "WSH", tier: "pass", play: "", basis: "reference" }] } as unknown as PicksReport;

describe("team index", () => {
  const teams = buildTeamIndex({ nfl, cfb, nba, cbb });

  it("merges a school's football and hoops on its ESPN id", () => {
    const sc = teams.filter((t) => t.key === "ncaa:2579");
    expect(sc).toHaveLength(1);
    expect(sc[0].sports).toEqual(["CFB", "CBB"]);
    expect(sc[0].games.sort()).toEqual(["CFB picks:Texas@South Carolina", "cbb:401"]);
    expect(searchTeams(teams, "south carolina").map((t) => t.key)).toEqual(["ncaa:2579"]);
  });

  it("normalises pro abbreviations onto one entry", () => {
    expect(nflAbbr("la")).toBe("LAR");
    expect(nflAbbr("WSH")).toBe("WAS");
    expect(nbaAbbr("GSW")).toBe("GS");
    expect(teams.filter((t) => t.key.startsWith("nba:")).length).toBe(30);
    expect(teams.filter((t) => t.key.startsWith("nfl:")).length).toBe(32);
    expect(teams.find((t) => t.key === "nba:GS")?.games).toEqual(["nba:9"]);
    expect(teams.find((t) => t.key === "nfl:LAR")?.games).toEqual(["NFL picks:LA@WSH"]);
  });

  it("finds pro teams by nickname and city", () => {
    expect(searchTeams(teams, "eagles").map((t) => t.key)).toEqual(["nfl:PHI"]);
    expect(searchTeams(teams, "nuggets").map((t) => t.key)).toEqual(["nba:DEN"]);
    expect(searchTeams(teams, "denver").map((t) => t.key).sort()).toEqual(["nba:DEN", "nfl:DEN"]);
  });
});

describe("exact team name", () => {
  it("shows only the exact match when one exists", () => {
    const t = (key: string, name: string) => ({ key, name, sports: ["CBB" as const], logo: { league: "cfb" as const }, terms: name.toLowerCase(), games: [] });
    const hits = searchTeams([t("ncaa:2579", "South Carolina"), t("ncaa:2569", "South Carolina State"), t("ncaa:2908", "South Carolina Upstate")], "south carolina");
    expect(hits.map((h) => h.key)).toEqual(["ncaa:2579"]);
    expect(searchTeams([t("ncaa:2569", "South Carolina State"), t("ncaa:2908", "South Carolina Upstate")], "south carolina")).toHaveLength(2);
  });
});
