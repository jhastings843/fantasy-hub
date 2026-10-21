import "server-only";
import { redis } from "@/lib/redis/client";
import { getLeagueMatchups } from "@/lib/sleeper/client";
import { getWeekTransactions } from "./league-state";
import {
  auctionsFrom,
  gradeChopCalls,
  gradeOurBids,
  gradeShadows,
  rivalProfiles,
  summarizeOurBids,
  typicalTop,
  type Auction,
  type BidSummary,
  type ChopCall,
  type ChopGrade,
  type LearnTransaction,
  type OurBid,
  type RivalProfile,
  type SavedCard,
  type ShadowResult,
  type WeekPoints,
} from "./learn";
import type { BidCard } from "./types";

// The IO half of learn.ts. Sleeper keeps the auctions, the chops and the
// points forever, so those are re-read, never stored. The one thing it does
// not keep is what we were about to do: the card and the chop odds as they
// stood before waivers ran. Those are saved here, once per week, and never
// expire, because they are the only evidence a strategy change could rest on.

const cardKey = (leagueId: string, season: string, week: number) =>
  `guillotine:v1:learn:${leagueId}:${season}:card:w${week}`;

interface SavedWeek {
  card: SavedCard;
  call: ChopCall;
}

/**
 * Save this week's card and chop odds while they are still a forecast.
 *
 * The report is rebuilt on every page view, so this runs often. It writes
 * until the week's waivers have run (leg week - 1 has any waiver record) and
 * never after, so the saved card is the last one before the auctions, not one
 * redrawn from the rosters the auctions produced.
 */
export async function saveWeek(
  leagueId: string,
  season: string,
  week: number,
  card: BidCard,
  faab: number,
  posture: string,
  field: { rosterId: number; chopProbability: number }[],
  myRosterId: number,
): Promise<void> {
  try {
    // Straight from Sleeper, not the 30-minute cache: a cached pre-run feed
    // would let a post-waiver card overwrite the real forecast. Any waiver
    // record, failed or complete, means the run has happened.
    const res = await fetch(`https://api.sleeper.app/v1/league/${leagueId}/transactions/${week - 1}`, { cache: "no-store" });
    if (!res.ok) return;
    const leg = (await res.json()) as LearnTransaction[];
    if (leg.some((t) => t.type === "waiver")) return;
    const saved: SavedWeek = {
      card: {
        week,
        savedAt: new Date().toISOString(),
        posture,
        faab,
        chains: card.chains.map((c) => ({
          drop: c.drop?.playerId ?? null,
          targets: c.targets.map((t) => ({
            playerId: t.player.playerId,
            name: t.player.name,
            tier: t.tier,
            bid: t.bid,
            walkAway: t.walkAway,
            displaces: t.displaces?.playerId ?? null,
          })),
        })),
      },
      call: { week, field, myRosterId, posture },
    };
    await redis.set(cardKey(leagueId, season, week), saved);
  } catch (e) {
    console.warn(`[guillotine] learn save failed: ${e instanceof Error ? e.message : e}`);
  }
}

async function savedWeeks(leagueId: string, season: string, throughWeek: number): Promise<SavedWeek[]> {
  const weeks = Array.from({ length: Math.max(0, throughWeek) }, (_, i) => i + 1);
  const rows = await Promise.all(
    weeks.map((w) => redis.get<SavedWeek>(cardKey(leagueId, season, w)).catch(() => null)),
  );
  return rows.filter((r): r is SavedWeek => !!r);
}

/** Every waiver run so far, every bid in it. */
export async function seasonAuctions(leagueId: string, throughLeg: number, budget: number) {
  const legs = Array.from({ length: Math.max(0, throughLeg) }, (_, i) => i + 1);
  const byLeg: Record<number, LearnTransaction[]> = {};
  const chopped: Record<number, number> = {};
  await Promise.all(
    legs.map(async (leg) => {
      const txs = (await getWeekTransactions(leagueId, leg)) as LearnTransaction[];
      byLeg[leg] = txs;
      const chop = txs.find((t) => t.type === "chopped" && t.status === "complete");
      if (chop?.roster_ids?.[0] != null) chopped[leg] = chop.roster_ids[0];
    }),
  );
  return { auctions: auctionsFrom(byLeg, budget), chopped };
}

