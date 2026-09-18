// Pure logic for league-wide trade recommendations and proposed-trade
// evaluation. Safe to import from client components.
//
// Includes:
// - findBestTrades: scan all partners for fit-driven trades (legacy)
// - findLeagueWideMatches: given a fixed give side, find ALL competitive
//   trade options across the league
// - evaluateTrade: verdict on a specific proposal
// - suggestCounters: counter-offer suggestions when verdict is unfavorable

import type { PlayerRow, TeamSummary } from "./power-rankings";
import { tradeRooms } from "./trade-fits";
import type { RAPick } from "@/lib/rosteraudit/types";

const TRADE_POSITIONS = ["QB", "RB", "WR", "TE"] as const;

export function packageKey(players: PlayerRow[]): string {
  return players.map((p) => p.id).sort().join(",");
}

function bundleValue(players: PlayerRow[]): number {
  return players.reduce((sum, p) => sum + p.value, 0);
}

function playerBundles(players: PlayerRow[]): PlayerRow[][] {
  const candidates = [...players].sort((a, b) => b.value - a.value || a.id.localeCompare(b.id)).slice(0, 15);
  const bundles = candidates.map((p) => [p]);
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      bundles.push([candidates[i], candidates[j]]);
    }
  }
  return bundles;
}

function pickValue(p: RAPick, isSuperflex: boolean): number {
  return isSuperflex ? p.valueSf : p.value1qb;
}

// ---------------------------------------------------------------
// Best trades across the league
// ---------------------------------------------------------------

export type BestTradeKind = "position_fit" | "youth_arbitrage";

export interface BestTradeIdea extends BilateralScore {
  partnerRosterId: number;
  partnerName: string;
  send: PlayerRow[];
  receive: PlayerRow[];
  myValue: number;
  theirValue: number;
  reasoning: string[];
  positionalGain: { position: string; from: number; to: number };
  score: number;
  kind: BestTradeKind;
}

// Position-specific cutoffs for "aging" status. Dynasty values
// typically dip after these ages.
function agingThreshold(position: string): number {
  if (position === "QB") return 31;
  if (position === "TE") return 29;
  return 27; // RB / WR
}

function isAging(p: PlayerRow): boolean {
  if (p.age == null) return false;
  return p.age >= agingThreshold(p.position);
}

function isYoung(p: PlayerRow): boolean {
  if (p.age == null) return false;
  return p.age <= 24;
}

// Compute the projected new positional value for a team after a swap.
function projectedRoomValue(
  team: TeamSummary,
  position: string,
  giveAway: PlayerRow[],
  receive: PlayerRow[],
): number {
  let v = team.positionTotals[position] ?? 0;
  for (const p of giveAway) {
    if (p.position === position) v -= p.value;
  }
  for (const p of receive) {
    if (p.position === position) v += p.value;
  }
  return v;
}

// Project where the team would rank at a position after a swap.
function projectedRank(
  myTeam: TeamSummary,
  allTeams: TeamSummary[],
  position: string,
  giveAway: PlayerRow[],
  receive: PlayerRow[],
): number {
  const myProjected = projectedRoomValue(myTeam, position, giveAway, receive);
  let rank = 1;
  for (const t of allTeams) {
    if (t.rosterId === myTeam.rosterId) continue;
    const v = t.positionTotals[position] ?? 0;
    if (v > myProjected) rank += 1;
  }
  return rank;
}

