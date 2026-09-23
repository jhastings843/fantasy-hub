// The bid card: what to claim, for how much, and what to drop.
//
// Two structural rules do most of the work here, and both come from the way
// people actually lose guillotine leagues rather than from any ranking.
//
// The first is that a bid is priced on what the player adds to your STARTING
// lineup. The second is that claims are grouped into chains that all drop the
// same player, which makes them mutually exclusive. Four independent claims at
// $180, $140, $70 and $35 each look reasonable alone and total $425 if they all
// land, and Sleeper will happily process all four.

import { bestLineup, marginalValue, startingSlots, type LineupPlayer } from "./lineup";
import { unroundBid, TIER_MEANING, type MarketModel, type Tier } from "./market";
import type { BudgetPlan } from "./budget";
import type { Posture } from "./chop-line";
import type { BidCard, BidChain, BidTarget, PoolPlayer } from "./types";

/**
 * The size of the field this bar is drawn for. Fantasy Life frames the ideal
 * end state as owning eight of the best players left when four teams remain.
 */
const FINAL_FOUR_TEAMS = 4;

/** Points added to the lineup that separate a real starter from a patch. */
const STARTER_GAIN = 2;

/** A gain this size is a full-price target; less scales the bid down. */
const REFERENCE_GAIN = 5;

/** How hard to lean in, by how much trouble you are in. */
const URGENCY: Record<Posture, number> = {
  red: 1.3,
  yellow: 1,
  green: 0.35,
};

/** Byes this many weeks out are worth acting on now, not later. */
const BYE_HORIZON = 3;

/** A bid under this share of the market number is price enforcement, not a plan to win. */
const PRICE_ENFORCEMENT_RATIO = 0.5;

/**
 * Statuses that mean he does not play this week.
 *
 * Sleeper's feed carries these on the projection row, and the projection it
 * ships alongside them is often NOT zeroed: Puka Nacua came through week 3
 * listed Out with 14.4 points still attached. Reading the number and ignoring
 * the word is how a card ends up leading with a player who scores nothing.
 */
const CANNOT_PLAY = /^(out|ir|pup|nfi|susp|doubtful|dnp|na)/i;

/**
 * What a hurt player's bid is multiplied by, once his weekly value is gone.
 *
 * The guillotine research is direct about this: hold when the player has an
 * imminent bye, an injury, or one unsustainable spike week. But it is a hold,
 * not a ban, because an elite player bought hurt is still an elite player in
 * the endgame, and the same research says the ideal end state is owning eight
 * of the best players left. So the discount is keyed to how much this week
 * matters. In red you are buying Sunday and a player who cannot play it is
 * nearly worthless; in green you can afford to buy December.
 */
const INJURED_DISCOUNT: Record<Posture, number> = {
  red: 0.3,
  yellow: 0.45,
  green: 0.7,
};

/**
 * The floor under a player's quality, as a share of his position's bar.
 *
 * Nobody on the card is worthless, and a season projection of zero usually
 * means the feed never projected him rather than that he cannot play.
 */
const MIN_QUALITY = 0.35;

/**
 * What competition for a player does to his price.
 *
 * The research says to estimate the rival bid and add an edge, and that the
 * spend triggers include teams around the line upgrading while you are not.
 * Both need to know who else wants him. Deliberately gentle: this counts which
 * rivals could start him, which is demand, not their willingness to pay for it.
 */
const DEMAND_FACTOR = { uncontested: 0.85, normal: 1, contested: 1.15 };

/**
 * The researched hold rule, as a price cap.
 *
 * Both strategy docs say the same thing in the same words: hold when the gain
 * is two to three projected points for ten to twenty percent of the budget.
 * The model had no way to express that, so a player who cleared the endgame
 * bar could be priced at a fifth of the budget for three points this week,
 * which is the exact trade the rule exists to refuse.
 *
 * It is a cap and not a ban, and it lifts for a genuine endgame buy made from
 * a safe week, because the other half of the research is that the ideal end
 * state is owning eight of the best players left. A week you might be chopped
 * in is not the week to buy December.
 */
