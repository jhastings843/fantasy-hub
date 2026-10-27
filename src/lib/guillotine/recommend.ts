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
import { roomFactor } from "./learn";
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

/** Two players this close do the same job for the same bidder. */
const COMPARABLE_WITHIN = 2;

/**
 * Depth is a dollar when the pool can replace him.
 *
 * A player who does not crack your lineup this week is insurance, and in a
 * guillotine room insurance gets cheaper every week: each chop dumps another
 * roster onto waivers while there is one fewer team to start anybody. Week 7
 * priced Hurts, Daniels and Burrow at $17 to $19 as quarterback depth, in a
 * room where quarterbacks went for $1, $5 and $1 in weeks 4 to 6 and nobody
 * alive would start two of them. When another free player at his position
 * projects within this share of his season rate, the depth bid is the minimum.
 */
const DEPTH_REPLACEABLE_SHARE = 0.9;

/**
 * What a bid adds on top of the market price to actually win it.
 *
 * The research is blunt about this: the ideal win is a dollar over second
 * place, not a hundred over. The premium is for being sure in a week that
 * could end you, not for the pleasure of paying more.
 */
const EDGE: Record<Posture, number> = { red: 1.15, yellow: 1.08, green: 1 };

/** Points a rival's lineup has to gain before he is a real bidder for a player. */
const RIVAL_NEED_GAIN = 2;

/** Never show more than this many chains; a longer card is not a plan. */
const MAX_CHAINS = 3;

/** Fallbacks per chain, so a lost claim still lands something. */
const MAX_TARGETS_PER_CHAIN = 4;

/**
 * Starters from one NFL team, at most. A third makes one bad real game (a
 * blowout, a backup QB, weather) sink three slots at once, and in a format
 * where one low week ends the season that is the risk the sources rank eighth
 * of the ten ways people get chopped. Week 8 offered Wan'Dale Robinson (TEN)
 * to a lineup already starting Carnell Tate and Tony Pollard (TEN).
 */
export const STACK_LIMIT = 2;

/** Sleeper's smallest legal bid in every league Jack plays. */
const MIN_BID = 1;

/** Rest-of-season rate below this share of the week marks a one-week fill-in. */
const FILL_IN_SHARE = 0.5;