export function findBestTrades(
  myTeam: TeamSummary,
  allTeams: TeamSummary[],
  totalTeams: number,
  limit = 6,
): BestTradeIdea[] {
  const ideas: BestTradeIdea[] = [];

  const myRanksByPos = TRADE_POSITIONS.map((p) => ({
    pos: p,
    rank: myTeam.positionRanks[p] ?? 99,
  })).sort((a, b) => b.rank - a.rank);

  // Anything below median is "needs help"; the bottom two are top priority.
  const median = Math.ceil(totalTeams / 2);
  const myWeakPositions = myRanksByPos
    .filter((x) => x.rank > median)
    .map((x) => x.pos);

  if (myWeakPositions.length === 0) {
    // Already balanced; no clear trade priorities. Return empty.
    return [];
  }

  // Fifteen candidates yield at most 120 bundles per side. Surplus-only
  // additions keep packages from stripping two scarce starters at once.
  const surplus = new Set<string>(tradeRooms(myTeam, totalTeams).surplus);
  const sendBundles = playerBundles(myTeam.players.filter((p) => p.value > 200))
    .filter((bundle) => bundle.length === 1 || bundle.some((p) =>
      surplus.has(p.position)));

  for (const partner of allTeams) {
    if (partner.rosterId === myTeam.rosterId) continue;
    const deficits = new Set<string>(tradeRooms(partner, totalTeams).deficit);
    const receiveBundles = playerBundles(partner.players.filter((p) => p.value > 200));
    for (const send of sendBundles) {
      for (const receive of receiveBundles) {
        const myValue = bundleValue(send);
        const theirValue = bundleValue(receive);
        if (Math.abs(myValue - theirValue) / Math.max(myValue, theirValue) > 0.2) continue;
        const recvPos = myWeakPositions.find((pos) =>
          receive.some((p) => p.position === pos) &&
          (partner.positionRanks[pos] ?? 99) < (myTeam.positionRanks[pos] ?? 99) &&
          projectedRank(myTeam, allTeams, pos, send, receive) < (myTeam.positionRanks[pos] ?? 99));
        if (!recvPos) continue;
        const bilateral = scoreBoth(myTeam, partner, allTeams, send, receive, totalTeams);
        if (!bilateral.mutual) continue;
        const from = myTeam.positionRanks[recvPos] ?? 99;
        const to = projectedRank(myTeam, allTeams, recvPos, send, receive);
        const fillsDeficit = send.some((p) => deficits.has(p.position));
        ideas.push({
          ...bilateral,
          partnerRosterId: partner.rosterId,
          partnerName: partner.ownerName,
          send,
          receive,
          myValue,
          theirValue,
          reasoning: [`Improves ${recvPos} room (#${from} → projected #${to})`],
          positionalGain: { position: recvPos, from, to },
          score: bilateral.mutualScore + (fillsDeficit ? 3 : 0),
          kind: "position_fit",
        });
      }
    }
  }

  // ---------- Youth arbitrage ----------
  // Generate "sell aging value for young upside" ideas independent of
  // positional fit. For each of my aging stars, find a younger player
  // on a partner's roster within 70-110% of my player's value.
  const myAgingStars = myTeam.players
    .filter((p) => isAging(p) && p.value >= 1500)
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);

  for (const oldPlayer of myAgingStars) {
    for (const partner of allTeams) {
      if (partner.rosterId === myTeam.rosterId) continue;
      const youngTargets = partner.players
        .filter(
          (p) =>
            isYoung(p) &&
            p.value >= oldPlayer.value * 0.7 &&
            p.value <= oldPlayer.value * 1.10 &&
            // Don't suggest swapping for someone in a position we're
            // already deep in unless we're getting clear value back.
            (myTeam.positionRanks[p.position] ?? 99) >= 4,
        )
        .sort((a, b) => b.value - a.value)
        .slice(0, 2);

      for (const youngPlayer of youngTargets) {
        const sendAge = oldPlayer.age ?? 28;
        const recvAge = youngPlayer.age ?? 23;
        const ageDelta = sendAge - recvAge;
        const valueDelta = youngPlayer.value - oldPlayer.value;
        const baseline = Math.max(oldPlayer.value, youngPlayer.value);
        const pct = baseline > 0 ? valueDelta / baseline : 0;

        // Score the dynasty arc: age delta is the headline, value
        // parity matters less but losing too much still hurts.
        const score = ageDelta * 3 + pct * 30 + 6; // base bump so these compete with position-fit ideas

        // Capture positional ranks for the receive position so the
        // existing UI ("X #from → #to") still has data even though
        // this isn't a strict positional-fit trade.
        const beforeRank = myTeam.positionRanks[youngPlayer.position] ?? 99;
        const afterRank = projectedRank(
          myTeam,
          allTeams,
          youngPlayer.position,
          [oldPlayer],
          [youngPlayer],
        );

        const reasoning: string[] = [
          `Sells aging ${oldPlayer.name} (age ${sendAge.toFixed(0)}) for ${ageDelta.toFixed(0)}-year-younger upside`,
          `${youngPlayer.name} is ${recvAge.toFixed(0)}; long dynasty runway`,
        ];
        if (Math.abs(valueDelta) <= 200) {
          reasoning.push("Value is essentially even");
        } else if (valueDelta > 0) {
          reasoning.push(`You gain +${valueDelta.toLocaleString()} in value`);
        } else {
          reasoning.push(
            `You give up ${Math.abs(valueDelta).toLocaleString()} in value for the age swap`,
          );
        }

        const bilateral = scoreBoth(myTeam, partner, allTeams, [oldPlayer], [youngPlayer], totalTeams);
        if (!bilateral.mutual) continue;
        ideas.push({
          ...bilateral,
          partnerRosterId: partner.rosterId,
          partnerName: partner.ownerName,
          send: [oldPlayer],
          receive: [youngPlayer],
          myValue: oldPlayer.value,
          theirValue: youngPlayer.value,
          reasoning,
          positionalGain: {
            position: youngPlayer.position,
            from: beforeRank,
            to: afterRank,
          },
          score,
          kind: "youth_arbitrage",
        });
      }
    }
  }

  // Canonical bundle keys merge proposals reached through different fits.
  const seen = new Map<string, BestTradeIdea>();
  for (const idea of ideas) {
    const key = `${idea.partnerRosterId}-${packageKey(idea.send)}-${packageKey(idea.receive)}`;
    const existing = seen.get(key);
    if (!existing || idea.score > existing.score) {
      seen.set(key, idea);
    }
  }

  // Diversify: cap each unique send bundle at 2 appearances in the
  // final list so the same one or two pieces don't dominate every row,
  // and try to mix at least one youth-arbitrage idea into the top.
  const sorted = [...seen.values()].sort((a, b) => b.score - a.score);
  const final: BestTradeIdea[] = [];
  const sendCount = new Map<string, number>();
  const SEND_CAP = 2;

  // First pass: take ideas in score order while respecting the cap.
  for (const idea of sorted) {
    const sendId = packageKey(idea.send);
    if (sendId) {
      const c = sendCount.get(sendId) ?? 0;
      if (c >= SEND_CAP) continue;
    }
    final.push(idea);
    if (sendId) sendCount.set(sendId, (sendCount.get(sendId) ?? 0) + 1);
    if (final.length >= limit) break;
  }

  // Ensure at least one youth_arbitrage idea makes the list when we
  // have one; the user explicitly wants that flavor surfaced.
  if (
    final.length > 0 &&
    !final.some((i) => i.kind === "youth_arbitrage") &&
    sorted.some((i) => i.kind === "youth_arbitrage")
  ) {
    const bestYouth = sorted.find((i) => i.kind === "youth_arbitrage");
    if (bestYouth) {
      // Replace the lowest-scoring position_fit idea with the best youth one.
      const lastFitIdx = final
        .map((idea, idx) => ({ idea, idx }))
        .reverse()
        .find((x) => x.idea.kind === "position_fit")?.idx;
      if (lastFitIdx !== undefined) {
        final[lastFitIdx] = bestYouth;
      } else {
        final.push(bestYouth);
      }
    }
  }

  return final;
}