const THIN_GAIN = 3;
const THIN_GAIN_CAP_SHARE = 0.1;

/** Rivals who would start him before the market counts as busy. */
const CONTESTED_AT = 3;

/** Points a rival's lineup has to gain before he is a real bidder for a player. */
const RIVAL_NEED_GAIN = 2;

/** Never show more than this many chains; a longer card is not a plan. */
const MAX_CHAINS = 3;

/** Fallbacks per chain, so a lost claim still lands something. */
const MAX_TARGETS_PER_CHAIN = 4;

export interface RecommendInput {
  myPlayers: PoolPlayer[];
  candidates: PoolPlayer[];
  rosterPositions: string[];
  budget: BudgetPlan;
  market: MarketModel;
  posture: Posture;
  week: number;
  /** Every player rostered anywhere in the league, for the positional bars. */
  leaguePlayers: { position: string; rosPoints: number }[];
  /**
   * One entry per surviving rival: the weakest starter they currently field at
   * each position, in projected points. A player who beats that number is
   * somebody they would start, which makes him somebody they may bid on.
   *
   * Optional because a caller that cannot see the other rosters should get a
   * card priced on the market alone rather than one priced as if nobody else
   * wanted anybody.
   */
  rivalStarterBars?: Record<string, number>[];
}

const asLineup = (p: PoolPlayer, useRos = false): LineupPlayer => ({
  playerId: p.playerId,
  position: p.position,
  points: useRos ? p.rosPoints : p.weekPoints,
});

/**
 * The chance he plays, 0 to 1.
 *
 * Prefers the crossed number the report works out from Sleeper, ESPN and
 * whether Sleeper still projects him, and falls back to reading the raw tag
 * for any caller that did not do that work.
 */
export function playsProbability(player: {
  injuryStatus: string | null;
  plays?: number;
}): number {
  if (typeof player.plays === "number") return Math.min(1, Math.max(0, player.plays));
  return player.injuryStatus != null && CANNOT_PLAY.test(player.injuryStatus.trim()) ? 0 : 1;
}

/** He is not expected to be in the lineup at all. */
export function cannotPlay(player: { injuryStatus: string | null; plays?: number }): boolean {
  return playsProbability(player) === 0;
}

/**
 * How good he is for his position, as a share of what a final-four starter is.
 *
 * This is what stops four quarterbacks who all replace an injured starter from
 * being priced identically. Every one of them adds fifteen points to a lineup
 * with a hole in it, so the lineup gain cannot tell them apart, and the tier
 * ladder puts all of them on the same rung unless they are outright elite. The
 * season projection can tell them apart, and it is already in hand.
 */
export function qualityFactor(player: PoolPlayer, bars: Record<string, number>): number {
  const bar = bars[player.position];
  if (!bar || !Number.isFinite(bar) || bar <= 0) return 1;
  return Math.min(1, Math.max(MIN_QUALITY, player.rosPoints / bar));
}

/** How many surviving rivals would put this player straight into their lineup. */
export function contestedBy(
  player: PoolPlayer,
  rivalStarterBars: Record<string, number>[],
): number {
  return rivalStarterBars.filter((bars) => {
    const theirs = bars[player.position];
    if (theirs == null) return false;
    return player.weekPoints - theirs >= RIVAL_NEED_GAIN;
  }).length;
}

function demandFactor(contested: number, rivals: number): number {
  // No rosters to read means no opinion, rather than a discount for silence.
  if (rivals === 0) return DEMAND_FACTOR.normal;
  if (contested === 0) return DEMAND_FACTOR.uncontested;
  return contested >= CONTESTED_AT ? DEMAND_FACTOR.contested : DEMAND_FACTOR.normal;
}

/**
 * How many players at each position a four-team field would be starting.
 *
 * Flex slots are split across the positions that can fill them, so a lineup
 * with two flexes counts roughly two thirds of an extra running back rather
 * than a whole one.
 */
