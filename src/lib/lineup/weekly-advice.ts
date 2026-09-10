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
/**
 * Slots filled from the FLEX 150 rather than from a position list.
 *
 * SUPER_FLEX is deliberately absent: it takes a quarterback by Jack's rule, and
 * he publishes no quarterbacks in the FLEX 150, so a QB there is quoted from
 * the QB list.
 */
const FLEX_SLOTS = new Set(["FLEX", "WRRB_FLEX", "WRRB_WRT", "REC_FLEX"]);

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
  /**
   * Slots where the app's scoring adjustment, not his ranking, decided who
   * starts.
   *
   * This is the honest disclosure, and it matters because the adjustment is not
   * decoration: `scoreOf` sorts by the adjusted rank when there is one, so a
   * number the app computed can and does override the order he published. Jack
   * asked to see exactly that. Anything listed here is our call, not his.
   *
   * Empty in a league whose scoring already matches the list, because there is
   * no adjustment to make.
   */
  adjustmentDecided: { started: AdvicePlayer; insteadOf: AdvicePlayer | null; slot: string }[];
}

/**
 * The rank to quote for this player in this slot.
 *
 * A flex slot is a comparison across running backs, receivers and tight ends,
 * so it has to be quoted from the one list he publishes that ranks them against
 * each other: the FLEX 150. Quoting a position rank there is not a smaller
 * answer, it is a wrong one. "Josh Downs (FLEX 78). Next best is Kenyon Sadiq
 * (TE 31)" reads as though a TE31 beats a FLEX78, and they are different lists
 * that cannot be compared at all.
 *
 * A player he ranked at his position but left out of the FLEX 150 is therefore
 * labelled as exactly that, rather than given a number that invites the
 * comparison.
 */