// ---------------------------------------------------------------
// League-wide auto-match: given my selected give side, surface every
// competitive trade option across all partner teams.
// ---------------------------------------------------------------

export interface LeagueWideMatch extends BilateralScore {
  partnerRosterId: number;
  partnerName: string;
  receivePlayers: PlayerRow[];
  sendValue: number;
  receiveValue: number;
  delta: number; // receive - send (positive = you win)
  pctDelta: number;
  isFit: boolean;
  fitPositions: string[];
  conflictWarning: boolean;
  reasoning: string[];
  score: number;
}

export function findLeagueWideMatches({
  myTeam,
  mySendPlayerIds,
  mySendValue,
  allTeams,
  weakestPositions,
  // Allow trades where you lose at most this many absolute value
  // points (so "fair" trades still surface but clear losses are
  // omitted). Set to 0 for strictly non-losing trades.
  totalTeams = allTeams.length,
  maxLoss = 100,
  // Bound the candidate search; bilateral scoring decides acceptability.
  maxAdvantage = 2000,
  // Cap total to keep the list manageable.
  limit = 18,
}: {
  myTeam: TeamSummary;
  mySendPlayerIds: Set<string>;
  mySendValue: number;
  allTeams: TeamSummary[];
  weakestPositions: string[];
  isSuperflex?: boolean;
  totalTeams?: number;
  maxLoss?: number;
  maxAdvantage?: number;
  limit?: number;
}): LeagueWideMatch[] {
  if (mySendValue === 0) return [];

  // Compute my POST-trade team+position set (for conflict avoidance per
  // Jack's rule).
  const myPostTradePositions = new Set<string>();
  for (const p of myTeam.players) {
    if (mySendPlayerIds.has(p.id)) continue;
    if (p.team && p.position) {
      myPostTradePositions.add(`${p.team}-${p.position}`);
    }
  }

  const matches: LeagueWideMatch[] = [];

  for (const partner of allTeams) {
    if (partner.rosterId === myTeam.rosterId) continue;

    const giving = myTeam.players.filter((p) => mySendPlayerIds.has(p.id));
    // Singles retain the full roster; only pair enumeration is capped.
    const candidates = partner.players.filter((p) => p.value > 0);
    const bundles = [
      ...candidates.map((p) => [p]),
      ...playerBundles(candidates).filter((bundle) => bundle.length === 2),
    ];
    for (const receivePlayers of bundles) {
      const receiveValue = bundleValue(receivePlayers);
      const delta = receiveValue - mySendValue;
      if (delta < -maxLoss || delta > maxAdvantage) continue;
      const occupied = new Set(myPostTradePositions);
      let conflict = false;
      for (const p of receivePlayers) {
        if (!p.team || !p.position) continue;
        const key = `${p.team}-${p.position}`;
        if (occupied.has(key)) conflict = true;
        occupied.add(key);
      }
      if (conflict) continue;
      const bilateral = scoreBoth(myTeam, partner, allTeams, giving, receivePlayers,
        totalTeams, mySendValue, receiveValue);
      if (!bilateral.mutual) continue;
      const fitPositions = [...new Set(receivePlayers
        .map((p) => p.position).filter((pos) => weakestPositions.includes(pos)))];
      matches.push({
        ...bilateral,
        partnerRosterId: partner.rosterId,
        partnerName: partner.ownerName,
        receivePlayers,
        sendValue: mySendValue,
        receiveValue,
        delta,
        pctDelta: delta / Math.max(receiveValue, mySendValue),
        isFit: fitPositions.length > 0,
        fitPositions,
        conflictWarning: false,
        reasoning: fitPositions.map((pos) => `Fills your weak ${pos} room`),
        score: bilateral.mutualScore,
      });
    }
  }

  // Canonical asset keys keep distinct packages and collapse order duplicates.
  const bestPerKey = new Map<string, LeagueWideMatch>();
  for (const m of matches) {
    const key = `${m.partnerRosterId}-${packageKey(m.receivePlayers)}`;
    const existing = bestPerKey.get(key);
    if (!existing || m.score > existing.score) {
      bestPerKey.set(key, m);
    }
  }

  return [...bestPerKey.values()]
    .sort((a, b) => b.mutualScore - a.mutualScore || b.delta - a.delta)
    .slice(0, limit);
}

