import { bestLineup, slotAccepts, startingSlots, type LineupPlayer } from "./solve";

// Who to start this week, from his weekly rankings and the league's own slots.
//
// The rule this follows, and the reason it is not just "sort by points": his
// rank is the answer. Sleeper's projections appear here in exactly one place,
// which is measuring how far a league's scoring pulls away from the half-PPR
// list he publishes. They never decide who is better.
//
// Everything in this file is pure. The fetching lives in build.ts, so the
// decisions can be tested without a network.

/** Injury statuses that mean a player should not be in a lineup. */
const CANNOT_PLAY = new Set(["out", "ir", "pup", "sus", "dnr", "na", "doubtful"]);

/**
 * Score bands, so one number per player can express his ordering to a solver
 * written for points.
 *
 * bestLineup compares players with a single number, so a player who is eligible
 * for both an RB slot and a FLEX slot needs one score, not one per slot. The
 * FLEX 150 is what makes that possible: it is his own cross-position ordering
 * of exactly the positions that compete for more than one slot, and it agrees
 * with his positional lists, so an RB slot filled from a flex score still gets
 * his best available back.
 *
 * The bands never interleave, which is the point. A player he ranked in a
 * position list but left out of the FLEX 150 is genuinely behind the 150 he
 * ranked, and a player he did not rank at all is behind both.
 */
const BAND_FLEX = 1_000_000;
const BAND_POSITIONAL = 500_000;
const BAND_UNRANKED = 1_000;

export interface AdvicePlayer {
  playerId: string;
  name: string;
  position: string;
  team: string | null;
  /** His rank in the position list, when he ranked the player there. */
  positionalRank: number | null;
  /** His rank in the FLEX 150, for RB, WR and TE only. */
  flexRank: number | null;
  /** The FLEX rank after this league's scoring is accounted for. */
  adjustedFlexRank: number | null;
  opponent: string | null;
  home: boolean | null;
  injuryStatus: string | null;
  onBye: boolean;
  /** True when he ranked this player nowhere. */
  unranked: boolean;
}

export interface SlotAdvice {
  slot: string;
  /** Position in the league's roster_positions, so a slot can be matched to Sleeper's starters array. */
  index: number;
  current: AdvicePlayer | null;
  recommended: AdvicePlayer | null;
  changed: boolean;
  /** The next best player who could have taken this slot and did not. */
  alternative: AdvicePlayer | null;
  reason: string;
}

export interface LineupAdvice {
  slots: SlotAdvice[];
  /** Only the slots where the recommendation differs from what is set now. */
  changes: SlotAdvice[];
  /** Players currently starting who he did not rank, on bye, or ruled out. */
  problems: { player: AdvicePlayer; why: string }[];
  /** True when the superflex slot fell through to a non-quarterback. */
  superflexFellThrough: boolean;
}

function rankLabel(p: AdvicePlayer, slot: string): string {
  if (p.unranked) return "unranked";
  const flexSlot = slot !== p.position && p.flexRank !== null;
  if (flexSlot) {
    const adjusted =
      p.adjustedFlexRank !== null && p.adjustedFlexRank !== p.flexRank
        ? `, ${p.adjustedFlexRank} adjusted`
        : "";
    return `FLEX ${p.flexRank}${adjusted}`;
  }
  if (p.positionalRank !== null) return `${p.position} ${p.positionalRank}`;
  return p.flexRank !== null ? `FLEX ${p.flexRank}` : "unranked";
}

function matchup(p: AdvicePlayer): string {
  if (!p.opponent) return "";
  return ` ${p.home ? "vs" : "@"} ${p.opponent}`;
}

/** The single number bestLineup ranks this player by. */
export function scoreOf(p: AdvicePlayer): number {
  const flex = p.adjustedFlexRank ?? p.flexRank;
  if (flex !== null) return BAND_FLEX - flex;
  if (p.positionalRank !== null) return BAND_POSITIONAL - p.positionalRank;
  return BAND_UNRANKED;
}

export function cannotPlay(p: AdvicePlayer): boolean {
  if (p.onBye) return true;
  const s = (p.injuryStatus ?? "").trim().toLowerCase();
  return s.length > 0 && CANNOT_PLAY.has(s);
}

/**
 * Best legal lineup, and what it differs from.
 *
 * `currentStarters` is Sleeper's own starters array: one entry per starting
 * slot, in roster_positions order, with an empty string or "0" for an empty
 * slot.
 */
