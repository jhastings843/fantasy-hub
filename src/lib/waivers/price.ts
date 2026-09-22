// What a waiver claim should cost, in the leagues where money comes back.
//
// The guillotine advisor prices a claim against elimination. These leagues
// have no such clock: FAAB resets next season, the playoffs are the deadline,
// and the only question is whether the player is worth more to your lineup
// than the room will make you pay. The numbers here come from
// docs/faab-strategy.md, which records the sources and where they disagree.
//
// Two ideas carry the module. A claim is priced on what the player adds to
// your starting lineup, not on his projection. And the bid is the lower of
// the market's number and your value ceiling: when the room will pay more
// than he is worth to you, you bid your ceiling and expect to lose.

import { startersByPosition } from "@/lib/guillotine/recommend";
import { unroundBid } from "@/lib/guillotine/market";
import type { Trajectory } from "@/lib/dynasty/season-plan";

export type ClaimTier = "winner" | "starter" | "multiweek" | "streamer" | "filler" | "stash";

export const TIER_LABEL: Record<ClaimTier, string> = {
  winner: "League winner",
  starter: "Every-week starter",
  multiweek: "Multiweek starter",
  streamer: "Streamer",
  filler: "Bye or injury filler",
  stash: "Stash",
};

const TIER_MEANING: Record<ClaimTier, string> = {
  winner: "Ranked among the best at his position for the rest of the year.",
  starter: "Ranked inside what this league starts at his position.",
  multiweek: "Cracks your lineup now, but not a season-long starter by rank.",
  streamer: "A one-week play at a position nobody pays for.",
  filler: "Enters your lineup this week by a small margin.",
  stash: "Does not start for you today. Worth a bench spot, not real money.",
};

/**
 * Prior prices as a share of the original budget, by tier and format. Redraft
 * from FantasyPros and RotoBaller ranges on $100; dynasty from the Dynasty
 * Trade Generator guide on $1000, discounted because the empirical dynasty
 * market clears far cheaper than the guides suggest (71% of adds under 2.5%).
 */
const PRIOR: Record<"redraft" | "dynasty", Record<ClaimTier, number>> = {
  redraft: { winner: 0.5, starter: 0.25, multiweek: 0.15, streamer: 0.05, filler: 0.02, stash: 0.01 },
  dynasty: { winner: 0.3, starter: 0.1, multiweek: 0.06, streamer: 0.005, filler: 0.01, stash: 0.01 },
};

/** A young player in dynasty carries future value on top of this season's. */
const YOUNG_AGE = 25;

/** Below this many points of lineup gain a player is a filler, not a starter. */
const STARTER_GAIN = 2;

/** A gain this size or more is a full-need target. */
const BIG_GAIN = 5;

/** Weight of the published prior against observed winning bids, in bids. */
const PRIOR_WEIGHT = 3;

/** Sleeper's trending-adds list: rank 1 is the hottest claim of the day. */
const HEAT_RANKS = 25;
const HEAT_MAX = 0.6;

/**
 * Snaps that mark a real role. The sources put the line at 60% for a back
 * and 70% for a receiver; 35 of a typical 60-play game is the round number
 * that covers both without pretending to precision the feed does not have.
 */
const ROLE_SNAPS = 35;

/** Positions a one-QB league treats as streamers. */
const STREAMER_POSITIONS = new Set(["K", "DEF"]);

/**
 * A kicker or defense is a streamer nobody pays for: the sources put it at
 * $0 to $1 on $100 with $2 as the ceiling. A QB or TE streamer at a weak
 * slot is worth the full streamer prior.
 */
const KICKER_DEFENSE_PRIOR = 0.01;

/** How a claim enters this week's lineup, for the explanation. */
export interface WeekSlot {
  slot: string;
  /** The starter he pushes out, or null when the slot was empty. */
  over: string | null;
  /** The displaced starter's rank and his, in whichever ranking the solver used. */
  from: number | null;
  to: number | null;
}

export interface ClaimCandidate {
  playerId: string;
  position: string;
  age: number | null;
  /** "WR54" parsed to 54, when he is on the season list. */
  seasonPositionRank: number | null;
  /**
   * Projected points he adds to this week's best lineup, from the weekly
   * projection feed. Null when the feed has no number for him or for the man
   * he displaces: a gain nobody measured is not a gain of zero, and it is not
   * a rank gap dressed as points either.
   */
  weekGain: number | null;
  /** He cracks this week's best lineup by rank, whatever the projections say. */
  startsThisWeek: boolean;
  weekSlot?: WeekSlot | null;
  /** Offensive snaps last week, when known. A role shows up here before it shows up in a ranking. */
  lastWeekSnaps?: number | null;
  /** The web consensus tier and bid percent, when this week's research named him. */
  researchTier?: ClaimTier | null;
  researchPercent?: number | null;
  /** His waiver post's bid on this player, as a percent of the budget. */
  jinglesPercent?: number | null;
}