export type LeagueWideMatchTier = "steal" | "edge" | "fair";

// ---------------------------------------------------------------
// Level out an unbalanced trade
// ---------------------------------------------------------------

export type LevelerType =
  | "add_my_player"
  | "add_my_pick"
  | "add_their_player"
  | "add_their_pick"
  | "remove_my_player"
  | "remove_their_player";

export interface LevelerOption {
  type: LevelerType;
  description: string;
  closesGapBy: number; // absolute value of the asset moved
  resultingDelta: number; // signed delta after applying (closer to 0 = better)
  player?: PlayerRow;
  pickId?: number;
  pickLabel?: string;
  pickValue?: number;
}

interface LevelerInput {
  myTeam: TeamSummary;
  partnerTeam: TeamSummary;
  mySelectedIds: Set<string>;
  theirSelectedIds: Set<string>;
  delta: number; // their - mine; positive = you're winning
  picks: RAPick[]; // all RA picks
  selectedPickIds: Set<number>; // picks already in trade (either side)
  isSuperflex: boolean;
  myWeakPositions: string[];
}

export function suggestLevelers({
  myTeam,
  partnerTeam,
  mySelectedIds,
  theirSelectedIds,
  delta,
  picks,
  selectedPickIds,
  isSuperflex,
  myWeakPositions,
}: LevelerInput): LevelerOption[] {
  if (Math.abs(delta) < 100) return [];

  const options: LevelerOption[] = [];

  function pickValueFor(p: RAPick): number {
    return isSuperflex ? p.valueSf : p.value1qb;
  }

  const winning = delta > 0;
  const target = Math.abs(delta);

  if (winning) {
    // I'm getting more than I'm giving. Either I add value to my side
    // (most common ask from partner) or remove value from their side.

    // 1. Players I can ADD from my roster (excluding already-selected)
    for (const p of myTeam.players) {
      if (mySelectedIds.has(p.id)) continue;
      if (p.value <= 0) continue;
      const resulting = delta - p.value; // adding to my side reduces delta
      // Only show if it actually moves us closer to zero
      if (Math.abs(resulting) >= target) continue;
      options.push({
        type: "add_my_player",
        description: `Add ${p.name}`,
        closesGapBy: p.value,
        resultingDelta: resulting,
        player: p,
      });
    }

    // 2. Picks I can ADD (any RA pick not already in the trade)
    for (const pk of picks) {
      if (selectedPickIds.has(pk.id)) continue;
      const pv = pickValueFor(pk);
      if (pv <= 0) continue;
      const resulting = delta - pv;
      if (Math.abs(resulting) >= target) continue;
      options.push({
        type: "add_my_pick",
        description: `Add ${pk.label}`,
        closesGapBy: pv,
        resultingDelta: resulting,
        pickId: pk.id,
        pickLabel: pk.label,
        pickValue: pv,
      });
    }

    // 3. Remove a small player from THEIR side (if multiple selected)
    if (theirSelectedIds.size > 1) {
      for (const p of partnerTeam.players) {
        if (!theirSelectedIds.has(p.id)) continue;
        const resulting = delta - p.value;
        if (Math.abs(resulting) >= target) continue;
        options.push({
          type: "remove_their_player",
          description: `Drop ${p.name} from their side`,
          closesGapBy: p.value,
          resultingDelta: resulting,
          player: p,
        });
      }
    }
  } else {
    // I'm losing. Either partner adds value, I add value to my side too,
    // or I remove value from my side.

    // 1. Players partner could ADD from their roster
    for (const p of partnerTeam.players) {
      if (theirSelectedIds.has(p.id)) continue;
      if (p.value <= 0) continue;
      const resulting = delta + p.value; // adding to their side increases delta toward zero
      if (Math.abs(resulting) >= target) continue;
      options.push({
        type: "add_their_player",
        description: `Ask for ${p.name}`,
        closesGapBy: p.value,
        resultingDelta: resulting,
        player: p,
      });
    }

    // 2. Picks I could ask them to throw in
    for (const pk of picks) {
      if (selectedPickIds.has(pk.id)) continue;
      const pv = pickValueFor(pk);
      if (pv <= 0) continue;
      const resulting = delta + pv;
      if (Math.abs(resulting) >= target) continue;
      options.push({
        type: "add_their_pick",
        description: `Ask for ${pk.label}`,
        closesGapBy: pv,
        resultingDelta: resulting,
        pickId: pk.id,
        pickLabel: pk.label,
        pickValue: pv,
      });
    }

    // 3. Remove a small player from MY side (if multiple selected)
    if (mySelectedIds.size > 1) {
      for (const p of myTeam.players) {
        if (!mySelectedIds.has(p.id)) continue;
        const resulting = delta + p.value;
        if (Math.abs(resulting) >= target) continue;
        options.push({
          type: "remove_my_player",
          description: `Pull ${p.name} from your side`,
          closesGapBy: p.value,
          resultingDelta: resulting,
          player: p,
        });
      }
    }
  }

  // Sort by closeness to zero (best level wins). Tiebreakers: prefer
  // adding from my surplus positions, prefer cheaper assets.
  options.sort((a, b) => {
    const aDist = Math.abs(a.resultingDelta);
    const bDist = Math.abs(b.resultingDelta);
    if (aDist !== bDist) return aDist - bDist;
    // Tiebreaker: prefer "add_my_player" from a non-weak position
    const aIsAddMy = a.type === "add_my_player";
    const bIsAddMy = b.type === "add_my_player";
    if (aIsAddMy && bIsAddMy) {
      const aFromWeak =
        a.player && myWeakPositions.includes(a.player.position);
      const bFromWeak =
        b.player && myWeakPositions.includes(b.player.position);
      if (aFromWeak !== bFromWeak) return aFromWeak ? 1 : -1;
    }
    return a.closesGapBy - b.closesGapBy;
  });

  return options.slice(0, 6);
}