export function startersByPosition(rosterPositions: string[]): Record<string, number> {
  const slots: Record<string, number> = {};
  for (const slot of startingSlots(rosterPositions)) {
    const eligible = FLEX_ELIGIBILITY[slot];
    if (eligible) {
      for (const position of eligible) {
        slots[position] = (slots[position] ?? 0) + 1 / eligible.length;
      }
    } else {
      slots[slot] = (slots[slot] ?? 0) + 1;
    }
  }
  return slots;
}

/** Which positions each multi-position slot accepts. Single-position slots are not here. */
const FLEX_ELIGIBILITY: Record<string, string[]> = {
  FLEX: ["RB", "WR", "TE"],
  WRRB_FLEX: ["RB", "WR"],
  WRRB_WRT: ["RB", "WR", "TE"],
  REC_FLEX: ["WR", "TE"],
  SUPER_FLEX: ["QB", "RB", "WR", "TE"],
};

/**
 * The rest-of-season rate that marks an endgame starter, PER POSITION.
 *
 * Doing this league-wide instead was the first version and it was badly wrong:
 * quarterbacks outscore every other position on raw points, so a single top-32
 * list is almost entirely quarterbacks, and in a one-QB league that made every
 * spare quarterback on waivers read as a championship target worth 20% of the
 * budget. A player is only elite against the players who compete for his slot.
 */
export function finalFourBars(
  players: { position: string; rosPoints: number }[],
  rosterPositions: string[],
): Record<string, number> {
  const perTeam = startersByPosition(rosterPositions);
  const bars: Record<string, number> = {};

  for (const [position, slots] of Object.entries(perTeam)) {
    const pool = players
      .filter((p) => p.position === position)
      .map((p) => p.rosPoints)
      .sort((a, b) => b - a);
    if (pool.length === 0) {
      bars[position] = Infinity;
      continue;
    }
    const index = Math.max(1, Math.round(FINAL_FOUR_TEAMS * slots)) - 1;
    bars[position] = pool[Math.min(index, pool.length - 1)];
  }

  return bars;
}

export function classify(
  player: PoolPlayer,
  weekGain: number,
  bars: Record<string, number>,
  week: number,
): Tier {
  const bar = bars[player.position] ?? Infinity;
  if (player.rosPoints >= bar) return "championship";
  if (weekGain >= STARTER_GAIN) return "multiweek";
  if (weekGain > 0) return "bandaid";
  if (player.byeWeek != null && player.byeWeek > week && player.byeWeek <= week + BYE_HORIZON) {
    return "bandaid";
  }
  return "stash";
}

function reasonFor(
  player: PoolPlayer,
  tier: Tier,
  weekGain: number,
  displacesName: string | null,
  demand: { contested: number; rivals: number } = { contested: 0, rivals: 0 },
): string {
  const parts: string[] = [];

  if (player.fromChoppedRoster) parts.push("Off this week's chopped roster");

  if (weekGain > 0) {
    parts.push(
      displacesName
        ? `Adds ${weekGain.toFixed(1)} to your lineup, replacing ${displacesName}`
        : `Adds ${weekGain.toFixed(1)} to your lineup by filling an empty slot`,
    );
  } else {
    parts.push("Does not crack your lineup this week");
  }

  if (tier === "championship") {
    parts.push(
      `projects among the best ${player.position}s left, so he still starts in the endgame`,
    );
  }

  if (player.injuryStatus) {
    parts.push(
      cannotPlay(player)
        ? `listed ${player.injuryStatus}, so he is priced for what he is worth after this week, not for Sunday`
        : `listed ${player.injuryStatus}`,
    );
  }
  if (player.byeWeek != null) parts.push(`bye week ${player.byeWeek}`);

  if (demand.rivals > 0) {
    if (demand.contested === 0) {
      parts.push("no surviving rival would start him, so expect to be alone on this one");
    } else if (demand.contested >= CONTESTED_AT) {
      parts.push(`${demand.contested} surviving rivals would start him, so expect company`);
    }
  }

  return parts.join(". ") + ".";
}