export interface RecommendInput {
  myPlayers: PoolPlayer[];
  /**
   * Players in the IR slot. Dropping one frees the IR slot, not a roster
   * spot, so a claim still needs a drop from the active roster.
   */
  reserveIds?: string[];
  /**
   * League roster caps by position that Sleeper doesn't store (Dah Chopped:
   * two quarterbacks). At the cap, a claim at that position must drop one.
   */
  positionCaps?: Record<string, number>;
  candidates: PoolPlayer[];
  rosterPositions: string[];
  budget: BudgetPlan;
  market: MarketModel;
  posture: Posture;
  week: number;
  /** Every player rostered anywhere in the league, for the positional bars. */
  leaguePlayers: { position: string; rosPoints: number }[];
  /**
   * One entry per surviving rival: what they are starting at each position and
   * what they have left to spend. A player who beats their weakest starter is
   * somebody they would start, and a rival with no money is not a bidder
   * whatever he needs.
   *
   * Optional because a caller that cannot see the other rosters should get a
   * card priced on the market alone rather than one priced as if nobody else
   * wanted anybody.
   */
  rivals?: { name: string; faabLeft: number; bars: Record<string, number>; aggression?: number }[];
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

/** Names the rival whose bidding habit moved the price, when one did. */
function roomNote(contested: string[], rivals: { name: string; aggression?: number }[]): string {
  const hot = rivals
    .filter((r) => contested.includes(r.name) && (r.aggression ?? 1) >= 1.1)
    .sort((a, b) => (b.aggression ?? 1) - (a.aggression ?? 1))[0];
  if (hot) return ` ${hot.name} wants him and pushes harder than the toughest bidder in a typical auction here, so the bid is up to match.`;
  const cold = rivals.filter((r) => contested.includes(r.name));
  if (cold.length && cold.every((r) => (r.aggression ?? 1) <= 0.9)) return " The rivals who want him bid softer than the toughest bidder in a typical auction here, so the bid is down to match.";
  return "";
}

/** Surviving rivals who would start this player AND can afford to chase him. */
export function contestedBy(
  player: PoolPlayer,
  rivals: { name: string; faabLeft: number; bars: Record<string, number> }[],
  minimumBid = 0,
): string[] {
  return rivals
    .filter((r) => {
      const theirs = r.bars[player.position];
      if (theirs == null) return false;
      if (r.faabLeft < minimumBid) return false;
      return player.weekPoints - theirs >= RIVAL_NEED_GAIN;
    })
    .map((r) => r.name);
}

/**
 * How many other players would do the same job for the same bidders.
 *
 * This is the piece that was missing, and it is most of the answer. Week 3 put
 * four startable quarterbacks on the board within 1.6 points of each other,
 * against two teams that needed one, and the model priced the best of them at
 * twice what this room has ever paid for a multiweek starter. Demand without
 * supply is not a market.
 */
export function comparableSupply(player: PoolPlayer, candidates: PoolPlayer[]): number {
  return candidates.filter(
    (c) =>
      c.position === player.position &&
      Math.abs(c.weekPoints - player.weekPoints) <= COMPARABLE_WITHIN,
  ).length;
}

/** Another free player at his position whose season rate is nearly as good. */
export function hasFreeReplacement(player: PoolPlayer, candidates: PoolPlayer[]): boolean {
  return candidates.some(
    (c) =>
      c.playerId !== player.playerId &&
      c.position === player.position &&
      c.rosPoints >= player.rosPoints * DEPTH_REPLACEABLE_SHARE,
  );
}

/**
 * What competition does to the price, as bidders per comparable player.
 *
 * Nobody wanting him is cheap. Three teams chasing the only player who fixes
 * their week is expensive. Two teams and four interchangeable players is the
 * ordinary case and prices near what the room usually pays.
 */
export function demandPressure(contested: number, supply: number, rivalsKnown: boolean): number {
  if (!rivalsKnown) return DEMAND_FACTOR.normal;
  if (contested === 0) return DEMAND_FACTOR.uncontested;
  const perPlayer = contested / Math.max(1, supply);
  return Math.min(
    DEMAND_FACTOR.contested,
    Math.max(DEMAND_FACTOR.uncontested, 0.8 + 0.5 * perPlayer),
  );
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
  demand: { contested: string[]; supply: number; rivalsKnown: boolean } = {
    contested: [],
    supply: 0,
    rivalsKnown: false,
  },
): string {
  const parts: string[] = [];

  if (player.fromChoppedRoster) parts.push("Off this week's chopped roster");

  // The gain itself is on the card line above the reason ("Adds 6.1 to your
  // lineup over X"), so only the no-gain case is said here.
  if (weekGain <= 0) parts.push("Does not crack your lineup this week");

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

  // Who else is bidding, and what else they could buy instead. Both halves
  // matter: one rival chasing the only player who fixes his week is a different
  // auction from one rival looking at four interchangeable ones.
  if (demand.rivalsKnown) {
    const others = Math.max(0, demand.supply - 1);
    if (demand.contested.length === 0) {
      parts.push("no surviving rival would start him, so expect to be alone on this one");
    } else {
      const who =
        demand.contested.length <= 2
          ? demand.contested.join(" and ")
          : `${demand.contested.length} rivals`;
      parts.push(
        others > 0
          ? `${who} would start him, with ${others} comparable ${others === 1 ? "player" : "players"} also available`
          : `${who} would start him, and there is nobody comparable left`,
      );
    }
  }

  return sentences(parts);
}

/**
 * Bring a card's worst case (one win per chain) back under the week's cap
 * without breaking the strict bid order inside a chain. Dollars come off a
 * chain's top bid where it has room over its own fallback, last chain first;
 * the last chain is dropped only when no top bid can give.
 */
export function fitUnderCap(chains: BidChain[], cap: number): BidChain[] {
  const worst = (list: BidChain[]) =>
    list.reduce((sum, c) => sum + Math.max(0, ...c.targets.map((t) => t.bid)), 0);
  let out = chains;
  while (worst(out) > cap && out.length > 0) {
    const giver = [...out].reverse().find((c) => {
      const [top, next] = c.targets;
      return top && top.bid > (next ? next.bid + 1 : MIN_BID);
    });
    if (giver) {
      const top = giver.targets[0];
      top.bid -= 1;
      if (top.walkAway < top.bid) top.walkAway = top.bid;
    } else if (out.length > 1) {
      out = out.slice(0, -1);
    } else {
      break;
    }
  }
  return out;
}

function ordinalSuffix(n: number): string {
  return n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
}

/**
 * Join clauses into sentences. Each clause is capitalised, and a clause that
 * already ends in a period (a name like "Harold Fannin Jr.") does not get a
 * second one: the week 8 email printed "Fannin Jr.. projects among".
 */
export function sentences(parts: string[]): string {
  return parts
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => p[0].toUpperCase() + p.slice(1))
    .map((p) => (/[.!?]$/.test(p) ? p : p + "."))
    .join(" ");
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
  const pressure = modifiers.demand ?? 1;
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