export function tierForMatch(m: LeagueWideMatch): LeagueWideMatchTier {
  if (m.delta >= 1000) return "steal";
  if (m.delta >= 500) return "edge";
  return "fair";
}

// ---------------------------------------------------------------
// Verdict on a proposed trade
// ---------------------------------------------------------------

export type TradeVerdict =
  | "accept"
  | "lean_accept"
  | "even"
  | "lean_decline"
  | "decline";

export interface ProposedTrade {
  myPlayers: PlayerRow[];
  myPicks: RAPick[];
  theirPlayers: PlayerRow[];
  theirPicks: RAPick[];
}

export type HoleChange =
  | "opens" // wasn't a hole before, will be after
  | "closes" // was a hole, won't be after
  | "deepens" // already a hole, getting worse
  | "stays_strong" // wasn't a hole, won't be a hole
  | "stays_hole"; // still a hole, but unchanged

export interface PositionalImpact {
  position: string;
  beforeRank: number;
  afterRank: number;
  delta: number; // positive = improved (lower rank number)
  holeChange: HoleChange;
}

export interface CounterSuggestion {
  type: "ask_for_pick" | "ask_for_player" | "remove_player" | "swap_player";
  description: string;
  side: "add_to_their_side" | "remove_from_my_side" | "replace";
  // Optional concrete asset
  pickIdToAdd?: number;
  playerToAdd?: PlayerRow;
  playerToRemove?: PlayerRow;
}

export interface TradeAssessment extends BilateralScore {
  verdict: TradeVerdict;
  myValue: number;
  theirValue: number;
  delta: number; // their - mine (positive = you win)
  pctDelta: number;
  reasoning: string[];
  positionalImpact: PositionalImpact[];
  counters: CounterSuggestion[];
  /**
   * How much of the value gap is his opinion rather than the market's, in
   * value points; positive favours you. Null when no player in the deal
   * carries his rank, which is every dynasty league.
   */
  jinglesSwing: number | null;
}