/**
 * Price one target.
 *
 * The market number is what the player costs; the gain and the posture decide
 * how much of that you are willing to pay. A green week deliberately bids well
 * under market, because losing a bid you did not need to win is free and the
 * bid still forces someone else to pay more.
 */
export function priceTarget(
  tier: Tier,
  weekGain: number,
  market: MarketModel,
  budget: BudgetPlan,
  posture: Posture,
  modifiers: { quality?: number; plays?: number; demand?: number } = {},
): { bid: number; walkAway: number; marketExpected: number } {
  const marketExpected = market.estimates[tier].expected;
  const valueFactor = Math.min(1.5, Math.max(0.5, weekGain / REFERENCE_GAIN));
  const quality = modifiers.quality ?? 1;
  const demand = modifiers.demand ?? 1;
  const plays = modifiers.plays ?? 1;

  // Urgency is a statement about needing help THIS Sunday, so it arrives in
  // proportion to the chance he is available on Sunday. Leaving it at full
  // strength made a red week outbid a green one for a player who was ruled
  // out, which is exactly backwards: the desperate team is the one that
  // cannot afford him. Switching it off entirely on a tag was the opposite
  // mistake, and cost a questionable starter his whole price.
  const injuredFloor = INJURED_DISCOUNT[posture];
  const confidence = injuredFloor + (1 - injuredFloor) * plays;
  const urgency = 1 + (URGENCY[posture] - 1) * plays;
  const raw = marketExpected * urgency * valueFactor * quality * confidence * demand;

  // The hold rule: thin weekly gain cannot justify a heavy bid, unless this is
  // an endgame piece bought in a week that is not about survival.
  //
  // Written as a rate rather than a threshold, because a threshold puts a cliff
  // in the middle of the decision: a player at 3.0 points of gain would have
  // been capped at a tenth of the budget and one at 3.1 would have been free to
  // take a fifth of it. Ten percent per three points, with a floor so a pure
  // speculation can still be bought at a speculative price.
  const endgameBuy = tier === "championship" && posture === "green";
  const valueCeiling =
    budget.originalBudget * THIN_GAIN_CAP_SHARE * Math.max(weekGain / THIN_GAIN, 0.2);
  const ceiling = endgameBuy
    ? budget.maxSingleBid
    : Math.min(budget.maxSingleBid, valueCeiling);

  const walkAway = Math.min(ceiling, Math.max(marketExpected, raw));
  const bid = unroundBid(Math.min(raw, ceiling), ceiling);

  return {
    bid: Math.max(1, bid),
    walkAway: Math.max(bid, Math.round(walkAway)),
    marketExpected,
  };
}

