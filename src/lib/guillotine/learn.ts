// What the room has taught us, from the record rather than from the priors.
//
// Sleeper keeps every waiver bid in this league, the losing ones included, so
// the whole auction history is recoverable at any time: who bid, how much, on
// whom, and what it took to win. That is enough to learn three things without
// storing anything of our own:
//
//   1. How each leaguemate bids (rivalProfiles), which prices the card's
//      "what it takes to win" against the actual rivals who want a player
//      rather than an average room.
//   2. How our own bids went (gradeOurBids): won, lost by how much, overpaid
//      over the runner-up by how much, and what the player then scored for us.
//   3. Whether the chop simulation's odds were honest (gradeChopCalls).
//
// The fourth thing, whether a different strategy would have done better
// (gradeShadows), needs the card as it stood before waivers ran, which Sleeper
// does not keep. learn-store.ts saves it each week and this file grades it
// once the auctions and the games behind it are in.
//
// Everything here is pure. learn-build.ts does the fetching.

import type { Tier } from "./market";

/* ------------------------------------------------------------ auctions --- */

export interface LearnTransaction {
  type?: string;
  status?: string;
  leg?: number;
  roster_ids?: number[] | null;
  adds?: Record<string, number> | null;
  settings?: { waiver_bid?: number } | null;
  metadata?: { notes?: string } | null;
}

export interface Bid {
  rosterId: number;
  amount: number;
  won: boolean;
  /** FAAB the bidder had going into this week's run. */
  leftBefore: number;
}

/** One player's waiver run in one week, every bid on him, highest first. */
export interface Auction {
  /** Sleeper's leg: the week whose games were just played. He first plays for the buyer in leg + 1. */
  leg: number;
  playerId: string;
  bids: Bid[];
  winner: number | null;
  price: number;
  /** Second-highest bid, or null when only the winner bid. */
  runnerUp: number | null;
}

/**
 * Every auction so far. A failed bid only counts when someone else won the
 * same player in the same run for at least as much.
 */
export function auctionsFrom(byLeg: Record<number, LearnTransaction[]>, budget: number): Auction[] {
  const spent: Record<number, number> = {};
  const out: Auction[] = [];
  for (const leg of Object.keys(byLeg).map(Number).sort((a, b) => a - b)) {
    const txs = byLeg[leg] ?? [];
    const byPlayer = new Map<string, { rosterId: number; amount: number; won: boolean }[]>();
    for (const tx of txs) {
      if (tx.type !== "waiver") continue;
      const amount = tx.settings?.waiver_bid;
      const rosterId = tx.roster_ids?.[0];
      if (typeof amount !== "number" || rosterId == null) continue;
      const won = tx.status === "complete";
      if (!won && tx.status !== "failed") continue;
      for (const playerId of Object.keys(tx.adds ?? {})) {
        const list = byPlayer.get(playerId) ?? [];
        list.push({ rosterId, amount, won });
        byPlayer.set(playerId, list);
      }
    }
    const legSpend: Record<number, number> = {};
    for (const [playerId, raw] of byPlayer) {
      const winner = raw.find((b) => b.won);
      if (!winner) continue;
      // A losing bid above the price was not outbid: Sleeper rejected it for
      // money or roster room, so it was never in the auction.
      const bids = raw
        .filter((b) => b.won || b.amount <= winner.amount)
        .map((b) => ({ ...b, leftBefore: Math.max(0, budget - (spent[b.rosterId] ?? 0)) }))
        .sort((a, b) => b.amount - a.amount || Number(b.won) - Number(a.won));
      const others = bids.filter((b) => !b.won);
      out.push({
        leg,
        playerId,
        bids,
        winner: winner.rosterId,
        price: winner.amount,
        runnerUp: others.length ? others[0].amount : null,
      });
      legSpend[winner.rosterId] = (legSpend[winner.rosterId] ?? 0) + winner.amount;
    }
    for (const [id, amt] of Object.entries(legSpend)) spent[Number(id)] = (spent[Number(id)] ?? 0) + amt;
  }
  return out;
}

/* ------------------------------------------------------------- rivals ---- */

/** How many bids it takes before a manager's own habit outweighs the room's. */
export const AGGRESSION_PRIOR_BIDS = 4;
/** The most a single rival's habit can move a price, either way. */
export const ROOM_FACTOR_RANGE = { min: 0.85, max: 1.25 } as const;

