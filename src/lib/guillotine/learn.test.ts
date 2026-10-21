import { describe, expect, it } from "vitest";
import {
  auctionsFrom,
  gradeChopCalls,
  gradeOurBids,
  gradeShadows,
  rivalProfiles,
  roomFactor,
  summarizeOurBids,
  typicalTop,
  type LearnTransaction,
  type SavedCard,
  type WeekPoints,
} from "./learn";

const bid = (rosterId: number, playerId: string, amount: number, won: boolean): LearnTransaction => ({
  type: "waiver",
  status: won ? "complete" : "failed",
  roster_ids: [rosterId],
  adds: { [playerId]: rosterId },
  settings: { waiver_bid: amount },
  metadata: won ? null : { notes: "This player was claimed by another owner." },
});

describe("auctionsFrom", () => {
  it("groups every bid on a player, highest first, with the runner-up and wallets at the time", () => {
    const a = auctionsFrom(
      {
        1: [bid(1, "p1", 100, true), bid(2, "p1", 60, false), bid(3, "p1", 204, false) /* failed: over budget */],
        2: [bid(1, "p2", 50, true), bid(2, "p2", 49, false)],
      },
      1000,
    );
    // A 204 that failed while a 100 won was never in the auction (Sleeper failed it for room or money).
    expect(a[0]).toMatchObject({ leg: 1, playerId: "p1", winner: 1, price: 100, runnerUp: 60 });
    expect(a[0].bids).toHaveLength(2);
    expect(a[1]).toMatchObject({ leg: 2, playerId: "p2", winner: 1, price: 50, runnerUp: 49 });
    // Roster 1 spent 100 in leg 1, so it had 900 going into leg 2.
    expect(a[1].bids.find((b) => b.rosterId === 1)?.leftBefore).toBe(900);
  });

  it("ignores failed bids on a player nobody won, and non-waiver moves", () => {
    const a = auctionsFrom(
      { 3: [bid(2, "p9", 5, false), { type: "free_agent", status: "complete", roster_ids: [4], adds: { p8: 4 } }] },
      1000,
    );
    expect(a).toEqual([]);
  });
});

describe("rivalProfiles and roomFactor", () => {
  const auctions = auctionsFrom(
    {
      1: [bid(2, "a", 150, true), bid(3, "a", 50, false), bid(4, "a", 40, false)],
      2: [bid(2, "b", 140, true), bid(3, "b", 45, false)],
      3: [bid(2, "c", 160, true), bid(4, "c", 60, false)],
    },
    1000,
  );
  const profiles = rivalProfiles(
    auctions,
    [
      { rosterId: 2, name: "Big Spender" },
      { rosterId: 3, name: "Cheap" },
      { rosterId: 5, name: "Never Bids" },
    ],
    () => "WR",
    3,
  );

  it("reads a manager who pushes past the field head to head as aggressive, and a quiet one as average", () => {
    const big = profiles.find((p) => p.rosterId === 2)!;
    const cheap = profiles.find((p) => p.rosterId === 3)!;
    const none = profiles.find((p) => p.rosterId === 5)!;
    expect(big.aggression).toBeGreaterThan(1.3);
    expect(cheap.aggression).toBeLessThan(1);
    expect(none).toMatchObject({ bids: 0, contested: 0, aggression: 1 });
    expect(big).toMatchObject({ bids: 3, contested: 3, wins: 3, spent: 450, activeWeeks: 3, positions: ["WR"] });
    expect(big.maxShare).toBeCloseTo(160 / 710, 2);
  });

  it("prices off the most aggressive rival who wants him, against the typical toughest bidder, inside the bounds", () => {
    const byName = new Map(profiles.map((p) => [p.name, p.aggression]));
    // Big Spender is in every contested auction, so he IS the typical toughest bidder.
    expect(typicalTop(auctions, profiles)).toBe(profiles.find((p) => p.rosterId === 2)!.aggression);
    expect(roomFactor([], byName)).toBe(1);
    expect(roomFactor(["Cheap"], byName)).toBeLessThan(1);
    expect(roomFactor(["Cheap"], byName)).toBeGreaterThanOrEqual(0.85);
    expect(roomFactor(["Cheap", "Big Spender"], byName)).toBe(1.25);
    expect(roomFactor(["Big Spender"], byName, 2)).toBeLessThan(1);
    expect(roomFactor(["Unknown"], byName)).toBe(1);
  });
});