export interface ObservedClaim {
  tier: ClaimTier;
  amount: number;
}

export interface PricingContext {
  type: "redraft" | "dynasty";
  budget: number;
  remaining: number;
  week: number;
  teams: number;
  rosterPositions: string[];
  record: { wins: number; losses: number } | null;
  /** Dynasty only. Null in redraft or when grades are unavailable. */
  trajectory: Trajectory | null;
  observed: ObservedClaim[];
  /** Trending-adds rank per player id, 1 = hottest. Absent means not trending. */
  trending: Map<string, number>;
  /** Starting slots your best lineup cannot fill this week. */
  emptySlots: number;
}

export interface ClaimPrice {
  tier: ClaimTier;
  tierLabel: string;
  /** Submit this. */
  bid: number;
  /** Never go past this. */
  walkAway: number;
  /** What the room is expected to pay. */
  marketExpected: number;
  /** True when the market is above his value to you: bid the ceiling, expect to lose. */
  longShot: boolean;
  reason: string;
}

export function parsePositionRank(label: string | null): number | null {
  if (!label) return null;
  const m = /(\d+)\s*$/.exec(label);
  return m ? Number(m[1]) : null;
}

function isSuperflex(rosterPositions: string[]): boolean {
  return rosterPositions.includes("SUPER_FLEX");
}

/**
 * How many at this position the whole league starts. Flex slots are shared
 * across their eligible positions, the same way the guillotine bars are.
 */
function starterBar(position: string, ctx: PricingContext): number {
  const perTeam = startersByPosition(ctx.rosterPositions)[position] ?? 0;
  return Math.max(1, Math.round(perTeam * ctx.teams));
}

const TIER_ORDER: ClaimTier[] = ["winner", "starter", "multiweek", "streamer", "filler", "stash"];

/** The stronger of two tiers, so a consensus call can lift but never lower one. */
function strongerTier(a: ClaimTier, b: ClaimTier | null | undefined): ClaimTier {
  if (!b) return a;
  return TIER_ORDER.indexOf(b) < TIER_ORDER.indexOf(a) ? b : a;
}

function isStreamerPosition(c: ClaimCandidate, ctx: PricingContext): boolean {
  return STREAMER_POSITIONS.has(c.position) || (c.position === "QB" && !isSuperflex(ctx.rosterPositions));
}

export function classifyClaim(c: ClaimCandidate, ctx: PricingContext): ClaimTier {
  const own = classifyOwn(c, ctx);
  // A streamer position stays a streamer whatever a column calls him: in a
  // one-QB league the room does not pay starter money for a quarterback,
  // and the columns that rate him one are written for deeper formats.
  if (isStreamerPosition(c, ctx)) return own;
  // Otherwise the research is this week's opinion and the season list may
  // not be; when the consensus rates a player higher than the rank does,
  // the consensus wins. It never lowers a tier the lineup math earned.
  return strongerTier(own, c.researchTier);
}

/** He enters this week's lineup, by measured points or by the solver's rank. */
function starts(c: ClaimCandidate): boolean {
  return c.startsThisWeek || (c.weekGain ?? 0) > 0;
}

function classifyOwn(c: ClaimCandidate, ctx: PricingContext): ClaimTier {
  if (isStreamerPosition(c, ctx)) return starts(c) ? "streamer" : "stash";

  const bar = starterBar(c.position, ctx);
  if (c.seasonPositionRank != null && c.seasonPositionRank <= bar * 0.4) return "winner";
  if (c.seasonPositionRank != null && c.seasonPositionRank <= bar) return "starter";
  // Multiweek money needs a measured gain. A start the feed cannot size is
  // a start, and a start alone is filler money.
  if (c.weekGain != null && c.weekGain >= STARTER_GAIN) return "multiweek";
  // No season rank but a full role last week: the ranking has not caught up
  // to the depth chart, which is the usual shape of a real waiver target.
  if (c.seasonPositionRank == null && (c.lastWeekSnaps ?? 0) >= ROLE_SNAPS) return "multiweek";
  if (starts(c)) return "filler";
  return "stash";
}

function needFactor(c: ClaimCandidate, ctx: PricingContext): number {
  let f = (c.weekGain ?? 0) >= BIG_GAIN ? 1.25 : starts(c) ? 1.0 : 0.75;
  if (ctx.emptySlots > 0 && starts(c)) f += 0.1;
  return f;
}