export interface RivalProfile {
  rosterId: number;
  name: string;
  bids: number;
  wins: number;
  spent: number;
  /** Weeks with at least one bid, out of weeks played. */
  activeWeeks: number;
  /** Median bid as a share of the FAAB they had at the time. */
  medianShare: number;
  /** Largest single bid as a share of the FAAB they had at the time. */
  maxShare: number;
  /** Bids that had company, the ones aggression is read from. */
  contested: number;
  /**
   * How hard they push head to head, 1 = the middle of the auction. Their bid
   * over the median bid on the same player, as a geometric mean across every
   * contested auction they entered, shrunk toward 1 until they have a few.
   */
  aggression: number;
  /** Most-bid positions, most first. */
  positions: string[];
}

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function rivalProfiles(
  auctions: Auction[],
  rosters: { rosterId: number; name: string }[],
  position: (playerId: string) => string | null,
  legsPlayed: number,
): RivalProfile[] {
  type Row = { rosterId: number; leg: number; amount: number; won: boolean; share: number; ratio: number | null; pos: string | null };
  const rows: Row[] = [];
  for (const a of auctions) {
    // Head to head only: a bid alone on a player says how much he was wanted,
    // not how hard this manager pushes when someone else wants him too.
    const mid = a.bids.length >= 2 ? median(a.bids.map((b) => b.amount)) : 0;
    for (const b of a.bids) {
      rows.push({
        rosterId: b.rosterId,
        leg: a.leg,
        amount: b.amount,
        won: b.won,
        share: b.leftBefore > 0 ? b.amount / b.leftBefore : 0,
        ratio: mid > 0 && b.amount > 0 ? b.amount / mid : null,
        pos: position(a.playerId),
      });
    }
  }

  return rosters.map(({ rosterId, name }) => {
    const mine = rows.filter((r) => r.rosterId === rosterId);
    const rel = mine.filter((r) => r.ratio !== null).map((r) => Math.log(r.ratio!));
    // Shrinkage: AGGRESSION_PRIOR_BIDS phantom bids at the auction median.
    const shrunk = rel.reduce((s, x) => s + x, 0) / (rel.length + AGGRESSION_PRIOR_BIDS);
    const posCount = new Map<string, number>();
    for (const r of mine) if (r.pos) posCount.set(r.pos, (posCount.get(r.pos) ?? 0) + 1);
    return {
      rosterId,
      name,
      bids: mine.length,
      contested: rel.length,
      wins: mine.filter((r) => r.won).length,
      spent: mine.filter((r) => r.won).reduce((s, r) => s + r.amount, 0),
      activeWeeks: Math.min(new Set(mine.map((r) => r.leg)).size, legsPlayed),
      medianShare: round2(median(mine.map((r) => r.share))),
      maxShare: round2(Math.max(0, ...mine.map((r) => r.share))),
      aggression: round2(Math.exp(shrunk)),
      positions: [...posCount.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p),
    } satisfies RivalProfile;
  });
}

/**
 * The toughest bidder in a typical contested auction here, on the same scale
 * as aggression. The market's tier prices already carry that bidder, so a
 * player only costs more than the market when the rival chasing him is
 * tougher than that, and less when he is softer.
 */
export function typicalTop(auctions: Auction[], profiles: RivalProfile[]): number {
  const byId = new Map(profiles.map((p) => [p.rosterId, p.aggression]));
  const logs = auctions
    .filter((a) => a.bids.length >= 2)
    .map((a) => Math.log(Math.max(...a.bids.map((b) => byId.get(b.rosterId) ?? 1))));
  return logs.length ? round2(Math.exp(logs.reduce((s, x) => s + x, 0) / logs.length)) : 1;
}

/**
 * How much the rivals who want this player change what it takes to win him.
 * The most aggressive of them sets the price, so it is their habit that counts,
 * bounded so one manager's two wild bids cannot double a number.
 */
export function roomFactor(contested: string[], aggressionByName: Map<string, number>, typical = 1): number {
  if (!contested.length) return 1;
  const top = Math.max(...contested.map((n) => aggressionByName.get(n) ?? 1));
  return Math.min(ROOM_FACTOR_RANGE.max, Math.max(ROOM_FACTOR_RANGE.min, top / typical));
}

/* ------------------------------------------------------- our own bids ---- */

export interface WeekPoints {
  week: number;
  /** roster_id to the points each of its players scored, and who started. */
  rosters: Record<number, { players: Record<string, number>; starters: string[]; points: number }>;
}

