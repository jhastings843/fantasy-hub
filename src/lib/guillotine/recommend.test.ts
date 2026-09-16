import { describe, expect, it } from "vitest";
import {
  buildBidCard,
  classify,
  finalFourBars,
  priceTarget,
  startersByPosition,
} from "./recommend";
import type { RecommendInput } from "./recommend";
import { buildMarket } from "./market";
import { planBudget } from "./budget";
import type { PoolPlayer } from "./types";

const CHOPPED_ROSTER = [
  "QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "FLEX",
  "BN", "BN", "BN", "BN", "BN", "BN",
];

function player(
  id: string,
  position: string,
  weekPoints: number,
  extra: Partial<PoolPlayer> = {},
): PoolPlayer {
  return {
    playerId: id,
    name: `Player ${id}`,
    position,
    team: "NE",
    weekPoints,
    rosPoints: weekPoints,
    injuryStatus: null,
    byeWeek: null,
    fromChoppedRoster: false,
    ...extra,
  };
}

// A roster with a clearly weak flex and tight end.
const myPlayers: PoolPlayer[] = [
  player("qb", "QB", 18),
  player("rb1", "RB", 16),
  player("rb2", "RB", 11),
  player("wr1", "WR", 15),
  player("wr2", "WR", 13),
  player("te", "TE", 5),
  player("rb3", "RB", 9),
  player("wr3", "WR", 4),
  player("bench1", "WR", 3),
  player("bench2", "RB", 2),
];

function input(over: Partial<RecommendInput> = {}): RecommendInput {
  const budget = planBudget({
    budget: 1000,
    remaining: 900,
    teamsAlive: 12,
    totalTeams: 16,
    posture: "yellow",
    rivalRemaining: Array(11).fill(800),
  });
  return {
    myPlayers,
    candidates: [],
    rosterPositions: CHOPPED_ROSTER,
    budget,
    market: buildMarket(1000, "field", []),
    posture: "yellow",
    week: 5,
    leaguePlayers: ["QB", "RB", "WR", "TE"].flatMap((position) =>
      Array.from({ length: 50 }, (_, i) => ({ position, rosPoints: 30 - i * 0.5 })),
    ),
    ...over,
  };
}

describe("startersByPosition", () => {
  it("splits flex slots across the positions that can fill them", () => {
    const slots = startersByPosition(CHOPPED_ROSTER);
    expect(slots.QB).toBeCloseTo(1, 5);
    // Two RB slots plus two thirds of each of two flexes.
    expect(slots.RB).toBeCloseTo(2 + 2 / 3, 5);
    expect(slots.WR).toBeCloseTo(2 + 2 / 3, 5);
    expect(slots.TE).toBeCloseTo(1 + 2 / 3, 5);
  });

  it("ignores bench slots", () => {
    expect(startersByPosition(["QB", "BN", "BN"])).toEqual({ QB: 1 });
  });
});

describe("finalFourBars", () => {
  const league = [
    ...Array.from({ length: 20 }, (_, i) => ({ position: "QB", rosPoints: 100 - i })),
    ...Array.from({ length: 20 }, (_, i) => ({ position: "RB", rosPoints: 50 - i })),
  ];

  it("draws a separate bar for each position", () => {
    const bars = finalFourBars(league, CHOPPED_ROSTER);
    // Four teams starting one QB each: the 4th best quarterback.
    expect(bars.QB).toBe(97);
    // Four teams starting ~2.67 RBs each: about the 11th best back.
    expect(bars.RB).toBe(40);
  });

  it("does not let quarterbacks set the bar for running backs", () => {
    // Every QB outscores every RB, and the RB bar must not follow.
    const bars = finalFourBars(league, CHOPPED_ROSTER);
    expect(bars.RB).toBeLessThan(bars.QB);
  });

  it("is unreachable for a position nobody rosters", () => {
    expect(finalFourBars([], CHOPPED_ROSTER).TE).toBe(Infinity);
  });

  it("handles a position with fewer players than starting slots", () => {
    const thin = [{ position: "TE", rosPoints: 9 }];
    expect(finalFourBars(thin, CHOPPED_ROSTER).TE).toBe(9);
  });
});