/**
 * Record-driven urgency. A losing team buys wins now; a winning one keeps its
 * money for the playoffs. Dynasty rebuilders ignore the standings entirely,
 * because their season is not this one.
 */
function urgencyFactor(ctx: PricingContext): number {
  if (ctx.type === "dynasty" && (ctx.trajectory === "rebuild" || ctx.trajectory === "reload")) return 1;
  if (!ctx.record) return 1;
  const { wins, losses } = ctx.record;
  if (losses >= wins + 2) return 1.3;
  if (losses > wins) return 1.15;
  if (wins > losses + 1) return 0.85;
  return 1;
}

/** Redraft only: an early starter delivers the most usable weeks. */
function timingFactor(ctx: PricingContext): number {
  if (ctx.type !== "redraft") return 1;
  if (ctx.week <= 4) return 1.15;
  if (ctx.week >= 13) return 0.75;
  return 1;
}

/**
 * Dynasty only. Contenders pay up for a veteran who starts now; rebuilders
 * pay up for youth and almost nothing for a veteran whose role ends before
 * next season.
 */
function timelineFactor(c: ClaimCandidate, ctx: PricingContext): number {
  if (ctx.type !== "dynasty" || c.age == null) return 1;
  const young = c.age <= YOUNG_AGE;
  switch (ctx.trajectory) {
    case "contender":
    case "compete":
      return young ? 1 : starts(c) ? 1.2 : 0.6;
    case "rebuild":
      return young ? 1.3 : 0.3;
    case "reload":
      return young ? 1.2 : 0.8;
    default:
      return 1;
  }
}

/**
 * Money to keep back. Redraft: a small emergency fund until the playoffs are
 * in sight. Dynasty contenders: enough to cover an injury in the playoffs.
 * Rebuilders keep nothing back; their last run is for stashes.
 */
export function reserveFor(ctx: PricingContext): number {
  if (ctx.type === "redraft") return ctx.week < 13 ? ctx.budget * 0.1 : 0;
  if (ctx.trajectory === "contender" || ctx.trajectory === "compete") {
    return ctx.week < 15 ? ctx.budget * 0.12 : 0;
  }
  return 0;
}

function marketFor(tier: ClaimTier, c: ClaimCandidate, ctx: PricingContext): number {
  const share = STREAMER_POSITIONS.has(c.position) ? KICKER_DEFENSE_PRIOR : PRIOR[ctx.type][tier];
  const prior = ctx.budget * share;
  const seen = ctx.observed.filter((o) => o.tier === tier);
  const total = seen.reduce((s, o) => s + o.amount, 0);
  const blended = (prior * PRIOR_WEIGHT + total) / (PRIOR_WEIGHT + seen.length);
  const rank = ctx.trending.get(c.playerId);
  const heat = rank != null && rank <= HEAT_RANKS ? 1 + (HEAT_MAX * (HEAT_RANKS + 1 - rank)) / HEAT_RANKS : 1;
  const modelled = blended * heat;
  // Published consensus bids run high against what leagues actually pay, so
  // the research is one voice in the market number, not the whole of it.
  // Averaged where both exist, because they are two waiver columns rather than
  // two independent markets: counting them separately would let the published
  // opinion outvote what leagues actually pay.
  const published = [c.researchPercent, c.jinglesPercent].filter(
    (p): p is number => p != null && p > 0,
  );
  if (published.length > 0) {
    const consensus = published.reduce((a, b) => a + b, 0) / published.length;
    return (modelled + (ctx.budget * consensus) / 100) / 2;
  }
  return modelled;
}