export interface OurBid {
  leg: number;
  playerId: string;
  amount: number;
  won: boolean;
  price: number;
  runnerUp: number | null;
  bidders: number;
  /** Won: dollars paid above the runner-up plus one. Lost: dollars short of the price. */
  margin: number;
  /** Points he scored in our starting lineup since, and over how many weeks. */
  startedPoints: number | null;
  weeksSince: number;
}

export function gradeOurBids(auctions: Auction[], myRosterId: number, weeks: WeekPoints[]): OurBid[] {
  const out: OurBid[] = [];
  for (const a of auctions) {
    const mine = a.bids.find((b) => b.rosterId === myRosterId);
    if (!mine) continue;
    const later = weeks.filter((w) => w.week > a.leg);
    const started = mine.won
      ? later.reduce((s, w) => {
          const r = w.rosters[myRosterId];
          return r && r.starters.includes(a.playerId) ? s + (r.players[a.playerId] ?? 0) : s;
        }, 0)
      : null;
    out.push({
      leg: a.leg,
      playerId: a.playerId,
      amount: mine.amount,
      won: mine.won,
      price: a.price,
      runnerUp: a.runnerUp,
      bidders: a.bids.length,
      margin: mine.won ? Math.max(0, a.price - ((a.runnerUp ?? 0) + 1)) : a.price - mine.amount,
      startedPoints: started === null ? null : round2(started),
      weeksSince: later.length,
    });
  }
  return out.sort((a, b) => b.leg - a.leg || b.amount - a.amount);
}

export interface BidSummary {
  bids: number;
  wins: number;
  spent: number;
  /** Contested wins: dollars paid above what would still have won (runner-up + 1). */
  overpaid: number;
  contestedWins: number;
  /** Wins nobody else bid on: dollars above $1, which only hindsight could have saved. */
  uncontestedExtra: number;
  uncontestedWins: number;
  /** Losses that a bid within 10% of our own would have won. */
  nearMisses: number;
  /** Started points per dollar spent, over wins that have played at least once. */
  pointsPerDollar: number | null;
}

export function summarizeOurBids(bids: OurBid[]): BidSummary {
  const won = bids.filter((b) => b.won);
  const contested = won.filter((b) => b.runnerUp !== null);
  const alone = won.filter((b) => b.runnerUp === null);
  const played = won.filter((b) => b.weeksSince > 0);
  const playedSpend = played.reduce((s, b) => s + b.amount, 0);
  return {
    bids: bids.length,
    wins: won.length,
    spent: won.reduce((s, b) => s + b.amount, 0),
    overpaid: contested.reduce((s, b) => s + b.margin, 0),
    contestedWins: contested.length,
    uncontestedExtra: alone.reduce((s, b) => s + b.margin, 0),
    uncontestedWins: alone.length,
    nearMisses: bids.filter((b) => !b.won && b.margin <= Math.max(1, b.amount * 0.1)).length,
    pointsPerDollar: playedSpend > 0 ? round2(played.reduce((s, b) => s + (b.startedPoints ?? 0), 0) / playedSpend) : null,
  };
}

/* ---------------------------------------------------------- chop calls --- */

export interface ChopCall {
  /** The week whose games decide the chop. */
  week: number;
  field: { rosterId: number; chopProbability: number }[];
  myRosterId: number;
  posture: string;
}

export interface ChopGrade {
  week: number;
  chopped: number;
  /** What the simulation gave the team that was actually chopped. */
  givenToChopped: number;
  /** 1 = the simulation's most likely chop. */
  rankOfChopped: number;
  /** Mean squared error of every team's odds against what happened. Lower is better; 0.06 is a coin flip spread over 16. */
  brier: number;
  myProbability: number;
  posture: string;
}

export function gradeChopCalls(calls: ChopCall[], choppedByWeek: Record<number, number>): ChopGrade[] {
  const out: ChopGrade[] = [];
  for (const c of calls) {
    const chopped = choppedByWeek[c.week];
    if (chopped == null || !c.field.length) continue;
    const sorted = [...c.field].sort((a, b) => b.chopProbability - a.chopProbability);
    const rank = sorted.findIndex((f) => f.rosterId === chopped) + 1;
    out.push({
      week: c.week,
      chopped,
      givenToChopped: c.field.find((f) => f.rosterId === chopped)?.chopProbability ?? 0,
      rankOfChopped: rank || sorted.length + 1,
      brier: round3(c.field.reduce((s, f) => s + (f.chopProbability - (f.rosterId === chopped ? 1 : 0)) ** 2, 0) / c.field.length),
      myProbability: c.field.find((f) => f.rosterId === c.myRosterId)?.chopProbability ?? 0,
      posture: c.posture,
    });
  }
  return out.sort((a, b) => b.week - a.week);
}