export function buildBidCard(input: RecommendInput): BidCard {
  const {
    myPlayers,
    candidates,
    rosterPositions,
    budget,
    market,
    posture,
    week,
    leaguePlayers,
  } = input;

  const bars = finalFourBars(leaguePlayers, rosterPositions);
  const rosterLineup = myPlayers.map((p) => asLineup(p));

  // Score every candidate on what he would actually add.
  const rivalBars = input.rivalStarterBars ?? [];

  const scored = candidates
    .map((player) => {
      const plays = playsProbability(player);
      const out = plays === 0;
      const { gain: rawGain, displaces, slot } = marginalValue(
        rosterLineup,
        asLineup(player),
        rosterPositions,
      );
      // What he adds, times the chance he is there to add it.
      //
      // This used to be a switch: ruled out meant zero. That was right about
      // the players who are actually out and wrong about everyone carrying a
      // tag nobody has cleared yet, and the wrongness was invisible, because a
      // zeroed gain drops a player off the card entirely rather than pricing
      // him low. A questionable starter is worth three quarters of a starter,
      // which is a number, not a disappearance.
      const gain = rawGain * plays;
      const displacedPlayer = displaces
        ? (myPlayers.find((p) => p.playerId === displaces.playerId) ?? null)
        : null;
      const tier = classify(player, gain, bars, week);
      const contested = contestedBy(player, rivalBars);
      const price = priceTarget(tier, gain, market, budget, posture, {
        quality: qualityFactor(player, bars),
        plays,
        demand: demandFactor(contested, rivalBars.length),
      });

      const target: BidTarget = {
        player,
        tier,
        weekGain: gain,
        displaces: displacedPlayer
          ? {
              playerId: displacedPlayer.playerId,
              name: displacedPlayer.name,
              points: displacedPlayer.weekPoints,
            }
          : null,
        slot,
        ...price,
        reason: reasonFor(player, tier, gain, displacedPlayer?.name ?? null, {
          contested,
          rivals: rivalBars.length,
        }),
      };
      return target;
    })
    // A stash that adds nothing and is not a top-32 player is not worth a line
    // on the card. There are always dozens of them and none of them matter.
    .filter((t) => t.weekGain > 0 || t.tier === "championship")
    .sort((a, b) => b.weekGain - a.weekGain || b.player.rosPoints - a.player.rosPoints);

  // Group into chains by the starter each target would push out, so every
  // alternative for the same hole sits in one chain and shares a drop. The
  // first version grouped by slot instead, and an RB and a WR who both
  // replaced the same weak flex became two chains that split the weekly cap
  // between them, so the top target got half the money it deserved.
  const byNeed = new Map<string, BidTarget[]>();
  for (const target of scored) {
    const key = target.displaces?.playerId ?? target.slot ?? target.player.position;
    const list = byNeed.get(key) ?? [];
    if (list.length < MAX_TARGETS_PER_CHAIN) list.push(target);
    byNeed.set(key, list);
  }

  // Drops come from the players who are not in your best lineup, worst first.
  // Each chain gets its own, so no two chains can fight over the same roster
  // spot and no chain can drop a starter.
  const lineup = bestLineup(rosterLineup, rosterPositions);
  const startingIds = new Set(
    lineup.slots.map((s) => s.player?.playerId).filter(Boolean) as string[],
  );
  const emptySlots = new Set(
    lineup.slots.filter((s) => s.player === null).map((s) => s.slot),
  );
  const droppable = myPlayers
    .filter((p) => !startingIds.has(p.playerId))
    .sort((a, b) => a.rosPoints - b.rosPoints);

  let chains: BidChain[] = [...byNeed.entries()]
    .sort((a, b) => (b[1][0]?.weekGain ?? 0) - (a[1][0]?.weekGain ?? 0))
    .slice(0, MAX_CHAINS)
    .map(([, targets], index) => {
      const drop = droppable[index] ?? null;
      return {
        need: needLabel(targets, emptySlots),
        drop: drop ? { playerId: drop.playerId, name: drop.name } : null,
        targets,
      };
    });

  // Worst case is one win per chain, since a chain cannot win twice.
  const worstCase = (list: BidChain[]) =>
    list.reduce((sum, chain) => sum + Math.max(0, ...chain.targets.map((t) => t.bid)), 0);

  let maxPossibleSpend = worstCase(chains);

  // If the worst case breaches the week's cap, scale every bid down rather than
  // silently dropping a chain: the shape of the plan is right, the prices are
  // just too rich for the budget. Rounding is down, because a card whose worst
  // case is a dollar over the cap is a card that broke its own rule.
  if (maxPossibleSpend > budget.weeklyCap && maxPossibleSpend > 0) {
    const scale = budget.weeklyCap / maxPossibleSpend;
    for (const chain of chains) {
      for (const target of chain.targets) {
        target.bid = Math.max(1, Math.floor(target.bid * scale));
        target.walkAway = Math.max(target.bid, Math.floor(target.walkAway * scale));
      }
    }
    maxPossibleSpend = worstCase(chains);

    // Every bid has a $1 floor, so a small enough cap cannot fit three chains
    // however hard it scales. Then the honest move is to fund the best hole
    // properly and say nothing about the others, rather than to put three
    // one-dollar claims on the card and call it a plan.
    while (chains.length > 1 && maxPossibleSpend > budget.weeklyCap) {
      chains = chains.slice(0, -1);
      maxPossibleSpend = worstCase(chains);
    }
  }

  // Sleeper processes claims by bid amount, highest first, and offers no other
  // way to order your own claims, so the card has to be sorted by bid to mean
  // anything. It used to be sorted by this week's gain alone, which held while
  // every target was priced off that gain. Now that a hurt player keeps his
  // price through the endgame tier while losing his Sunday, the two orders can
  // disagree, and the one that matters is the money.
  for (const chain of chains) {
    chain.targets.sort(
      (a, b) => b.bid - a.bid || b.weekGain - a.weekGain || b.player.rosPoints - a.player.rosPoints,
    );
  }

  for (const chain of chains) {
    for (let i = 1; i < chain.targets.length; i++) {
      const prev = chain.targets[i - 1];
      const cur = chain.targets[i];
      if (cur.bid > prev.bid) cur.bid = prev.bid;
      if (cur.walkAway > prev.walkAway) cur.walkAway = prev.walkAway;
      if (cur.walkAway < cur.bid) cur.walkAway = cur.bid;
    }
  }
  maxPossibleSpend = worstCase(chains);

  const sitOut = chains.length === 0 || budget.weeklyCap < 1;

  // Two chains can both plan to replace the same starter, because each target
  // is priced against the lineup as it stands today. Their drops differ, so
  // there is no roster collision and both claims are legal, but their gains do
  // not simply add: the second one is replacing a player the first already
  // replaced. Saying so is cheaper and more honest than pretending otherwise.
  const displaced = chains
    .map((c) => c.targets[0]?.displaces?.name)
    .filter((n): n is string => Boolean(n));
  const doubleCounted = displaced.filter((n, i) => displaced.indexOf(n) !== i);

  return {
    chains,
    maxPossibleSpend,
    weeklyCap: budget.weeklyCap,
    sitOut,
    summary: summarize(chains, sitOut, maxPossibleSpend, posture),
    sharedDisplacement: [...new Set(doubleCounted)],
  };
}

