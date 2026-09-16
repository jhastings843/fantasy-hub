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
}

const asLineup = (p: PoolPlayer, useRos = false): LineupPlayer => ({
  playerId: p.playerId,
  position: p.position,
  points: useRos ? p.rosPoints : p.weekPoints,
});

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

  if (player.injuryStatus) parts.push(`listed ${player.injuryStatus}`);
  if (player.byeWeek != null) parts.push(`bye week ${player.byeWeek}`);

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
): { bid: number; walkAway: number; marketExpected: number } {
  const marketExpected = market.estimates[tier].expected;
  const valueFactor = Math.min(1.5, Math.max(0.5, weekGain / REFERENCE_GAIN));
  const raw = marketExpected * URGENCY[posture] * valueFactor;

  const walkAway = Math.min(budget.maxSingleBid, Math.max(marketExpected, raw));
  const bid = unroundBid(Math.min(raw, budget.maxSingleBid), budget.maxSingleBid);

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
  const scored = candidates
    .map((player) => {
      const { gain, displaces, slot } = marginalValue(
        rosterLineup,
        asLineup(player),
        rosterPositions,
      );
      const displacedPlayer = displaces
        ? (myPlayers.find((p) => p.playerId === displaces.playerId) ?? null)
        : null;
      const tier = classify(player, gain, bars, week);
      const price = priceTarget(tier, gain, market, budget, posture);

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
        reason: reasonFor(player, tier, gain, displacedPlayer?.name ?? null),
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

  // Sleeper processes claims by bid amount, highest first, and offers no
  // other way to order your own claims. So a fallback that outbids the target
  // ahead of it is processed first and wins first. Bids must not rise down a
  // chain, or the order on the card is not the order Sleeper runs.
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