export function adviseLineup(input: {
  rosterPositions: string[];
  roster: AdvicePlayer[];
  currentStarters: string[];
  /** True for a league whose SUPER_FLEX should take a quarterback. */
  superflexPrefersQb?: boolean;
}): LineupAdvice {
  const { rosterPositions, roster, currentStarters } = input;
  const superflexPrefersQb = input.superflexPrefersQb ?? true;

  const slots = startingSlots(rosterPositions);
  const byId = new Map(roster.map((p) => [p.playerId, p]));
  const available = roster.filter((p) => !cannotPlay(p));

  const assigned = new Map<number, AdvicePlayer>();
  const taken = new Set<string>();

  // SUPER_FLEX is resolved before the solve, not by it.
  //
  // bestLineup fills the most restrictive slot first, so SUPER_FLEX goes last,
  // and quarterbacks sit in a band below every flex-ranked player because he
  // publishes no quarterbacks in the FLEX 150. Left to the solver the slot
  // takes a running back every time. Jack's rule is that superflex is a
  // quarterback unless injuries prevent it, so the quarterbacks are seated
  // first and their slots removed.
  let superflexFellThrough = false;
  const superflexIndexes = slots
    .map((s, i) => (s === "SUPER_FLEX" ? i : -1))
    .filter((i) => i >= 0);

  if (superflexPrefersQb && superflexIndexes.length > 0) {
    const qbSlotIndexes = slots.map((s, i) => (s === "QB" ? i : -1)).filter((i) => i >= 0);
    const quarterbacks = available
      .filter((p) => p.position === "QB")
      .sort((a, b) => scoreOf(b) - scoreOf(a));

    const seats = [...qbSlotIndexes, ...superflexIndexes];
    for (const seat of seats) {
      const pick = quarterbacks.find((q) => !taken.has(q.playerId));
      if (!pick) {
        // Not enough startable quarterbacks. The superflex seat goes back to
        // the solver rather than being left empty, and the report says so.
        if (superflexIndexes.includes(seat)) superflexFellThrough = true;
        continue;
      }
      taken.add(pick.playerId);
      assigned.set(seat, pick);
    }
  }

  const remainingSlotIndexes = slots
    .map((_, i) => i)
    .filter((i) => !assigned.has(i));
  const remainingSlots = remainingSlotIndexes.map((i) => slots[i]);
  const remainingPlayers: LineupPlayer[] = available
    .filter((p) => !taken.has(p.playerId))
    .map((p) => ({ playerId: p.playerId, position: p.position, points: scoreOf(p) }));

  const solved = bestLineup(remainingPlayers, remainingSlots);
  solved.slots.forEach((filled, n) => {
    const slotIndex = remainingSlotIndexes[n];
    if (filled.player) {
      assigned.set(slotIndex, byId.get(filled.player.playerId)!);
      taken.add(filled.player.playerId);
    }
  });

  // What counts as a change is a player entering the lineup, not a player
  // moving between slots.
  //
  // Slot-by-slot comparison reports a permutation as a change, and it is not
  // one: on 2026-09-09 Dah Dynasty came back with five "changes" that were the
  // same ten players in a different order, because his best back happened to be
  // sitting in the second RB slot rather than the first. Nobody has to do
  // anything about that, and an email that opens with five imaginary jobs is
  // worse than no email. Jack asked for only what needs changing, and this is
  // what that means.
  const startingNow = new Set(currentStarters.filter((id) => id && id !== "0"));
  const startingAfter = new Set(
    [...assigned.values()].map((p) => p.playerId),
  );
  /** Currently starting, and not in the recommended lineup at all. */
  const leaving = currentStarters
    .filter((id) => id && id !== "0" && !startingAfter.has(id))
    .map((id) => byId.get(id))
    .filter((p): p is AdvicePlayer => Boolean(p))
    .sort((a, b) => scoreOf(a) - scoreOf(b));
  const leavingQueue = [...leaving];

  const advice: SlotAdvice[] = slots.map((slot, index) => {
    const recommended = assigned.get(index) ?? null;
    const currentId = currentStarters[index];
    const current =
      currentId && currentId !== "0" ? (byId.get(currentId) ?? null) : null;
    const changed = recommended !== null && !startingNow.has(recommended.playerId);

    // The best eligible player who is not in the lineup at all, which is what
    // makes a recommendation arguable rather than asserted.
    const alternative =
      available
        .filter((p) => !taken.has(p.playerId) && slotAccepts(slot, p.position))
        .sort((a, b) => scoreOf(b) - scoreOf(a))[0] ?? null;

    // Who this player is actually replacing. When the slot's current occupant
    // is staying in the lineup elsewhere, the person being dropped is somebody
    // else, and naming the wrong one reads as nonsense.
    const displaced =
      changed && recommended
        ? current && !startingAfter.has(current.playerId)
          ? current
          : (leavingQueue[0] ?? null)
        : current;
    // Claimed, so a second change cannot name the same person again. Without
    // this, a lineup with two players coming out reported both slots as
    // replacing the first of them.
    if (changed && displaced) {
      const at = leavingQueue.findIndex((p) => p.playerId === displaced.playerId);
      if (at >= 0) leavingQueue.splice(at, 1);
    }

    return {
      slot,
      index,
      current,
      recommended,
      changed,
      alternative,
      reason: reasonFor(slot, displaced, recommended, alternative, changed),
    };
  });

  const problems: { player: AdvicePlayer; why: string }[] = [];
  for (const [index, id] of currentStarters.entries()) {
    if (!id || id === "0") continue;
    const p = byId.get(id);
    if (!p) continue;
    if (index >= slots.length) continue;
    if (p.onBye) problems.push({ player: p, why: "on bye this week" });
    else if (cannotPlay(p)) problems.push({ player: p, why: `listed ${p.injuryStatus}` });
    else if (p.unranked) problems.push({ player: p, why: "not in his list this week" });
  }

  return {
    slots: advice,
    changes: advice.filter((s) => s.changed),
    problems,
    superflexFellThrough,
  };
}

