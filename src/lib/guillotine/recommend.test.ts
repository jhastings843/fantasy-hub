import { describe, expect, it } from "vitest";
import {
  buildBidCard,
  classify,
  finalFourBars,
  priceTarget,
  startersByPosition,
  strictlyDescending,
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

describe("chain order matches Sleeper's processing order", () => {
  it("never lets a fallback outbid the target ahead of it", () => {
    const budget = planBudget({
      budget: 1000,
      remaining: 1000,
      teamsAlive: 15,
      totalTeams: 16,
      posture: "green",
      rivalRemaining: Array(14).fill(1000),
    });
    const market = buildMarket(1000, budget.phase, []);
    // Two multiweek players who both replace the same weak flex. The one
    // with the smaller lineup gain must not carry the bigger bid.
    const card = buildBidCard({
      ...input({ budget, market, posture: "green" }),
      candidates: [
        player("a", "WR", 9, { rosPoints: 9 }),
        player("b", "RB", 8.5, { rosPoints: 8.5 }),
        player("c", "WR", 8, { rosPoints: 8 }),
      ],
      leaguePlayers: [{ position: "WR", rosPoints: 30 }, { position: "RB", rosPoints: 30 }],
    });
    for (const chain of card.chains) {
      for (let i = 1; i < chain.targets.length; i++) {
        expect(chain.targets[i].bid).toBeLessThanOrEqual(chain.targets[i - 1].bid);
        expect(chain.targets[i].walkAway).toBeLessThanOrEqual(chain.targets[i - 1].walkAway);
      }
    }
  });
});

// The three things a week-3 card got wrong against the live league, kept as
// tests because each one was a defensible-looking rule that produced a bid Jack
// would not have made.
// The shared fixture above plans a $20 weekly cap, which clamps every bid to
// the same number and hides exactly what these tests are about. This is the
// same league in a week where there is money to spend.
const roomToSpend = planBudget({
  budget: 1000,
  remaining: 900,
  teamsAlive: 12,
  totalTeams: 16,
  posture: "red",
  rivalRemaining: Array(11).fill(800),
});

describe("telling apart players who fill the same hole", () => {
  // A quarterback hole, and four quarterbacks who would fill it. Every one of
  // them replaces a zero, so the lineup gain cannot separate them: that is the
  // whole point. Their season projections can.
  const hurtStarter = [
    player("qb", "QB", 0, { injuryStatus: "Out", rosPoints: 300 }),
    ...myPlayers.filter((p) => p.playerId !== "qb"),
  ];
  // The league bar for a starting quarterback in this fixture is 28.5 season
  // points, so these three are a fringe starter, a slightly worse one, and a
  // player the feed never projected at all.
  const qbs = [
    player("elite", "QB", 19, { rosPoints: 28 }),
    player("good", "QB", 18.1, { rosPoints: 26 }),
    player("streamer", "QB", 16.7, { rosPoints: 0 }),
  ];
  const card = buildBidCard(
    input({ myPlayers: hurtStarter, candidates: qbs, posture: "red", budget: roomToSpend }),
  );
  const bidFor = (id: string) =>
    card.chains.flatMap((c) => c.targets).find((t) => t.player.playerId === id)?.bid ?? 0;

  it("does not price the streamer like the starter", () => {
    // The gap is narrower than it used to be, on purpose: both are priced off
    // what it takes to win a multiweek starter in this room, and the streamer
    // is cheaper because his own value runs out first, not because the market
    // for quarterbacks is three different markets.
    expect(bidFor("elite")).toBeGreaterThan(bidFor("streamer") * 1.3);
  });

  it("still keeps the two real starters close, because they are close", () => {
    expect(bidFor("good")).toBeGreaterThan(bidFor("elite") * 0.8);
  });
});

describe("a player who cannot play this week", () => {
  const out = player("hurt", "TE", 14, { injuryStatus: "Out", rosPoints: 20 });
  const healthy = player("fit", "TE", 11, { rosPoints: 20 });
  // Good enough that he is worth owning for the endgame even while hurt.
  const elite = player("star", "WR", 16, { injuryStatus: "Out", rosPoints: 300 });

  it("is not priced on a lineup gain he cannot deliver", () => {
    // Sleeper ships an injury status and a full projection on the same row, so
    // the feed will happily say a player who is out scores fourteen points.
    const red = buildBidCard(
      input({ candidates: [out, healthy], posture: "red", budget: roomToSpend }),
    );
    const targets = red.chains.flatMap((c) => c.targets);
    const hurtBid = targets.find((t) => t.player.playerId === "hurt")?.bid ?? 0;
    const healthyBid = targets.find((t) => t.player.playerId === "fit")?.bid ?? 0;
    expect(hurtBid).toBeLessThan(healthyBid);
  });

  it("costs less when this week is the week that decides you", () => {
    // One budget, two postures, so the only thing that moves is the price of a
    // player who is not playing.
    const green = buildBidCard(input({ candidates: [elite], posture: "green", budget: roomToSpend }));
    const red = buildBidCard(input({ candidates: [elite], posture: "red", budget: roomToSpend }));
    const bid = (card: ReturnType<typeof buildBidCard>) =>
      card.chains.flatMap((c) => c.targets)[0]?.bid ?? 0;
    // Red urgency is 1.3x and green is 0.35x, so a red card outbidding a green
    // one is the normal case. The injury discount has to be strong enough to
    // invert that, because a player who does not play cannot save a week.
    expect(bid(red)).toBeLessThan(bid(green));
  });

  it("keeps a player who cannot play off the card unless he is worth owning anyway", () => {
    // A mid tier player who is out this week is not a waiver claim, he is a
    // roster spot spent on nothing.
    const card = buildBidCard(input({ candidates: [out], posture: "red", budget: roomToSpend }));
    expect(card.chains.flatMap((c) => c.targets)).toHaveLength(0);
  });

  it("says why the price is what it is", () => {
    const card = buildBidCard(input({ candidates: [elite], posture: "red", budget: roomToSpend }));
    const reason = card.chains.flatMap((c) => c.targets)[0]?.reason ?? "";
    expect(reason).toContain("not for Sunday");
  });
});

describe("what the rest of the league needs", () => {
  const target = player("wanted", "WR", 16);
  const bars = (worstWr: number) =>
    Array.from({ length: 11 }, (_, i) => ({
      name: `Rival ${i + 1}`,
      faabLeft: 800,
      bars: { QB: 20, RB: 12, WR: worstWr, TE: 8 },
    }));

  it("pays more for a player several rivals would start", () => {
    const contested = buildBidCard(
      input({ candidates: [target], rivals: bars(8), budget: roomToSpend }),
    );
    const alone = buildBidCard(
      input({ candidates: [target], rivals: bars(20), budget: roomToSpend }),
    );
    const bid = (card: ReturnType<typeof buildBidCard>) =>
      card.chains.flatMap((c) => c.targets)[0]?.bid ?? 0;
    expect(bid(contested)).toBeGreaterThan(bid(alone));
  });

  it("has no opinion when it cannot see the other rosters", () => {
    const blind = buildBidCard(input({ candidates: [target], budget: roomToSpend }));
    const neutral = buildBidCard(
      input({ candidates: [target], rivals: [{ name: "One rival", faabLeft: 800, bars: { WR: 10 } }], budget: roomToSpend }),
    );
    const bid = (card: ReturnType<typeof buildBidCard>) =>
      card.chains.flatMap((c) => c.targets)[0]?.bid ?? 0;
    expect(bid(blind)).toBe(bid(neutral));
  });
});

describe("the hold rule on thin upgrades", () => {
  // Both strategy docs: hold when the gain is 2-3 projected points for 10-20%
  // of the budget. This is the rule the week 3 card broke by pricing a 3.1
  // point upgrade at $208 of $1000.
  // An elite player by season projection who barely beats my worst starter
  // this week: the exact shape the rule is written for.
  const thin = player("thin", "WR", 6, { rosPoints: 300 });
  const budget = planBudget({
    budget: 1000,
    remaining: 900,
    teamsAlive: 12,
    totalTeams: 16,
    posture: "red",
    rivalRemaining: Array(11).fill(800),
  });

  it("caps a small weekly upgrade at a tenth of the budget per three points", () => {
    const card = buildBidCard(input({ candidates: [thin], posture: "red", budget }));
    const target = card.chains.flatMap((c) => c.targets)[0];
    // He beats my worst starter by about a point, so the ceiling is well under
    // the $250 single-bid limit that would otherwise apply.
    expect(target.bid).toBeLessThanOrEqual(100);
  });

  it("lifts the cap for an endgame buy made from a safe week", () => {
    const red = buildBidCard(input({ candidates: [thin], posture: "red", budget }));
    const green = buildBidCard(input({ candidates: [thin], posture: "green", budget }));
    const bid = (card: ReturnType<typeof buildBidCard>) =>
      card.chains.flatMap((c) => c.targets)[0]?.walkAway ?? 0;
    // Green urgency is 0.35 against red's 1.3, so green losing this comparison
    // would prove nothing. The walk-away number is where the ceiling shows.
    expect(bid(green)).toBeGreaterThan(bid(red));
  });

  it("leaves a real lineup upgrade alone", () => {
    const real = player("real", "TE", 18, { rosPoints: 20 });
    const card = buildBidCard(input({ candidates: [real], posture: "red", budget }));
    const target = card.chains.flatMap((c) => c.targets)[0];
    // Thirteen points of gain, so the rate ceiling lands near $430 and never
    // touches a bid the market put at a fraction of that.
    expect(target.weekGain).toBeGreaterThan(10);
    // Priced off the market rather than off the ceiling, so what matters is
    // that the hold rule is nowhere near it.
    expect(target.bid).toBeGreaterThan(40);
    expect(target.walkAway).toBeGreaterThan(target.bid);
  });
});

describe("pricing against the rivals who actually exist", () => {
  const budget = planBudget({
    budget: 1000,
    remaining: 900,
    teamsAlive: 14,
    totalTeams: 16,
    posture: "red",
    rivalRemaining: Array(13).fill(900),
  });

  // Week 3 put four startable quarterbacks in front of two teams that needed
  // one, and the model bid $106 on the best of them in a room that had never
  // paid more than $56 for a multiweek starter.
  const qbs = [
    player("best", "QB", 18.3, { rosPoints: 28 }),
    player("second", "QB", 17.6, { rosPoints: 27 }),
    player("third", "QB", 17.2, { rosPoints: 26 }),
    player("fourth", "QB", 16.7, { rosPoints: 25 }),
  ];
  const needsAQb = { name: "DonovanQ", faabLeft: 948, bars: { QB: 0, RB: 14, WR: 14, TE: 10 } };
  const happy = (i: number) => ({
    name: `Rival ${i}`,
    faabLeft: 900,
    bars: { QB: 18, RB: 14, WR: 14, TE: 10 },
  });
  const hurtStarter = [
    player("qb", "QB", 0, { injuryStatus: "Out", rosPoints: 28 }),
    ...myPlayers.filter((p) => p.playerId !== "qb"),
  ];

  const cardWith = (rivals: RecommendInput["rivals"]) =>
    buildBidCard(
      input({ myPlayers: hurtStarter, candidates: qbs, posture: "red", budget, rivals }),
    );

  const topBid = (rivals: RecommendInput["rivals"]) =>
    cardWith(rivals).chains.flatMap((c) => c.targets)[0]?.bid ?? 0;

  it("does not pay a scarcity price when the position is not scarce", () => {
    const oneNeedyRival = [needsAQb, ...Array.from({ length: 12 }, (_, i) => happy(i))];
    // One bidder, four interchangeable quarterbacks. The market estimate for a
    // multiweek starter in this fixture is the number to stay near.
    expect(topBid(oneNeedyRival)).toBeLessThan(80);
  });

  it("pays up when the same rivals have nowhere else to go", () => {
    const scarce = input({
      myPlayers: hurtStarter,
      candidates: [qbs[0]],
      posture: "red",
      budget,
      rivals: [needsAQb, { ...needsAQb, name: "Second needy" }, { ...needsAQb, name: "Third needy" }],
    });
    const contested = buildBidCard(scarce).chains.flatMap((c) => c.targets)[0]?.bid ?? 0;
    const oneNeedyRival = [needsAQb, ...Array.from({ length: 12 }, (_, i) => happy(i))];
    expect(contested).toBeGreaterThan(topBid(oneNeedyRival));
  });

  it("ignores a rival who wants him and cannot pay", () => {
    const broke = [{ ...needsAQb, faabLeft: 3 }, ...Array.from({ length: 12 }, (_, i) => happy(i))];
    const solvent = [needsAQb, ...Array.from({ length: 12 }, (_, i) => happy(i))];
    expect(topBid(broke)).toBeLessThan(topBid(solvent));
  });

  it("names the rival and says what else he could buy", () => {
    const oneNeedyRival = [needsAQb, ...Array.from({ length: 12 }, (_, i) => happy(i))];
    const reason = cardWith(oneNeedyRival).chains.flatMap((c) => c.targets)[0]?.reason ?? "";
    expect(reason).toContain("DonovanQ would start him");
    expect(reason).toContain("comparable");
  });

  it("keeps the walk-away above the bid, because they answer different questions", () => {
    const oneNeedyRival = [needsAQb, ...Array.from({ length: 12 }, (_, i) => happy(i))];
    const target = cardWith(oneNeedyRival).chains.flatMap((c) => c.targets)[0];
    expect(target.walkAway).toBeGreaterThan(target.bid);
  });
});

// Week 3, 2026, Dah Chopped League. Jayden Daniels was out, and four
// quarterbacks within 1.4 points of each other were on the wire. The card bid
// $59, $58, $58 and $38 on them. Nobody else bid on Nix or Lock, Nix won at
// $58, and Lock went unclaimed and was a free pickup the next morning.
describe("a glut at one position", () => {
  const qbs = [
    player("burrow", "QB", 18.2),
    player("kyler", "QB", 17.6),
    player("nix", "QB", 17.1),
    player("lock", "QB", 16.8),
  ];
  const withQbOut = myPlayers.map((p) => (p.playerId === "qb" ? { ...p, weekPoints: 0 } : p));
  const rivalsNeedingQb = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      name: `rival${i}`,
      faabLeft: 1000,
      bars: { QB: 10, RB: 30, WR: 30, TE: 30 },
    }));
  const card = (rivals: number) =>
    buildBidCard({
      ...input({ budget: roomToSpend, posture: "red" }),
      myPlayers: withQbOut,
      candidates: qbs,
      rivals: rivalsNeedingQb(rivals),
    });
  const qbChain = (c: ReturnType<typeof card>) =>
    c.chains.find((ch) => ch.targets.some((t) => t.player.position === "QB"))!;

  it("bids the minimum on the fallback that will be left over", () => {
    const chain = qbChain(card(3));
    expect(chain.targets.at(-1)!.player.playerId).toBe("lock");
    expect(chain.targets.at(-1)!.bid).toBe(1);
  });

  it("prices each step up by the points it adds over the next one", () => {
    const chain = qbChain(card(3));
    const nix = chain.targets.find((t) => t.player.playerId === "nix")!;
    // 0.3 points over a free Drew Lock is not worth $58.
    expect(nix.bid).toBeLessThan(10);
  });

  it("puts no two claims at the same price", () => {
    const chain = qbChain(card(3));
    const bids = chain.targets.map((t) => t.bid);
    expect(new Set(bids).size).toBe(bids.length);
    for (let i = 1; i < bids.length; i++) expect(bids[i]).toBeLessThan(bids[i - 1]);
  });

  it("pays full price when every quarterback has a bidder", () => {
    // Five rivals for four players: nobody is left over, so no free fallback.
    const chain = qbChain(card(5));
    expect(chain.targets.at(-1)!.bid).toBeGreaterThan(10);
  });
});

describe("strictlyDescending", () => {
  const t = (bid: number, walkAway = bid) => ({ bid, walkAway }) as never;

  it("breaks a tie so Sleeper runs the claims in the card's order", () => {
    const targets = [t(59), t(58), t(58), t(38)];
    strictlyDescending(targets);
    expect(targets.map((x: { bid: number }) => x.bid)).toEqual([59, 58, 57, 38]);
  });

  it("lifts from the bottom when the floor leaves no room", () => {
    const targets = [t(1), t(1), t(1)];
    strictlyDescending(targets);
    expect(targets.map((x: { bid: number }) => x.bid)).toEqual([3, 2, 1]);
  });
});