const weeks: WeekPoints[] = [
  { week: 2, rosters: { 1: { players: { p1: 12, old: 4 }, starters: ["p1"], points: 100 } } },
  { week: 3, rosters: { 1: { players: { p1: 8, old: 9 }, starters: ["p1"], points: 90 } } },
];

describe("gradeOurBids", () => {
  it("records overpay over the runner-up, losses by how much, and started points since", () => {
    const auctions = auctionsFrom(
      { 1: [bid(1, "p1", 100, true), bid(2, "p1", 60, false), bid(1, "p2", 30, false), bid(3, "p2", 33, true)] },
      1000,
    );
    const graded = gradeOurBids(auctions, 1, weeks);
    const won = graded.find((b) => b.playerId === "p1")!;
    const lost = graded.find((b) => b.playerId === "p2")!;
    expect(won).toMatchObject({ won: true, margin: 39, startedPoints: 20, weeksSince: 2, bidders: 2 });
    expect(lost).toMatchObject({ won: false, margin: 3, startedPoints: null });
    expect(summarizeOurBids(graded)).toEqual({
      bids: 2, wins: 1, spent: 100, overpaid: 39, contestedWins: 1, uncontestedExtra: 0, uncontestedWins: 0, nearMisses: 1, pointsPerDollar: 0.2,
    });
  });
});

describe("gradeChopCalls", () => {
  it("scores the odds against who was actually chopped", () => {
    const [g] = gradeChopCalls(
      [{ week: 6, myRosterId: 1, posture: "yellow", field: [{ rosterId: 1, chopProbability: 0.2 }, { rosterId: 11, chopProbability: 0.5 }, { rosterId: 4, chopProbability: 0.3 }] }],
      { 6: 11 },
    );
    expect(g).toMatchObject({ week: 6, chopped: 11, givenToChopped: 0.5, rankOfChopped: 1, myProbability: 0.2 });
    expect(g.brier).toBeCloseTo((0.04 + 0.25 + 0.09) / 3, 3);
  });
});

describe("gradeShadows", () => {
  it("replays the saved card under each rule against the real bids", () => {
    const card: SavedCard = {
      week: 2,
      savedAt: "2026-09-15T12:00:00Z",
      posture: "red",
      chains: [{ drop: "old", targets: [{ playerId: "p1", name: "P1", tier: "multiweek", bid: 50, walkAway: 90, displaces: "old" }] }],
    };
    // Leg 1: a rival bid 60 on p1 and won it.
    const auctions = auctionsFrom({ 1: [bid(2, "p1", 60, true), bid(1, "p1", 50, false)] }, 1000);
    const pointsOf = (id: string, w: number) => (id === "p1" ? ({ 2: 12, 3: 8 } as Record<number, number>)[w] ?? null : null);
    const r = Object.fromEntries(gradeShadows([card], auctions, 1, weeks, pointsOf).map((s) => [s.id, s]));
    expect(r.live).toMatchObject({ weeks: 1, claims: 0, spent: 0, pointsAdded: 0 });
    expect(r.lean.claims).toBe(0);
    // 62 beats 60; 90 beats 60. Added = (12-4) + (8-9) = 7.
    expect(r.firm).toMatchObject({ claims: 1, spent: 63, pointsAdded: 7 });
    expect(r.walk).toMatchObject({ claims: 1, spent: 90, pointsAdded: 7 });
  });

  it("claims a player once across chains and never spends past the wallet", () => {
    const t = { playerId: "p1", name: "P1", tier: "multiweek" as const, bid: 70, walkAway: 90, displaces: "old" };
    const card: SavedCard = {
      week: 2, savedAt: "2026-09-15T12:00:00Z", posture: "red", faab: 80,
      chains: [{ drop: "old", targets: [t] }, { drop: "x", targets: [t] }],
    };
    const auctions = auctionsFrom({ 1: [bid(2, "p1", 60, true)] }, 1000);
    const r = Object.fromEntries(gradeShadows([card], auctions, 1, weeks, () => 5).map((s) => [s.id, s]));
    expect(r.live).toMatchObject({ claims: 1, spent: 70 });
    // The walk-away (90) is past the $80 wallet, so that rule claims nothing.
    expect(r.walk).toMatchObject({ claims: 0, spent: 0 });
  });
});