describe("classify", () => {
  const bars = { QB: 20, RB: 20, WR: 20, TE: 20 };

  it("calls a top-32 player a championship starter regardless of fit", () => {
    expect(classify(player("x", "WR", 25), 0, bars, 5)).toBe("championship");
  });

  it("calls a real lineup upgrade a multiweek starter", () => {
    expect(classify(player("x", "WR", 12), 6, bars, 5)).toBe("multiweek");
  });

  it("calls a marginal upgrade a band-aid", () => {
    expect(classify(player("x", "WR", 8), 1, bars, 5)).toBe("bandaid");
  });

  it("treats upcoming bye cover as a band-aid, not a stash", () => {
    expect(classify(player("x", "WR", 8, { byeWeek: 7 }), 0, bars, 5)).toBe("bandaid");
  });

  it("ignores a bye that has already passed", () => {
    expect(classify(player("x", "WR", 8, { byeWeek: 3 }), 0, bars, 5)).toBe("stash");
  });

  it("calls everything else a stash", () => {
    expect(classify(player("x", "WR", 8), 0, bars, 5)).toBe("stash");
  });
});

describe("priceTarget", () => {
  const market = buildMarket(1000, "field", []);
  const budget = planBudget({
    budget: 1000,
    remaining: 900,
    teamsAlive: 12,
    totalTeams: 16,
    posture: "red",
    rivalRemaining: Array(11).fill(800),
  });

  it("bids well under market in a green week", () => {
    const green = priceTarget("championship", 5, market, budget, "green");
    const yellow = priceTarget("championship", 5, market, budget, "yellow");
    expect(green.bid).toBeLessThan(yellow.bid);
  });

  it("bids over market when in danger", () => {
    const red = priceTarget("multiweek", 8, market, budget, "red");
    expect(red.bid).toBeGreaterThan(red.marketExpected);
  });

  it("never exceeds the single-bid cap", () => {
    const tiny = planBudget({
      budget: 1000,
      remaining: 60,
      teamsAlive: 12,
      totalTeams: 16,
      posture: "red",
      rivalRemaining: Array(11).fill(800),
    });
    const priced = priceTarget("championship", 12, market, tiny, "red");
    expect(priced.bid).toBeLessThanOrEqual(tiny.maxSingleBid);
    expect(priced.walkAway).toBeLessThanOrEqual(tiny.maxSingleBid);
  });

  it("avoids round numbers", () => {
    const priced = priceTarget("championship", 5, market, budget, "yellow");
    expect(priced.bid % 5).not.toBe(0);
  });

  it("never bids zero", () => {
    const priced = priceTarget("stash", 0.1, market, budget, "green");
    expect(priced.bid).toBeGreaterThanOrEqual(1);
  });
});

