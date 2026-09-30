import { describe, expect, it } from "vitest";
import { lineupTotal, projectRoomClaims, withClaims, type RoomCandidate, type RoomTeam } from "./room-claims";

const POSITIONS = ["QB", "RB", "WR", "FLEX", "BN"];
const p = (id: string, position: string, points: number): RoomCandidate => ({ playerId: id, name: id, position, points });

const team = (rosterId: number, faabLeft: number, players: RoomCandidate[]): RoomTeam => ({
  rosterId,
  name: `T${rosterId}`,
  faabLeft,
  players,
});

describe("projectRoomClaims", () => {
  it("sends the best wire player to the team he helps most", () => {
    const needsWr = team(1, 500, [p("q1", "QB", 20), p("r1", "RB", 15), p("r2", "RB", 12), p("w1", "WR", 4)]);
    const set = team(2, 500, [p("q2", "QB", 20), p("r3", "RB", 15), p("w2", "WR", 16), p("w3", "WR", 13)]);
    const claims = projectRoomClaims([needsWr, set], [p("star", "WR", 18)], POSITIONS);
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ rosterId: 1, playerId: "star", gain: 14 });
  });

  it("gives each team one claim and skips gains under two points", () => {
    const t = team(1, 500, [p("q", "QB", 20), p("r", "RB", 15), p("w", "WR", 4)]);
    const claims = projectRoomClaims([t], [p("a", "WR", 18), p("b", "WR", 17), p("c", "QB", 21)], POSITIONS);
    expect(claims.map((c) => c.playerId)).toEqual(["a"]);
  });

  it("leaves broke teams out", () => {
    const t = team(1, 0, [p("q", "QB", 20), p("w", "WR", 4)]);
    expect(projectRoomClaims([t], [p("a", "WR", 18)], POSITIONS)).toEqual([]);
  });

  it("withClaims adds the player so the lineup improves", () => {
    const t = team(1, 100, [p("q", "QB", 20), p("r", "RB", 15), p("w", "WR", 4)]);
    const cands = [p("a", "WR", 18)];
    const after = withClaims([t], projectRoomClaims([t], cands, POSITIONS), cands);
    expect(lineupTotal(after[0].players, POSITIONS)).toBeGreaterThan(lineupTotal(t.players, POSITIONS));
  });
});