function reasonFor(
  slot: string,
  current: AdvicePlayer | null,
  recommended: AdvicePlayer | null,
  alternative: AdvicePlayer | null,
  changed: boolean,
): string {
  if (!recommended) return "No eligible player for this slot.";

  const rec = `${recommended.name} (${rankLabel(recommended, slot)})${matchup(recommended)}`;

  if (!changed) {
    if (!alternative) return `${rec}. Nothing else on the bench can take this slot.`;
    return `${rec}. Next best is ${alternative.name} (${rankLabel(alternative, slot)}).`;
  }

  if (!current) {
    const next = alternative
      ? ` Next best is ${alternative.name} (${rankLabel(alternative, slot)}).`
      : "";
    return `Slot is empty. Start ${rec}.${next}`;
  }

  const why = current.onBye
    ? "on bye"
    : cannotPlay(current)
      ? `listed ${current.injuryStatus}`
      : current.unranked
        ? "not in his list this week"
        : `he has him at ${rankLabel(current, slot)}`;

  return `Start ${rec} over ${current.name}, ${why}.`;
}

/**
 * His FLEX 150 re-ordered for a league whose scoring is not the half PPR he
 * ranked for.
 *
 * The adjustment is measured, not invented, and it is deliberately small in
 * scope: his order is the baseline and a player only moves by what the scoring
 * difference is actually worth to him in projected points.
 *
 * 1. Build a points curve from his own order. Take the half-PPR projection of
 *    every player in the list, sort descending, and read off the value at his
 *    rank. That gives rank r a point value with realistic spacing between ranks
 *    without asserting the player at rank r will score it.
 * 2. Add the difference between what this league pays that player and what the
 *    list's scoring pays him. In a full-PPR league that is half a point per
 *    projected reception; in Dah Dynasty it is that plus the tight end premium.
 * 3. Re-rank.
 *
 * A player with no projection gets a zero delta and keeps his rank, which is
 * the honest answer rather than a guessed one.
 */
export function adjustedFlexRanks(
  flex: { playerId: string | null; rank: number }[],
  listPoints: Map<string, number>,
  leaguePoints: Map<string, number>,
): Map<string, number> {
  const withIds = flex.filter(
    (e): e is { playerId: string; rank: number } => typeof e.playerId === "string",
  );
  if (withIds.length === 0) return new Map();

  const curve = withIds
    .map((e) => listPoints.get(e.playerId) ?? 0)
    .sort((a, b) => b - a);

  const scored = withIds.map((e) => {
    const base = curve[e.rank - 1] ?? curve[curve.length - 1] ?? 0;
    const list = listPoints.get(e.playerId);
    const league = leaguePoints.get(e.playerId);
    const delta = list === undefined || league === undefined ? 0 : league - list;
    return { playerId: e.playerId, value: base + delta };
  });

  scored.sort((a, b) => b.value - a.value);

  const out = new Map<string, number>();
  scored.forEach((s, i) => out.set(s.playerId, i + 1));
  return out;
}