export function priceClaim(c: ClaimCandidate, ctx: PricingContext): ClaimPrice {
  const tier = classifyClaim(c, ctx);
  const spendable = Math.max(0, ctx.remaining - reserveFor(ctx));

  const prior = STREAMER_POSITIONS.has(c.position) ? KICKER_DEFENSE_PRIOR : PRIOR[ctx.type][tier];
  const raw =
    ctx.budget *
    prior *
    needFactor(c, ctx) *
    urgencyFactor(ctx) *
    timingFactor(ctx) *
    timelineFactor(c, ctx);
  // Nothing left means a $0 claim, which Sleeper accepts and which lands
  // only when nobody else bids. It does not mean a dollar he does not have.
  const broke = spendable <= 0;
  const ceiling = broke ? 0 : Math.max(1, Math.min(spendable, Math.round(raw)));

  const marketExpected = marketFor(tier, c, ctx);
  const market = unroundBid(marketExpected, ceiling);
  // A long shot is a real gap, not a rounding one: a $1 ceiling against a
  // $1.20 market is not a bid that "will lose".
  const longShot = !broke && marketExpected > ceiling + Math.max(1, ceiling * 0.1);
  const bid = broke ? 0 : Math.max(1, Math.min(ceiling, longShot ? ceiling : market));

  const why: string[] = [TIER_MEANING[tier]];
  if (c.weekGain != null && c.weekGain > 0) {
    why.push(`Adds ${c.weekGain.toFixed(1)} projected points to this week's lineup.`);
  } else if (c.startsThisWeek) {
    const w = c.weekSlot;
    const where = w ? ` at ${w.slot}${w.over ? ` over ${w.over}` : ""}` : "";
    const ranks = w && w.to != null && w.from != null ? ` (ranked ${w.to} against ${w.from})` : "";
    why.push(`Cracks this week's lineup${where}${ranks}; no projection says by how much.`);
  }
  const rank = ctx.trending.get(c.playerId);
  if (rank != null && rank <= HEAT_RANKS) why.push(`Top ${rank} most-added on Sleeper today, so the room is bidding.`);
  if (ctx.type === "dynasty" && c.age != null && ctx.trajectory) {
    const young = c.age <= YOUNG_AGE;
    if ((ctx.trajectory === "rebuild" || ctx.trajectory === "reload") && !young) {
      why.push("A veteran on a rebuilding roster: pay little or nothing.");
    } else if (ctx.trajectory === "rebuild" && young) {
      why.push("Young enough to matter next year, which is what a rebuild buys.");
    }
  }
  if (c.researchPercent != null) {
    why.push(`This week's waiver columns put him at about ${c.researchPercent}% of budget.`);
  }
  if (c.jinglesPercent != null) {
    // Named, because a number with an author behind it is worth more than an
    // average, and Jack reads his post anyway.
    why.push(`Jingles bids ${Math.round(c.jinglesPercent)}% of budget on him this week.`);
  }
  if (broke) {
    why.push("No FAAB left to spend, so this is a $0 claim: it lands only if nobody else bids.");
  } else if (longShot) {
    why.push(
      `The room should pay about $${Math.round(marketExpected)}, above what he is worth to you. Bid your ceiling and expect to lose.`,
    );
  }

  return {
    tier,
    tierLabel: TIER_LABEL[tier],
    bid,
    walkAway: ceiling,
    marketExpected: Math.round(marketExpected),
    longShot,
    reason: why.join(" "),
  };
}

/**
 * Cumulative spend the sources call normal by this week, as a share of the
 * original budget. Redraft runs one curve; dynasty splits by what the team
 * is doing this year.
 */
export function paceTarget(ctx: Pick<PricingContext, "type" | "week" | "trajectory">): number {
  const curve: [number, number][] =
    ctx.type === "redraft"
      ? [[0, 0], [2, 0.27], [4, 0.45], [8, 0.7], [12, 0.87], [14, 0.95], [17, 1]]
      : ctx.trajectory === "rebuild" || ctx.trajectory === "reload"
        ? [[0, 0], [2, 0.08], [4, 0.15], [8, 0.32], [12, 0.55], [17, 1]]
        : [[0, 0], [2, 0.15], [4, 0.25], [8, 0.52], [12, 0.82], [15, 0.9], [17, 1]];
  const w = Math.max(0, ctx.week);
  for (let i = 1; i < curve.length; i++) {
    const [w0, s0] = curve[i - 1];
    const [w1, s1] = curve[i];
    if (w <= w1) return s0 + ((w - w0) / (w1 - w0)) * (s1 - s0);
  }
  return 1;
}

export interface Pacing {
  spent: number;
  spentShare: number;
  targetShare: number;
  reserve: number;
  note: string;
}

export function pacingFor(ctx: PricingContext): Pacing {
  const spent = Math.max(0, ctx.budget - ctx.remaining);
  const spentShare = ctx.budget > 0 ? spent / ctx.budget : 0;
  const targetShare = paceTarget(ctx);
  const reserve = reserveFor(ctx);
  const gap = spentShare - targetShare;
  const pct = (x: number) => `${Math.round(x * 100)}%`;

  let note: string;
  if (gap > 0.15) {
    note = `You have spent ${pct(spentShare)} of your budget; the pace for week ${ctx.week} is about ${pct(targetShare)}. Ahead of pace, so make the next claim count.`;
  } else if (gap < -0.15) {
    note = `You have spent ${pct(spentShare)} of your budget; the pace for week ${ctx.week} is about ${pct(targetShare)}. Money you do not spend this season is gone, so do not sit on it.`;
  } else {
    note = `You have spent ${pct(spentShare)} of your budget, on pace for week ${ctx.week} (about ${pct(targetShare)}).`;
  }
  if (reserve > 0) note += ` Keep about $${Math.round(reserve)} back for an injury.`;
  return { spent, spentShare, targetShare, reserve, note };
}
