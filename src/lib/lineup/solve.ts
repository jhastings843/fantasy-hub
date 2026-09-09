// Solve the best legal starting lineup for a roster.
//
// This is the load-bearing primitive for the whole advisor. Two questions both
// reduce to it: "what will this team score next week" (fill their slots with
// their best players) and "what is this free agent worth to me" (solve my
// lineup with him and without him, and take the difference).
//
// The second question is why raw projections are not enough. A 14-point
// receiver is worth 14 points to a team starting a 6-point receiver and worth
// zero to a team already starting four better ones. Bidding on projections
// instead of marginal starting points is how you spend $200 on a bench player.

/** Slot eligibility, widest kinds last. BN, IR and TAXI are not starting slots. */
const SLOT_ELIGIBILITY: Record<string, string[]> = {
  QB: ["QB"],
  RB: ["RB"],
  WR: ["WR"],
  TE: ["TE"],
  K: ["K"],
  DEF: ["DEF"],
  DST: ["DEF"],
  FLEX: ["RB", "WR", "TE"],
  WRRB_FLEX: ["RB", "WR"],
  WRRB_WRT: ["RB", "WR", "TE"],
  REC_FLEX: ["WR", "TE"],
  SUPER_FLEX: ["QB", "RB", "WR", "TE"],
  IDP_FLEX: ["DL", "LB", "DB"],
};

const BENCH_SLOTS = new Set(["BN", "IR", "TAXI", "RES"]);

export interface LineupPlayer {
  playerId: string;
  position: string;
  /** Projected points for the week under this league's scoring. */
  points: number;
}

export interface FilledSlot {
  slot: string;
  player: LineupPlayer | null;
  /** Set when the slot could not be filled, so the report can say why. */
  emptyReason?: "no eligible player";
}

export interface Lineup {
  slots: FilledSlot[];
  total: number;
  /** Rostered players who did not crack the lineup. */
  bench: LineupPlayer[];
}

/** The starting slots from a Sleeper roster_positions array, bench removed. */
export function startingSlots(rosterPositions: string[]): string[] {
  return rosterPositions.filter((p) => !BENCH_SLOTS.has(p));
}

export function slotAccepts(slot: string, position: string): boolean {
  const eligible = SLOT_ELIGIBILITY[slot];
  if (!eligible) return false;
  return eligible.includes(position);
}

/**
 * Best legal lineup.
 *
 * Fills the most restrictive slots first, which is optimal here rather than
 * merely convenient: fantasy slot eligibility is a nested family (RB fits RB
 * and FLEX and SUPER_FLEX, never something disjoint), and greedy assignment on
 * a nested family cannot be beaten. It would be wrong for a slot that took, say,
 * only QB and TE, which no real format has.
 */
export function bestLineup(players: LineupPlayer[], rosterPositions: string[]): Lineup {
  const slots = startingSlots(rosterPositions);
  const order = slots
    .map((slot, index) => ({ slot, index, width: SLOT_ELIGIBILITY[slot]?.length ?? 99 }))
    .sort((a, b) => a.width - b.width || a.index - b.index);

  const available = [...players].sort((a, b) => b.points - a.points);
  const taken = new Set<string>();
  const filled = new Map<number, FilledSlot>();

  for (const { slot, index } of order) {
    const pick = available.find(
      (p) => !taken.has(p.playerId) && slotAccepts(slot, p.position),
    );
    if (pick) {
      taken.add(pick.playerId);
      filled.set(index, { slot, player: pick });
    } else {
      filled.set(index, { slot, player: null, emptyReason: "no eligible player" });
    }
  }

  const ordered = slots.map((slot, index) => filled.get(index) ?? { slot, player: null });
  const total = ordered.reduce((sum, s) => sum + (s.player?.points ?? 0), 0);
  const bench = available.filter((p) => !taken.has(p.playerId));

  return { slots: ordered, total, bench };
}

/**
 * Points this player would add to the starting lineup, and who he would push
 * out. Zero when he would not start.
 */
export function marginalValue(
  roster: LineupPlayer[],
  candidate: LineupPlayer,
  rosterPositions: string[],
): { gain: number; displaces: LineupPlayer | null; slot: string | null } {
  const before = bestLineup(roster, rosterPositions);
  const after = bestLineup([...roster, candidate], rosterPositions);
  const gain = after.total - before.total;

  if (gain <= 0) return { gain: 0, displaces: null, slot: null };

  const slot = after.slots.find((s) => s.player?.playerId === candidate.playerId);
  const startedBefore = new Set(
    before.slots.map((s) => s.player?.playerId).filter(Boolean) as string[],
  );
  const startsAfter = new Set(
    after.slots.map((s) => s.player?.playerId).filter(Boolean) as string[],
  );
  const pushedOutId = [...startedBefore].find((id) => !startsAfter.has(id)) ?? null;
  const displaces = pushedOutId
    ? (roster.find((p) => p.playerId === pushedOutId) ?? null)
    : null;

  return { gain, displaces, slot: slot?.slot ?? null };
}

/**
 * The starting slots costing you the most, weakest first.
 *
 * Weakness is measured against the rest of the lineup rather than an external
 * baseline, because in a 16-team league with eight starters everyone's worst
 * slot looks bad in isolation and the question is only ever which of yours to
 * fix first.
 */
export function weakestSlots(lineup: Lineup, count = 3): FilledSlot[] {
  return [...lineup.slots]
    .sort((a, b) => (a.player?.points ?? -1) - (b.player?.points ?? -1))
    .slice(0, count);
}