describe("buildBidCard", () => {
  it("sits out when nothing on the board helps", () => {
    const card = buildBidCard(
      input({ candidates: [player("junk", "WR", 1), player("junk2", "RB", 2)] }),
    );
    expect(card.sitOut).toBe(true);
    expect(card.summary).toContain("Hold");
  });

  it("tells a safe team to sit out in so many words", () => {
    const card = buildBidCard(
      input({ posture: "green", candidates: [player("junk", "WR", 1)] }),
    );
    expect(card.summary).toContain("Sit this run out");
  });

  it("says sitting out is the answer without pretending it found something", () => {
    const card = buildBidCard(input({ candidates: [] }));
    expect(card.chains).toHaveLength(0);
    expect(card.maxPossibleSpend).toBe(0);
  });

  it("prices a player on lineup gain, not on his projection", () => {
    // A 20-point WR replaces a 4-point starter: gain 16, not 20.
    const card = buildBidCard(input({ candidates: [player("star", "WR", 20)] }));
    const target = card.chains[0].targets[0];
    expect(target.weekGain).toBeCloseTo(16, 5);
    expect(target.displaces?.name).toBe("Player wr3");
  });

  it("drops a bench player, never a starter", () => {
    const card = buildBidCard(input({ candidates: [player("star", "WR", 20)] }));
    const dropId = card.chains[0].drop?.playerId;
    expect(["bench1", "bench2"]).toContain(dropId);
  });

  it("gives each chain its own drop so two wins cannot collide", () => {
    const card = buildBidCard(
      input({
        candidates: [
          player("wrA", "WR", 20),
          player("teA", "TE", 14),
          player("qbA", "QB", 26),
        ],
      }),
    );
    const drops = card.chains.map((c) => c.drop?.playerId).filter(Boolean);
    expect(new Set(drops).size).toBe(drops.length);
  });

  it("keeps alternatives for one hole in a single chain", () => {
    const card = buildBidCard(
      input({
        candidates: [
          player("te1", "TE", 15),
          player("te2", "TE", 13),
          player("te3", "TE", 12),
        ],
      }),
    );
    const teChain = card.chains.find((c) => c.need.startsWith("TE"));
    expect(teChain?.targets.length).toBeGreaterThan(1);
  });

  it("never lets the worst case exceed the week's cap", () => {
    const budget = planBudget({
      budget: 1000,
      remaining: 900,
      teamsAlive: 12,
      totalTeams: 16,
      posture: "yellow",
      rivalRemaining: Array(11).fill(800),
    });
    const card = buildBidCard(
      input({
        budget,
        candidates: [
          player("wrA", "WR", 22),
          player("teA", "TE", 18),
          player("qbA", "QB", 28),
        ],
      }),
    );
    expect(card.maxPossibleSpend).toBeLessThanOrEqual(Math.ceil(budget.weeklyCap));
  });

  it("counts the worst case as one win per chain, not one per claim", () => {
    const card = buildBidCard(
      input({
        candidates: [
          player("te1", "TE", 15),
          player("te2", "TE", 14),
          player("te3", "TE", 13),
        ],
      }),
    );
    const chain = card.chains[0];
    const sumOfAll = chain.targets.reduce((s, t) => s + t.bid, 0);
    expect(card.maxPossibleSpend).toBeLessThan(sumOfAll);
  });

  it("keeps a top-32 player on the card even when he would not start today", () => {
    const elite = player("elite", "QB", 2, { rosPoints: 40 });
    const card = buildBidCard(input({ candidates: [elite] }));
    const found = card.chains.flatMap((c) => c.targets).find((t) => t.player.playerId === "elite");
    expect(found?.tier).toBe("championship");
  });

  it("says where a player came from when he came off the chopped roster", () => {
    const card = buildBidCard(
      input({ candidates: [player("star", "WR", 20, { fromChoppedRoster: true })] }),
    );
    expect(card.chains[0].targets[0].reason).toContain("chopped roster");
  });

  it("names the injury and the bye in the reason", () => {
    const card = buildBidCard(
      input({
        candidates: [player("star", "WR", 20, { injuryStatus: "Questionable", byeWeek: 9 })],
      }),
    );
    const reason = card.chains[0].targets[0].reason;
    expect(reason).toContain("Questionable");
    expect(reason).toContain("bye week 9");
  });

  it("shows at most three chains", () => {
    const many = ["WR", "RB", "TE", "QB"].map((pos, i) => player(`p${i}`, pos, 25));
    const card = buildBidCard(input({ candidates: many }));
    expect(card.chains.length).toBeLessThanOrEqual(3);
  });
});

describe("summary honesty", () => {
  it("says a price-enforcing bid will lose instead of calling it the one that matters", () => {
    const budget = planBudget({
      budget: 1000,
      remaining: 1000,
      teamsAlive: 15,
      totalTeams: 16,
      posture: "green",
      rivalRemaining: Array(14).fill(1000),
    });
    const market = buildMarket(1000, budget.phase, []);
    const star = player("star", "RB", 22, { rosPoints: 22, fromChoppedRoster: true });
    const card = buildBidCard({
      ...input({ budget, market, posture: "green" }),
      candidates: [star],
      leaguePlayers: [{ position: "RB", rosPoints: 22 }],
    });
    const top = card.chains[0]?.targets[0];
    expect(top).toBeDefined();
    expect(top!.bid).toBeLessThan(top!.marketExpected / 2);
    expect(card.summary).toContain("will almost certainly lose");
    expect(card.summary).not.toContain("the one that matters");
  });
});