/* ------------------------------------------------------------ shadows ---- */

/** The card as it stood before waivers ran, as learn-store.ts saves it. */
export interface SavedCard {
  week: number;
  savedAt: string;
  posture: string;
  /** Our FAAB when the card was drawn; a replay cannot spend past it. */
  faab?: number;
  chains: {
    drop: string | null;
    targets: { playerId: string; name: string; tier: Tier; bid: number; walkAway: number; displaces: string | null }[];
  }[];
}

/**
 * Bidding rules the live card is measured against, all priced off the same
 * card so the only difference is how hard each one bids. Report-only: one
 * league and a dozen weeks will never be enough to switch on its own, so these
 * show Jack what each would have cost and bought, and he decides.
 */
export const SHADOWS = [
  { id: "live", label: "The card as sent", bid: (t: { bid: number; walkAway: number }) => t.bid },
  { id: "lean", label: "Bid 25% under the card", bid: (t: { bid: number; walkAway: number }) => Math.max(1, Math.round(t.bid * 0.75)) },
  { id: "firm", label: "Bid 25% over, never past walk-away", bid: (t: { bid: number; walkAway: number }) => Math.min(t.walkAway, Math.round(t.bid * 1.25)) },
  { id: "walk", label: "Bid the walk-away", bid: (t: { bid: number; walkAway: number }) => t.walkAway },
] as const;

export const SHADOW_HORIZON = 3;

export interface ShadowResult {
  id: string;
  label: string;
  weeks: number;
  claims: number;
  spent: number;
  /** Points the claimed players scored over the players they displaced, next SHADOW_HORIZON weeks. */
  pointsAdded: number;
}

/**
 * Replay each saved card under each rule against the real bids. A rule wins a
 * player when its bid beats every other manager's (ties go against us, which
 * is how Sleeper's tiebreak usually lands for a team that is not last). One
 * claim per chain, in the card's order, as Sleeper would process them; a
 * player claimed once is not claimed again, and nothing past the FAAB we had.
 */
export function gradeShadows(
  cards: SavedCard[],
  auctions: Auction[],
  myRosterId: number,
  weeks: WeekPoints[],
  /** Points any player scored in a week, wherever he was rostered; null if nobody rostered him. */
  pointsOf: (playerId: string, week: number) => number | null,
): ShadowResult[] {
  return SHADOWS.map((s) => {
    let claims = 0;
    let spent = 0;
    let added = 0;
    let graded = 0;
    for (const card of cards) {
      const leg = card.week - 1;
      const playedSince = weeks.filter((w) => w.week > leg && w.week <= leg + SHADOW_HORIZON);
      if (!auctions.some((a) => a.leg === leg) || !playedSince.length) continue;
      graded++;
      // Each player once across the card, and never past the wallet.
      const taken = new Set<string>();
      let wallet = card.faab ?? Infinity;
      for (const chain of card.chains) {
        for (const t of chain.targets) {
          if (taken.has(t.playerId)) continue;
          const amount = s.bid(t);
          if (amount > wallet) continue;
          const auction = auctions.find((a) => a.leg === leg && a.playerId === t.playerId);
          const best = Math.max(0, ...(auction?.bids.filter((b) => b.rosterId !== myRosterId).map((b) => b.amount) ?? []));
          const wins = auction ? amount > best : true;
          if (!wins) continue;
          taken.add(t.playerId);
          wallet -= amount;
          claims++;
          spent += amount;
          for (const w of playedSince) {
            const got = pointsOf(t.playerId, w.week) ?? 0;
            const lost = t.displaces ? (w.rosters[myRosterId]?.players[t.displaces] ?? 0) : 0;
            added += got - lost;
          }
          break;
        }
      }
    }
    return { id: s.id, label: s.label, weeks: graded, claims, spent, pointsAdded: round2(added) };
  });
}

/* --------------------------------------------------------------- utils --- */

const round2 = (x: number) => Math.round(x * 100) / 100;
const round3 = (x: number) => Math.round(x * 1000) / 1000;