const VERDICT_LABEL: Record<TradeVerdict, string> = {
  accept: "Accept",
  lean_accept: "Lean accept",
  even: "Even",
  lean_decline: "Lean decline",
  decline: "Decline",
};

export function verdictLabel(v: TradeVerdict): string {
  return VERDICT_LABEL[v];
}

export function scoreSideFor(
  team: TeamSummary,
  allTeams: TeamSummary[],
  giving: PlayerRow[],
  receiving: PlayerRow[],
  totalTeams: number,
) {
  const given = bundleValue(giving);
  const received = bundleValue(receiving);
  const baseline = Math.max(given, received);
  const pctDelta = baseline > 0 ? (received - given) / baseline : 0;
  // Compute positional impact (only for positions touched).
  const touchedPositions = new Set<string>();
  for (const p of [...giving, ...receiving]) {
    touchedPositions.add(p.position);
  }

  // A "hole" is a bottom-3 ranked position room. Used to flag trades
  // that turn a healthy room into a hole (opens) or plug an existing
  // hole (closes), since those swings outweigh raw value delta.
  const holeThreshold = Math.max(1, totalTeams - 2);

  const positionalImpact: PositionalImpact[] = [];
  for (const pos of touchedPositions) {
    const beforeRank = team.positionRanks[pos] ?? 99;
    const afterRank = projectedRank(
      team,
      allTeams,
      pos,
      giving.filter((p) => p.position === pos),
      receiving.filter((p) => p.position === pos),
    );
    const wasHole = beforeRank >= holeThreshold;
    const willBeHole = afterRank >= holeThreshold;
    let holeChange: HoleChange;
    if (!wasHole && willBeHole) holeChange = "opens";
    else if (wasHole && !willBeHole) holeChange = "closes";
    else if (wasHole && willBeHole && afterRank > beforeRank)
      holeChange = "deepens";
    else if (wasHole) holeChange = "stays_hole";
    else holeChange = "stays_strong";
    positionalImpact.push({
      position: pos,
      beforeRank,
      afterRank,
      delta: beforeRank - afterRank,
      holeChange,
    });
  }

  // Score positional impact: sum of (delta * how-weak-it-was) so improving
  // a weak room counts more than improving an already-strong one. On top
  // of that, opening a hole is a heavier penalty and closing a hole is a
  // heavier bonus than the rank delta alone would suggest.
  let positionalScore = 0;
  for (const imp of positionalImpact) {
    const weakness = Math.max(0, imp.beforeRank - 6);
    positionalScore += imp.delta * (1 + weakness * 0.3);
    if (imp.holeChange === "opens") positionalScore -= 5;
    else if (imp.holeChange === "closes") positionalScore += 5;
    else if (imp.holeChange === "deepens") positionalScore -= 2;
  }

  // Combine: pct * 100 + positional score * 5 (roughly comparable scales)
  const overallScore = pctDelta * 100 + positionalScore * 5;

  return { positionalScore, positionalImpact, overallScore, pctDelta };
}

// ---------------------------------------------------------------
// His list versus the market
// ---------------------------------------------------------------

/** Value the blend added to (or took from) a player. Zero when unblended. */
function jinglesLift(p: PlayerRow): number {
  return p.marketValue === undefined ? 0 : p.value - p.marketValue;
}

function hisLabel(p: PlayerRow): string {
  if (p.jinglesRank === null || p.jinglesRank === undefined) {
    return `he left ${p.name} off his list`;
  }
  return `he has ${p.name} ${p.position}${p.jinglesPositionRank ?? p.jinglesRank}`;
}

function marketLabel(p: PlayerRow): string {
  return `the market has him ${p.position}${p.marketPositionRank ?? p.positionRank}`;
}

/**
 * One line on where his list stands on the deal.
 *
 * The blended values already carry his opinion into the verdict; this makes
 * that visible. Without it a trade the market calls even could read as a
 * clear win, and Jack would have no way to tell whether that was the market
 * or Jingles talking. The line names the single biggest mover, which is the
 * player worth asking about.
 */