type RawMatchup = {
  roster_id: number;
  points: number;
  starters?: string[] | null;
  players_points?: Record<string, number> | null;
};

async function seasonPoints(leagueId: string, throughWeek: number): Promise<WeekPoints[]> {
  const weeks = Array.from({ length: Math.max(0, throughWeek) }, (_, i) => i + 1);
  const rows = await Promise.all(
    weeks.map(async (week): Promise<WeekPoints | null> => {
      try {
        const m = (await getLeagueMatchups(leagueId, week)) as unknown as RawMatchup[];
        if (!m.length || m.every((x) => !x.points)) return null;
        const rosters: WeekPoints["rosters"] = {};
        for (const x of m) {
          rosters[x.roster_id] = { players: x.players_points ?? {}, starters: x.starters ?? [], points: x.points };
        }
        return { week, rosters };
      } catch {
        return null;
      }
    }),
  );
  return rows.filter((r): r is WeekPoints => r !== null);
}

export interface GuillotineLearning {
  /** Waiver runs read, and bids in them. */
  legs: number;
  bidsSeen: number;
  rivals: (RivalProfile & { alive: boolean; faabLeft: number })[];
  /** What it takes to win here: winning price over runner-up, across contested auctions. */
  room: { contested: number; medianPremium: number | null; medianBidders: number | null; typical: number };
  ours: OurBid[];
  oursNamed: Record<string, string>;
  summary: BidSummary;
  chops: ChopGrade[];
  shadows: ShadowResult[];
  /** Weeks with a saved card, and how many of them can be graded yet. */
  savedCards: number;
  lessons: string[];
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export interface LearnInput {
  leagueId: string;
  season: string;
  week: number;
  budget: number;
  myRosterId: number;
  rosters: { rosterId: number; name: string; alive: boolean; faabLeft: number }[];
  positionOf: (playerId: string) => string | null;
  nameOf: (playerId: string) => string;
}

/** Rival profiles only: cheap, and needed before the card is priced. */
export interface Room {
  profiles: RivalProfile[];
  auctions: Auction[];
  chopped: Record<number, number>;
  /** The toughest bidder in a typical contested auction, on the aggression scale. */
  typical: number;
}

export async function roomProfiles(input: LearnInput): Promise<Room> {
  const { auctions, chopped } = await seasonAuctions(input.leagueId, input.week - 1, input.budget);
  const profiles = rivalProfiles(
    auctions,
    input.rosters.map((r) => ({ rosterId: r.rosterId, name: r.name })),
    input.positionOf,
    input.week - 1,
  );
  return { profiles, auctions, chopped, typical: typicalTop(auctions, profiles) };
}

export async function buildLearning(
  input: LearnInput,
  room: Room,
): Promise<GuillotineLearning> {
  const { auctions, chopped, profiles } = room;
  const [points, saved] = await Promise.all([
    seasonPoints(input.leagueId, input.week - 1),
    savedWeeks(input.leagueId, input.season, input.week),
  ]);

  const ours = gradeOurBids(auctions, input.myRosterId, points);
  const summary = summarizeOurBids(ours);
  const chops = gradeChopCalls(saved.map((s) => s.call), chopped);
  const pointsOf = (playerId: string, week: number) => {
    const w = points.find((p) => p.week === week);
    if (!w) return null;
    for (const r of Object.values(w.rosters)) if (playerId in r.players) return r.players[playerId];
    return null;
  };
  const shadows = gradeShadows(saved.map((s) => s.card), auctions, input.myRosterId, points, pointsOf);

  const contested = auctions.filter((a) => a.runnerUp !== null && a.runnerUp > 0);
  const roomStats = {
    contested: contested.length,
    medianPremium: median(contested.map((a) => a.price / a.runnerUp!)),
    medianBidders: median(auctions.map((a) => a.bids.length)),
  };

  const byId = new Map(input.rosters.map((r) => [r.rosterId, r]));
  const rivals = profiles
    .filter((p) => p.rosterId !== input.myRosterId)
    .map((p) => ({ ...p, alive: byId.get(p.rosterId)?.alive ?? false, faabLeft: byId.get(p.rosterId)?.faabLeft ?? 0 }))
    .sort((a, b) => Number(b.alive) - Number(a.alive) || b.aggression - a.aggression);

  const oursNamed: Record<string, string> = {};
  for (const b of ours) oursNamed[b.playerId] = input.nameOf(b.playerId);

  return {
    legs: input.week - 1,
    bidsSeen: auctions.reduce((s, a) => s + a.bids.length, 0),
    rivals,
    room: {
      contested: roomStats.contested,
      medianPremium: roomStats.medianPremium === null ? null : Math.round(roomStats.medianPremium * 100) / 100,
      medianBidders: roomStats.medianBidders,
      typical: room.typical,
    },
    ours,
    oursNamed,
    summary,
    chops,
    shadows,
    savedCards: saved.length,
    lessons: lessonsFrom(summary, rivals, { ...roomStats, typical: room.typical }, chops, shadows),
  };
}

/** Plain sentences, only where the record says something. */
export function lessonsFrom(
  summary: BidSummary,
  rivals: (RivalProfile & { alive: boolean })[],
  room: { contested: number; medianPremium: number | null; typical: number },
  chops: ChopGrade[],
  shadows: ShadowResult[],
): string[] {
  const out: string[] = [];
  if (summary.contestedWins > 0 && summary.overpaid > 0) {
    out.push(
      `On ${summary.contestedWins} contested wins we paid $${summary.overpaid} more than the runner-up plus $1.${summary.overpaid > summary.spent * 0.25 ? " That is over a quarter of everything we spent, so there is room to bid closer." : ""}`,
    );
  }
  if (summary.uncontestedWins > 0 && summary.uncontestedExtra > 0) {
    out.push(`${summary.uncontestedWins} wins had no other bidder, so $${summary.uncontestedExtra} of what we paid would have been $1 bids. Only hindsight knows that, but it says this room leaves a lot of players alone.`);
  }
  if (summary.nearMisses > 0) {
    out.push(`${summary.nearMisses} of our losses were within 10% of the winning price. Those are the bids a dollar or two decides.`);
  }
  const hot = rivals.filter((r) => r.alive && r.contested >= 3 && r.aggression >= room.typical * 1.1);
  if (hot.length) {
    out.push(
      `Expect to pay up when ${hot.slice(0, 3).map((r) => `${r.name} (${r.aggression}x the auction median)`).join(", ")} ${hot.length === 1 ? "wants" : "want"} the same player: harder than the toughest bidder in a typical contested auction here (${room.typical}x). The card prices that in.`,
    );
  }
  const soft = rivals
    .filter((r) => r.alive && r.contested >= 3 && r.aggression <= room.typical * 0.8)
    .sort((a, b) => a.aggression - b.aggression);
  if (soft.length) {
    out.push(`${soft.slice(0, 3).map((r) => r.name).join(", ")} ${soft.length === 1 ? "bids" : "bid"} under the field head to head, so a player only they want comes cheaper.`);
  }
  if (room.medianPremium !== null && room.contested >= 5) {
    out.push(`A contested winner here typically pays ${room.medianPremium.toFixed(2)}x the runner-up, over ${room.contested} contested claims.`);
  }
  if (chops.length >= 2) {
    const top3 = chops.filter((c) => c.rankOfChopped <= 3).length;
    out.push(`The chop odds had the chopped team in their bottom three in ${top3} of ${chops.length} graded weeks.`);
  }
  const live = shadows.find((s) => s.id === "live");
  if (live && live.weeks >= 3) {
    const best = [...shadows].sort((a, b) => b.pointsAdded - a.pointsAdded)[0];
    if (best.id !== "live") {
      out.push(`Over ${live.weeks} graded weeks, "${best.label}" would have added ${best.pointsAdded} points for $${best.spent}, against ${live.pointsAdded} for $${live.spent} as sent. Not enough weeks to switch on its own; your call.`);
    }
  }
  return out;
}