  // Two different numbers, and bidding the wrong one is what made a $56 room
  // pay $106 for a quarterback.
  //
  // What he is WORTH to this roster is the market price bent by urgency, by
  // what he adds, by how good he is and by whether he will play. That is a
  // ceiling: the point past which winning is a loss.
  //
  // What it TAKES to win him is the market price bent by how many rivals want
  // him and how many other players would do the same job, plus an edge. That
  // is the bid. The model used to bid its ceiling on everything, which wins
  // every auction and overpays in all of them.
  const worthToMe = marketExpected * urgency * valueFactor * quality * confidence;
  const takesToWin = marketExpected * pressure * EDGE[posture];

  // The hold rule: thin weekly gain cannot justify a heavy bid, unless this is
  // an endgame piece bought in a week that is not about survival.
  //
  // Written as a rate rather than a threshold, because a threshold puts a cliff
  // in the middle of the decision: a player at 3.0 points of gain would have
  // been capped at a tenth of the budget and one at 3.1 would have been free to
  // take a fifth of it. Ten percent per three points, with a floor so a pure
  // speculation can still be bought at a speculative price.
  const endgameBuy = tier === "championship" && posture === "green";
  const holdRuleCeiling =
    budget.originalBudget * THIN_GAIN_CAP_SHARE * Math.max(weekGain / THIN_GAIN, 0.2);
  const ceiling = endgameBuy
    ? budget.maxSingleBid
    : Math.min(budget.maxSingleBid, holdRuleCeiling);

  // Never bid past what he is worth, even when the market says it would take
  // more. That is the sit-out rule: if the price to win exceeds the value, the
  // right play is losing the auction.
  const maxWilling = Math.max(1, Math.min(ceiling, worthToMe));
  const walkAway = Math.min(ceiling, Math.max(marketExpected, worthToMe));
  const bid = unroundBid(Math.min(takesToWin, maxWilling), maxWilling);

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
  const rivals = input.rivals ?? [];

  // Competition per target, kept for the chain ladder below.
  const competition = new Map<string, { contested: number; supply: number }>();

  // NFL teams already in your best lineup, for the stack limit.
  const startersByTeam = new Map<string, PoolPlayer[]>();
  for (const s of bestLineup(rosterLineup, rosterPositions).slots) {
    const p = s.player ? myPlayers.find((m) => m.playerId === s.player!.playerId) : undefined;
    if (p?.team) startersByTeam.set(p.team, [...(startersByTeam.get(p.team) ?? []), p]);
  }