export function jinglesLean(
  giving: PlayerRow[],
  receiving: PlayerRow[],
): { swing: number; line: string } | null {
  const blended = [...giving, ...receiving].filter((p) => p.marketValue !== undefined);
  if (blended.length === 0) return null;

  const swing =
    receiving.reduce((s, p) => s + jinglesLift(p), 0) -
    giving.reduce((s, p) => s + jinglesLift(p), 0);

  const baseline = Math.max(bundleValue(giving), bundleValue(receiving));
  if (Math.abs(swing) < 100 && Math.abs(swing) < baseline * 0.05) {
    return { swing, line: "Jingles and the market agree on this one" };
  }

  // The player whose lift moved the gap furthest in the swing's direction.
  const movers = [
    ...receiving.map((p) => ({ p, toward: jinglesLift(p) })),
    ...giving.map((p) => ({ p, toward: -jinglesLift(p) })),
  ].filter((m) => Math.sign(m.toward) === Math.sign(swing));
  movers.sort((a, b) => Math.abs(b.toward) - Math.abs(a.toward));
  const mover = movers[0]?.p;
  const signed = `${swing > 0 ? "+" : ""}${swing.toLocaleString()}`;
  const head = swing > 0
    ? `Jingles tilts this your way (${signed})`
    : `Jingles tilts this against you (${signed})`;
  if (!mover) return { swing, line: head };
  return { swing, line: `${head}: ${hisLabel(mover)}, ${marketLabel(mover)}` };
}

function verdictFor(score: number): TradeVerdict {
  if (score >= 18) return "accept";
  if (score >= 6) return "lean_accept";
  if (score > -6) return "even";
  if (score > -18) return "lean_decline";
  return "decline";
}

interface BilateralScore {
  partner: { score: number; verdict: TradeVerdict; positionalImpact: PositionalImpact[] };
  mutual: boolean;
  mutualScore: number;
}

function scoreBoth(
  team: TeamSummary,
  partner: TeamSummary | null,
  allTeams: TeamSummary[],
  giving: PlayerRow[],
  receiving: PlayerRow[],
  totalTeams: number,
  givenValue = bundleValue(giving),
  receivedValue = bundleValue(receiving),
) {
  const mine = scoreSideFor(team, allTeams, giving, receiving, totalTeams);
  const theirs = partner ? scoreSideFor(partner, allTeams, receiving, giving, totalTeams) : null;
  // Picks affect value parity but cannot fill a current positional hole.
  const baseline = Math.max(givenValue, receivedValue);
  const pctDelta = baseline > 0 ? (receivedValue - givenValue) / baseline : 0;
  const score = pctDelta * 100 + mine.positionalScore * 5;
  const partnerScore = theirs ? -pctDelta * 100 + theirs.positionalScore * 5 : -100;
  return {
    score,
    verdict: verdictFor(score),
    positionalImpact: mine.positionalImpact,
    partner: {
      score: partnerScore,
      verdict: verdictFor(partnerScore),
      positionalImpact: theirs?.positionalImpact ?? [],
    },
    mutual: partner !== null && score > -6 && partnerScore > -6,
    mutualScore: Math.min(score, partnerScore),
  };
}