function needLabel(targets: BidTarget[], emptySlots: Set<string>): string {
  const top = targets[0];
  if (!top) return "";
  const slotOrPosition = top.slot ?? top.player.position;
  if (top.displaces) {
    // A chain can hold an RB and a WR who both replace the same flex starter,
    // so name the hole by who leaves rather than by one position.
    const positions = [...new Set(targets.map((t) => t.player.position))];
    const who = positions.length === 1 ? positions[0] : positions.join("/");
    return `${who} over ${top.displaces.name} (${top.displaces.points.toFixed(1)})`;
  }
  // "Currently empty" used to be the catch-all here, which quietly lied: a
  // player who simply does not crack the lineup was announced as filling a hole
  // that did not exist. An empty slot is a specific, checkable thing.
  if (emptySlots.has(slotOrPosition)) return `${slotOrPosition}, currently empty`;
  return `${slotOrPosition} depth, does not start today`;
}

function summarize(
  chains: BidChain[],
  sitOut: boolean,
  maxSpend: number,
  posture: Posture,
): string {
  if (sitOut) {
    return posture === "green"
      ? "Nothing available improves your starting lineup enough to be worth real money. Sit this run out."
      : "No claim on the board clears the bar this week. Hold.";
  }

  const top = chains[0]?.targets[0];
  const count = `${chains.length} ${chains.length === 1 ? "chain" : "chains"}, at most $${maxSpend} if every claim lands.`;
  if (!top) return `${count} See the chains below.`;

  // A bid well under the market number is a price-enforcing bid: it exists to
  // make the winner pay more, and it will almost certainly lose. The summary
  // used to call that "the one that matters", which read as a plan to land
  // the player. Saying it will lose is the honest version.
  if (top.bid < top.marketExpected * PRICE_ENFORCEMENT_RATIO) {
    return `${count} ${top.player.name} at $${top.bid} will almost certainly lose against a market near $${Math.round(top.marketExpected)}. That is the point of a ${posture} week: make the winner pay, keep your money. ${TIER_MEANING[top.tier]}`;
  }

  return `${count} ${top.player.name} at $${top.bid} is the one that matters. ${TIER_MEANING[top.tier]}`;
}