  const scored = candidates
    .map((player) => {
      const plays = playsProbability(player);
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
      // Only rivals who could actually pay the going rate count as bidders.
      const contested = contestedBy(player, rivals, market.estimates[tier].expected);
      const supply = comparableSupply(player, candidates);
      competition.set(player.playerId, { contested: contested.length, supply });
      const priced = priceTarget(tier, gain, market, budget, posture, {
        quality: qualityFactor(player, bars),
        plays,
        // The rivals who want him, priced by how they have actually bid this
        // season (learn.ts), not as an average room.
        demand:
          demandPressure(contested.length, supply, rivals.length > 0) *
          roomFactor(contested, new Map(rivals.map((r) => [r.name, r.aggression ?? 1]))),
      });
      const replaceable = gain <= 0 && hasFreeReplacement(player, candidates);
      const price = replaceable ? { ...priced, bid: MIN_BID, walkAway: MIN_BID } : priced;

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
        reason:
          reasonFor(player, tier, gain, displacedPlayer?.name ?? null, {
            contested,
            supply,
            rivalsKnown: rivals.length > 0,
          }) +
          roomNote(contested, rivals) +
          (replaceable
            ? ` Depth only: another ${player.position} about as good is still free, and every chop adds more, so this is a minimum bid.`
            : ""),
      };
      // The stack limit. A weekly piece that would be a third starter from one
      // team leaves the card; an endgame piece stays, with the stack named, since
      // his value is the final four and the lineup will change by then.
      const sameTeam = (player.team ? (startersByTeam.get(player.team) ?? []) : []).filter(
        (p) => p.playerId !== target.displaces?.playerId,
      );
      if (sameTeam.length >= STACK_LIMIT) {
        if (tier !== "championship") return null;
        const nth = sameTeam.length + 1;
        const with_ = sameTeam.map((p) => p.name).join(" and ");
        target.reason += ` Would be your ${nth}${ordinalSuffix(nth)} ${player.team} starter with ${with_}, so one bad ${player.team} game hits all of them.`;
      }
      return target;
    })
    .filter((t): t is BidTarget => t !== null)
    // A stash that adds nothing and is not a top-32 player is not worth a line
    // on the card. There are always dozens of them and none of them matter.
    .filter((t) => t.weekGain > 0 || t.tier === "championship")
    .sort((a, b) => b.weekGain - a.weekGain || b.player.rosPoints - a.player.rosPoints);

  // Group into chains by the starter each target would push out, so every
  // alternative for the same hole sits in one chain and shares a drop. The
  // first version grouped by slot instead, and an RB and a WR who both
  // replaced the same weak flex became two chains that split the weekly cap
  // between them, so the top target got half the money it deserved.
  //
  // One-week fill-ins queue behind everyone who will still be starting after
  // Sunday. Week 3 filled the last quarterback spot with Drew Lock, 16.8 that
  // week and nothing after, and left Malik Willis off the card: QB15 on his
  // list, 15.0 a game for the season, and unclaimed. A fill-in still makes a
  // chain when there are not four real options for the hole.
  const byNeed = new Map<string, BidTarget[]>();
  const queue = [
    ...scored.filter((t) => !isFillIn(t.player)),
    ...scored.filter((t) => isFillIn(t.player)),
  ];
  for (const target of queue) {
    const key = target.displaces?.playerId ?? target.slot ?? target.player.position;
    const list = byNeed.get(key) ?? [];
    if (list.length < MAX_TARGETS_PER_CHAIN) list.push(target);
    byNeed.set(key, list);
  }

  // Drops come from the players who are not in your best lineup OVER THE
  // SEASON, worst first, plus the starter a chain replaces. Each chain gets its
  // own, so no two chains fight over one roster spot.
  //
  // This used to be "not starting this week", which made byes decide the
  // drops: week 8 put Kittle, Likely and Nabers on the bench (SF and NYG off)
  // and offered Kittle up while Fannin and Boston, the two weakest players on
  // the roster for the season and the very starters the chains replace, were
  // protected for starting one Sunday.
  const lineup = bestLineup(rosterLineup, rosterPositions);
  const seasonLineup = bestLineup(myPlayers.map((p) => asLineup(p, true)), rosterPositions);
  const seasonStarterIds = new Set(
    seasonLineup.slots.map((s) => s.player?.playerId).filter(Boolean) as string[],
  );
  const startingIds = new Set(
    lineup.slots.map((s) => s.player?.playerId).filter(Boolean) as string[],
  );
  const emptySlots = new Set(
    lineup.slots.filter((s) => s.player === null).map((s) => s.slot),
  );
  // An IR player can't be the drop: it frees the IR slot, not a roster spot.
  const reserve = new Set(input.reserveIds ?? []);
  const droppable = myPlayers
    .filter((p) => !seasonStarterIds.has(p.playerId) && !reserve.has(p.playerId))
    .sort((a, b) => a.rosPoints - b.rosPoints);
  // Dropping someone who starts THIS week costs this week's points, unless he
  // is the starter the chain's claim replaces.
  const canDrop = (p: PoolPlayer, targets: BidTarget[]) =>
    !startingIds.has(p.playerId) || targets.some((t) => t.displaces?.playerId === p.playerId);

  // At a position cap (two QBs), a claim there must drop that position, and
  // other chains must leave that drop alone. Capped chains pick first.
  const caps = input.positionCaps ?? {};
  const atCap = (pos: string) =>
    caps[pos] !== undefined && myPlayers.filter((p) => p.position === pos && !reserve.has(p.playerId)).length >= caps[pos];
  const cappedPos = (targets: BidTarget[]) => {
    const pos = targets[0]?.player.position;
    return pos && atCap(pos) ? pos : null;
  };
  const picked = [...byNeed.entries()]
    .sort((a, b) => (b[1][0]?.weekGain ?? 0) - (a[1][0]?.weekGain ?? 0))
    .slice(0, MAX_CHAINS)
    .map(([, targets]) => targets);
  const used = new Set<string>();
  const dropFor = new Map<BidTarget[], PoolPlayer | null>();
  for (const targets of [...picked.filter((x) => cappedPos(x)), ...picked.filter((x) => !cappedPos(x))]) {
    const pos = cappedPos(targets);
    const drop =
      droppable.find((p) => !used.has(p.playerId) && (!pos || p.position === pos) && canDrop(p, targets)) ?? null;
    if (drop) used.add(drop.playerId);
    dropFor.set(targets, drop);
  }

  let chains: BidChain[] = picked
    // A capped claim with nobody at that position to drop can't be made.
    .filter((targets) => !(cappedPos(targets) && !dropFor.get(targets)))
    .map((targets) => {
      const drop = dropFor.get(targets) ?? null;
      // Season, not week: a claim has to be worth more for the rest of the
      // season than the player it drops. Week 8 offered Isaiah Likely as a drop
      // because NYG was on bye, for band-aids worth less than him every week
      // after. Only a red week, where Sunday is the whole season, may trade
      // down.
      const worthIt = targets.filter(
        (t) => !drop || posture === "red" || t.player.rosPoints >= drop.rosPoints,
      );
      return {
        need: needLabel(worthIt, emptySlots),
        drop: drop ? { playerId: drop.playerId, name: drop.name } : null,
        targets: worthIt,
      };
    })
    .filter((c) => c.targets.length > 0);

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
    ladderChain(chain.targets, competition, rivals.length > 0);
    strictlyDescending(chain.targets);
  }
  maxPossibleSpend = worstCase(chains);

  // Laddering and the strict order can lift bids after the cap was enforced
  // above (week 8: $69 worst case against a $68 ceiling).
  chains = fitUnderCap(chains, budget.weeklyCap);
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

