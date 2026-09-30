import { describe, expect, it } from "vitest";
import { reviewWaivers } from "./waiver-review";
import type { RoomCandidate } from "./room-claims";

const POSITIONS = ["QB", "RB", "WR", "FLEX", "BN"];
const p = (id: string, position: string, points: number): RoomCandidate => ({ playerId: id, name: id, position, points });
const players = Object.fromEntries(
  [p("q1", "QB", 18), p("r1", "RB", 12), p("w1", "WR", 8), p("q2", "QB", 20), p("r2", "RB", 14), p("w2", "WR", 6),
   p("star", "WR", 18), p("dud", "WR", 1)].map((x) => [x.playerId, x]),
);

describe("reviewWaivers", () => {
  const review = reviewWaivers({
    leagueName: "Chop",
    week: 4,
    rosterPositions: POSITIONS,
    players,
    teams: [
      { rosterId: 1, name: "Me", isMine: true, faabLeft: 900, players: [players.q1, players.r1, players.w1] },
      // Rival already holds the star after the run; the dud was his drop.
      { rosterId: 2, name: "Rival", isMine: false, faabLeft: 500, players: [players.q2, players.r2, players.star] },
    ],
    run: [
      { type: "waiver", status: "complete", roster_ids: [2], adds: { star: 2 }, drops: { w2: 2 }, settings: { waiver_bid: 500 } },
      { type: "waiver", status: "failed", roster_ids: [1], adds: { star: 1 }, settings: { waiver_bid: 14 } },
    ],
  });

  it("prices the claim against what lost", () => {
    expect(review.claims[0]).toMatchObject({ name: "star", price: 500, runnerUp: 14, bidders: 2, myBid: 14, winner: "Rival" });
    expect(review.roomSpent).toBe(500);
  });

  it("rebuilds the field before the run and ranks lowest first", () => {
    const me = review.me!;
    expect(me.rankAfter).toBe(1);
    const rival = review.field.find((f) => f.name === "Rival")!;
    expect(rival.after - rival.before).toBeCloseTo(12);
  });

  it("calls out a token bid", () => {
    expect(review.lessons.some((l) => l.includes("$14 on star"))).toBe(true);
  });

  it("replays the room model on the old rosters", () => {
    expect(review.prediction).toMatchObject({ called: 1, predicted: 1, actualMyRank: 1 });
  });
});