function rankLabel(p: AdvicePlayer, slot: string): string {
  if (p.unranked) return "unranked";
  const isFlexSlot = FLEX_SLOTS.has(slot);

  if (isFlexSlot) {
    if (p.flexRank === null) {
      // Outside the 150. Named at his position so he is identifiable, and
      // explicitly outside the list so nobody reads it as a flex rank.
      return p.positionalRank !== null
        ? `${p.position} ${p.positionalRank}, outside his FLEX 150`
        : "outside his FLEX 150";
    }
    // The number that DECIDED comes first. This used to read "FLEX 108, 86
    // adjusted" against "FLEX 93, 98 adjusted", and skimmed at speed that says
    // 108 beat 93, which is backwards and is exactly how it was read. The
    // adjusted rank is what the lineup sorts by, so it leads, and his own
    // number follows attributed to him.
    if (p.adjustedFlexRank !== null && p.adjustedFlexRank !== p.flexRank) {
      return `FLEX ${p.adjustedFlexRank} here, ${p.flexRank} on his list`;
    }
    return `FLEX ${p.flexRank}`;
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

/**
 * Whether a player has no game this week.
 *
 * Jack's rule, and it is stronger than anything derived from team codes: if he
 * ranked the player, the player has a game. Every row in his list carries a
 * matchup, so he cannot rank somebody who is not playing.
 *
 * The first version of this asked only whether the player's team appeared in
 * the week's fixtures, comparing the code he writes against the code Sleeper
 * writes without normalising either. He writes JAC and Sleeper says JAX, so
 * every Jacksonville player came back on bye, in week 1, when no team is on
 * bye at all. Two of them were starters and the email told Jack to bench both.
 *
 * `teamsPlaying` must already be normalised by the caller.
 */
export function isOnBye(input: {
  ranked: boolean;
  team: string | null;
  teamsPlaying: Set<string>;
}): boolean {
  if (input.ranked) return false;
  if (!input.team) return false;
  return !input.teamsPlaying.has(input.team);
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

  // Solve again with the adjustment stripped, and diff the two lineups. That
  // is the only way to answer "did our number change the answer, or merely
  // decorate it", and it is cheap: the solver is a sort and a scan.
  //
  // Guarded so it runs only when an adjustment exists at all, which keeps the
  // half-PPR league from paying for a second solve that cannot differ.
  const hasAdjustment = roster.some(
    (p) => p.adjustedFlexRank !== null && p.adjustedFlexRank !== p.flexRank,
  );
  const adjustmentDecided: LineupAdvice["adjustmentDecided"] = [];
  if (hasAdjustment) {
    const raw = adviseLineup({
      rosterPositions,
      roster: roster.map((p) => ({ ...p, adjustedFlexRank: null })),
      currentStarters,
      superflexPrefersQb,
    });
    const rawStarters = new Set(
      raw.slots.map((s) => s.recommended?.playerId).filter(Boolean) as string[],
    );
    const adjustedStarters = new Set(
      advice.map((s) => s.recommended?.playerId).filter(Boolean) as string[],
    );

    // Who lost their place, which is not the same as who moved slot. In the
    // test case a tight end lifted by the premium takes the TE slot and the
    // tight end who was there slides into a flex slot; the player actually
    // benched is the one at the bottom of the flex list. Naming the slot's
    // previous occupant would have said the wrong name.
    const displacedQueue = raw.slots
      .map((s) => s.recommended)
      .filter((p): p is AdvicePlayer => Boolean(p) && !adjustedStarters.has(p!.playerId))
      .sort((a, b) => scoreOf(a) - scoreOf(b));

    for (const s of advice) {
      const p = s.recommended;
      if (!p || rawStarters.has(p.playerId)) continue;
      adjustmentDecided.push({
        started: p,
        insteadOf: displacedQueue.shift() ?? null,
        slot: s.slot,
      });
    }
  }

  return {
    slots: advice,
    changes: advice.filter((s) => s.changed),
    problems,
    superflexFellThrough,
    adjustmentDecided,
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

  // "he has him at" cannot front a number that is partly ours. The label now
  // carries its own attribution, so the sentence just points at it.
  const why = current.onBye
    ? "on bye"
    : cannotPlay(current)
      ? `listed ${current.injuryStatus}`
      : current.unranked
        ? "not in his list this week"
        : `at ${rankLabel(current, slot)}`;

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
/**
 * How much the adjustment has to win by before it may overrule his order.
 *
 * Measured, not chosen. On the real Week 1 flex list the points-per-rank
 * gradient through the middle of his list is 0.043 (ranks 75-100) and 0.078
 * (50-75), while the average scoring delta is 2.82 for a tight end, 1.98 for a
 * receiver and 1.15 for a back. A tight end's delta against that gradient is
 * worth about sixty-five ranks, which is why 139 of 150 players moved and
 * thirty of them moved fifteen places or more.
 *
 * That movement is not wrong in direction. In a full-PPR league with a tight end
 * premium, tight ends genuinely are worth more than a half-PPR list says. It is
 * wrong in confidence: of the 62 places the adjustment inverted his order, 61
 * did it on a margin under half a point, and a weekly projection cannot resolve
 * half a point. George Kittle beat Brian Thomas by 0.59.
 *
 * A point is roughly what the delta itself is uncertain by: it is half a point
 * per reception, on a reception count that projects with an error over one. So
 * below a point the honest answer is that we cannot tell them apart, and a
 * human ranker who watches the tape is the better tiebreak than a projection
 * that does not.
 */
export const ADJUSTMENT_MARGIN = 1.0;

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
    return { playerId: e.playerId, rank: e.rank, value: base + delta };
  });

  // Sorted by adjusted value, but only where the adjustment has earned it.
  //
  // Two players inside ADJUSTMENT_MARGIN of each other keep HIS order, because
  // that is the more reliable signal at that distance. This is a comparator
  // with a dead zone, so it is applied as an insertion pass over his order
  // rather than as a sort: a dead zone is not transitive and a sort given an
  // intransitive comparator produces whatever the algorithm happens to do.
  const byHisRank = [...scored].sort((a, b) => a.rank - b.rank);
  const ordered: typeof byHisRank = [];
  for (const player of byHisRank) {
    // Walk back past anyone this player beats by more than the margin.
    let at = ordered.length;
    while (at > 0 && player.value - ordered[at - 1].value > ADJUSTMENT_MARGIN) at--;
    ordered.splice(at, 0, player);
  }

  const out = new Map<string, number>();
  ordered.forEach((s, i) => out.set(s.playerId, i + 1));
  return out;
}