/**
 * A player projected for this week and not much after it: a backup starting
 * one game, a return man covering one injury. Half is deliberately loose, so a
 * starter with a good matchup (15 this week, 12 a game for the season) is not
 * one.
 */
export function isFillIn(player: PoolPlayer): boolean {
  return player.weekPoints > 0 && player.rosPoints < player.weekPoints * FILL_IN_SHARE;
}

/**
 * Price each fallback in a chain against the next one down, not the field.
 *
 * Week 3 put four quarterbacks on the card within 1.4 points of each other and
 * priced every one of them near $58, as if each had to be won against every
 * rival. But the third choice is only ever reached after losing the first two,
 * and what it buys over the fourth is the gap between them: Bo Nix won at $58
 * for 0.3 points over Drew Lock, and Lock went unclaimed and was a free pickup
 * the next morning.
 *
 * So when the bottom of a chain is in surplus (more comparable players than
 * rivals who would start one), someone is left over and the floor is the
 * minimum bid. Each claim above it pays for its gain over the one below, at the
 * rate its own price implies, and never more than it was priced at alone. The
 * ladder only climbs between players who are comparable for the rest of the
 * season too; the first real step up in rest-of-season value ends it.
 *
 * Championship targets are left alone. Their price is about the endgame, and a
 * weekly gap says nothing about that.
 */