export function evaluateTrade(
  proposal: ProposedTrade,
  myTeam: TeamSummary,
  partner: TeamSummary | null,
  allTeams: TeamSummary[],
  totalTeams: number,
  isSuperflex: boolean,
  picksById: Map<number, RAPick>,
): TradeAssessment | null {
  const empty =
    proposal.myPlayers.length === 0 &&
    proposal.myPicks.length === 0 &&
    proposal.theirPlayers.length === 0 &&
    proposal.theirPicks.length === 0;
  if (empty) return null;

  const myPlayerSum = proposal.myPlayers.reduce((s, p) => s + p.value, 0);
  const myPickSum = proposal.myPicks.reduce(
    (s, p) => s + pickValue(p, isSuperflex),
    0,
  );
  const theirPlayerSum = proposal.theirPlayers.reduce(
    (s, p) => s + p.value,
    0,
  );
  const theirPickSum = proposal.theirPicks.reduce(
    (s, p) => s + pickValue(p, isSuperflex),
    0,
  );

  const myValue = myPlayerSum + myPickSum;
  const theirValue = theirPlayerSum + theirPickSum;
  const delta = theirValue - myValue;
  const baseline = Math.max(myValue, theirValue);
  const pctDelta = baseline > 0 ? delta / baseline : 0;

  const { verdict, positionalImpact, partner: partnerAssessment, mutual, mutualScore } = scoreBoth(
    myTeam, partner, allTeams, proposal.myPlayers, proposal.theirPlayers,
    totalTeams, myValue, theirValue,
  );

  const reasoning: string[] = [];
  if (Math.abs(pctDelta) >= 0.05) {
    const pct = Math.round(pctDelta * 100);
    reasoning.push(
      delta > 0
        ? `You gain ${delta.toLocaleString()} value (+${pct}%)`
        : `You lose ${Math.abs(delta).toLocaleString()} value (${pct}%)`,
    );
  } else {
    reasoning.push("Value is essentially even");
  }

  const lean = jinglesLean(proposal.myPlayers, proposal.theirPlayers);
  if (lean) reasoning.push(lean.line);

  // Lead with hole transitions, then improvements, then non-hole
  // weakening. Holes get explicit language because opening one is
  // typically a worse outcome than the raw rank delta suggests.
  const opens = positionalImpact.filter((p) => p.holeChange === "opens");
  const closes = positionalImpact.filter((p) => p.holeChange === "closes");
  const deepens = positionalImpact.filter((p) => p.holeChange === "deepens");
  const improvements = positionalImpact.filter(
    (p) => p.delta > 0 && p.holeChange !== "closes",
  );
  const otherWeakening = positionalImpact.filter(
    (p) =>
      p.delta < 0 && p.holeChange !== "opens" && p.holeChange !== "deepens",
  );

  for (const imp of opens) {
    reasoning.push(
      `Opens a hole at ${imp.position} (#${imp.beforeRank} → projected #${imp.afterRank} of ${totalTeams})`,
    );
  }
  for (const imp of closes) {
    reasoning.push(
      `Fills your ${imp.position} hole (#${imp.beforeRank} → projected #${imp.afterRank} of ${totalTeams})`,
    );
  }
  for (const imp of deepens) {
    reasoning.push(
      `Deepens your ${imp.position} hole (#${imp.beforeRank} → projected #${imp.afterRank} of ${totalTeams})`,
    );
  }
  for (const imp of improvements) {
    reasoning.push(
      `Improves ${imp.position} room (#${imp.beforeRank} → projected #${imp.afterRank})`,
    );
  }
  for (const imp of otherWeakening) {
    reasoning.push(
      `Weakens ${imp.position} room (#${imp.beforeRank} → projected #${imp.afterRank})`,
    );
  }

  // Counter suggestions when not "accept".
  const counters: CounterSuggestion[] = [];
  if (verdict !== "accept" && verdict !== "lean_accept" && partner) {
    if (delta < -200) {
      // Try to balance value: ask for a future pick from their side
      const partnerPicks = [...picksById.values()]
        .filter(
          (p) => !proposal.theirPicks.some((pp) => pp.id === p.id),
        )
        .sort(
          (a, b) =>
            Math.abs(pickValue(a, isSuperflex) + delta) -
            Math.abs(pickValue(b, isSuperflex) + delta),
        );
      const target = partnerPicks.find(
        (p) =>
          pickValue(p, isSuperflex) >= Math.abs(delta) * 0.6 &&
          pickValue(p, isSuperflex) <= Math.abs(delta) * 1.6,
      );
      if (target) {
        counters.push({
          type: "ask_for_pick",
          side: "add_to_their_side",
          description: `Ask for their ${target.label} to balance value`,
          pickIdToAdd: target.id,
        });
      }
    }

    // If a position got weaker, suggest removing the worst player you give in that position
    const weakenedRooms = positionalImpact.filter((p) => p.delta < 0);
    for (const imp of weakenedRooms) {
      const candidate = proposal.myPlayers
        .filter((p) => p.position === imp.position)
        .sort((a, b) => b.value - a.value)[0];
      if (candidate) {
        counters.push({
          type: "remove_player",
          side: "remove_from_my_side",
          description: `Pull ${candidate.name} from your side; you're already thin at ${imp.position}`,
          playerToRemove: candidate,
        });
      }
    }

    // If we still want a position improvement that didn't happen, suggest
    // an alternate from partner at the unfilled weak position.
    const stillWeakPositions = TRADE_POSITIONS.filter((p) => {
      const beforeRank = myTeam.positionRanks[p] ?? 99;
      const inImpact = positionalImpact.find((x) => x.position === p);
      const afterRank = inImpact?.afterRank ?? beforeRank;
      return beforeRank >= totalTeams - 3 && afterRank >= totalTeams - 3;
    });
    for (const pos of stillWeakPositions.slice(0, 1)) {
      const partnerCandidate = partner.players
        .filter(
          (p) =>
            p.position === pos &&
            p.value > Math.max(theirValue * 0.3, 500) &&
            !proposal.theirPlayers.some((tp) => tp.id === p.id),
        )
        .sort((a, b) => a.value - b.value)[0];
      if (partnerCandidate) {
        counters.push({
          type: "ask_for_player",
          side: "add_to_their_side",
          description: `Ask for ${partnerCandidate.name} (their ${pos}); your weakest spot`,
          playerToAdd: partnerCandidate,
        });
      }
    }
  }

  return {
    verdict,
    myValue,
    theirValue,
    delta,
    pctDelta,
    reasoning,
    positionalImpact,
    counters: counters.slice(0, 3),
    jinglesSwing: lean?.swing ?? null,
    partner: partnerAssessment,
    mutual,
    mutualScore,
  };
}
