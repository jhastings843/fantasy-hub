import { describe, expect, it } from "vitest";
import { allowedTables } from "./allowed";
import type { NbaGame } from "./box";

const line = (team: string, pos: string, min: number, pts: number) => ({ id: `${team}${pos}`, name: "", team, pos, starter: true, min, pts, reb: 1, ast: 1, threes: 0, fga: 0, fgm: 0, fta: 0 });

describe("allowedTables", () => {
  it("credits each team with what the other side's players did, by position", () => {
    const g = { id: "1", date: "", home: "BOS", away: "NYK", spread: null, total: null, score: {}, poss: {}, jump: null, shots: [], players: [line("BOS", "G", 30, 20), line("NYK", "G", 32, 25), line("NYK", "C", 30, 10)] } as NbaGame;
    const { teams, league } = allowedTables([g, { ...g, id: "2" }]);
    expect(teams.BOS.games).toBe(2);
    expect(teams.BOS.byPos.G).toMatchObject({ n: 64, pts: 50 });
    expect(teams.BOS.byPos.C).toMatchObject({ n: 60, pts: 20 });
    expect(teams.NYK.byPos.G).toMatchObject({ n: 60, pts: 40 });
    expect(league.games).toBe(2);
    expect(league.byPos.G.pts).toBe(90);
  });
});