export function ladderChain(
  targets: BidTarget[],
  competition: Map<string, { contested: number; supply: number }>,
  rivalsKnown: boolean,
): void {
  if (!rivalsKnown || targets.length === 0) return;
  // The ladder runs over the weekly tail of the chain only.
  let start = targets.length;
  while (start > 0 && targets[start - 1].tier !== "championship") start--;
  const tail = targets.slice(start);
  if (tail.length === 0) return;

  const bottom = tail[tail.length - 1];
  const c = competition.get(bottom.player.playerId);
  if (!c || c.supply <= c.contested) return;

  bottom.bid = MIN_BID;
  for (let i = tail.length - 2; i >= 0; i--) {
    const cur = tail[i];
    const next = tail[i + 1];
    // A one-week fill-in is not a fallback for a season-long starter. Drew
    // Lock projected 0.3 behind Nix for week 3 and zero for the rest of the
    // season, so the step from Lock up to Nix is buying a starter, not a
    // third of a point. Everything from here up keeps its own price.
    if (Math.abs(cur.player.rosPoints - next.player.rosPoints) > COMPARABLE_WITHIN) break;
    // A starter bought for several weeks is worth his edge over the fallback
    // in every one of them, so the step counts whichever gap is larger.
    const gap = Math.max(
      0,
      cur.weekGain - next.weekGain,
      cur.player.rosPoints - next.player.rosPoints,
    );
    const premium = cur.weekGain > 0 ? (cur.bid * gap) / cur.weekGain : 0;
    cur.bid = Math.min(cur.bid, next.bid + Math.max(1, Math.round(premium)));
  }
}

/**
 * No two claims in a chain at the same price.
 *
 * Sleeper runs your claims highest bid first and breaks a tie its own way. In
 * week 3 Kyler Murray and Bo Nix were both $58, Sleeper ran Nix first, Nix took
 * the drop, and Kyler failed with nothing left to drop. The card's order only
 * means something if the money says it.
 */
export function strictlyDescending(targets: BidTarget[]): void {
  for (let i = 1; i < targets.length; i++) {
    const prev = targets[i - 1];
    const cur = targets[i];
    if (cur.bid >= prev.bid) cur.bid = prev.bid - 1;
  }
  // A $1 floor can leave no room below; lift from the bottom instead.
  for (let i = targets.length - 1; i >= 0; i--) {
    const floor = i === targets.length - 1 ? MIN_BID : targets[i + 1].bid + 1;
    if (targets[i].bid < floor) targets[i].bid = floor;
  }
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    if (i > 0 && t.walkAway > targets[i - 1].walkAway) t.walkAway = targets[i - 1].walkAway;
    if (t.walkAway < t.bid) t.walkAway = t.bid;
  }
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
