// How close this roster is to a bad week, looking forward.
//
// The chop simulation answers "how likely is my best lineup to be the low
// score". That is the right question, and it is also the flattering one: it
// assumes the lineup is set correctly, every starter plays, and the roster
// can absorb an injury. The research behind this module (see
// docs/guillotine-strategy.md, "The weekly spend trigger") says the things
// that actually get a safe-looking team chopped are structural: a starter
// left in the lineup who will not play, a questionable tag with no cover, and
// a bench that cannot replace anyone. Those are forward-looking and checkable
// before kickoff, unlike last week's score, which is mostly noise.

import { bestLineup, type LineupPlayer } from "./lineup";

export interface FragilityPlayer extends LineupPlayer {
  name: string;
  injuryStatus: string | null;
}

/** A submitted starter projected under this is a hole, not a starter. */
const HOLE_POINTS = 3;

/** Losing this much from one absence marks a slot as thin. */
const THIN_LOSS = 6;

/** Tags that mean the player may well not play, but has not been ruled out. */
const SHAKY = new Set(["Questionable", "Doubtful"]);

/** Two shaky starters is a lineup that could lose two slots on Sunday morning. */
const SHAKY_STARTERS_TO_WORRY = 2;

export interface OneOut {
  name: string;
  slot: string;
  /** What the best lineup projects with this player removed. */
  total: number;
  loss: number;
}

export interface Fragility {
  /** The best legal lineup's projection. What the simulation ran on. */
  bestTotal: number;
  /** The lineup as currently submitted on Sleeper, or null when none is set. */
  submittedTotal: number | null;
  /** How far the submitted lineup trails the best one. Zero when unset. */
  submittedGap: number;
  /** Submitted starters who will not, or barely will, score. */
  submittedHoles: string[];
  /** Best-lineup starters carrying a questionable or doubtful tag. */
  shakyStarters: string[];
  /** The single absence that hurts most. */
  worstOneOut: OneOut | null;
  /** Slots where the bench replacement gives up THIN_LOSS or more. */
  thinSlots: string[];
  /**
   * True when one ordinary Sunday event (an injury, an inactive) would put
   * this roster inside the range where the low score lands.
   */
  fragile: boolean;
  /** Why, in plain words. Empty when the roster is sound. */
  reasons: string[];
}

export interface FragilityInput {
  players: FragilityPlayer[];
  /** Sleeper's roster.starters. Empty slots come through as "0". */
  submittedStarters: string[];
  rosterPositions: string[];
  /** 10th to 90th percentile of where the chop line lands. */
  chopLineRange: [number, number];
}

const label = (p: FragilityPlayer, slot: string) => `${slot} ${p.name}`;

export function assessFragility(input: FragilityInput): Fragility {
  const { players, submittedStarters, rosterPositions, chopLineRange } = input;
  const byId = new Map(players.map((p) => [p.playerId, p]));

  const best = bestLineup(players, rosterPositions);
  const bestTotal = best.slots.reduce((sum, s) => sum + (s.player?.points ?? 0), 0);
  const starters = best.slots.filter(
    (s): s is typeof s & { player: LineupPlayer } => s.player !== null,
  );

  // --- The lineup as actually set ---
  const isEmpty = (id: string) => !id || id === "0";
  const anySet = submittedStarters.some((id) => !isEmpty(id));
  let submittedTotal: number | null = null;
  const submittedHoles: string[] = [];
  if (anySet) {
    submittedTotal = 0;
    submittedStarters.forEach((id, index) => {
      const slot = rosterPositions[index] ?? "?";
      const p = isEmpty(id) ? undefined : byId.get(id);
      if (!p) {
        submittedHoles.push(`${slot} empty`);
        return;
      }
      submittedTotal! += p.points;
      if (p.points < HOLE_POINTS) {
        const why = p.injuryStatus ? p.injuryStatus : `${p.points.toFixed(1)} projected`;
        submittedHoles.push(`${label(p, slot)} (${why})`);
      }
    });
  }
  const submittedGap = submittedTotal == null ? 0 : Math.max(0, bestTotal - submittedTotal);

  // --- Who might not play ---
  const shakyStarters = starters
    .filter((s) => SHAKY.has((byId.get(s.player.playerId)?.injuryStatus ?? "") as string))
    .map((s) => {
      const p = byId.get(s.player.playerId)!;
      return `${label(p, s.slot)} (${p.injuryStatus})`;
    });

  // --- One absence at a time ---
  let worstOneOut: OneOut | null = null;
  const thinSlots: string[] = [];
  for (const s of starters) {
    const without = players.filter((p) => p.playerId !== s.player.playerId);
    const total = bestLineup(without, rosterPositions).slots.reduce(
      (sum, x) => sum + (x.player?.points ?? 0),
      0,
    );
    const loss = bestTotal - total;
    const p = byId.get(s.player.playerId)!;
    if (loss >= THIN_LOSS) thinSlots.push(`${label(p, s.slot)}: bench cover is ${loss.toFixed(1)} worse`);
    if (!worstOneOut || total < worstOneOut.total) {
      worstOneOut = { name: p.name, slot: s.slot, total, loss };
    }
  }

  // --- The call ---
  const reasons: string[] = [];
  const [, lineHigh] = chopLineRange;

  if (worstOneOut && worstOneOut.total <= lineHigh) {
    reasons.push(
      `Lose ${worstOneOut.name} and you project ${worstOneOut.total.toFixed(1)}, inside the range where the low score lands (up to ${lineHigh.toFixed(0)}).`,
    );
  }
  if (shakyStarters.length >= SHAKY_STARTERS_TO_WORRY) {
    reasons.push(
      `${shakyStarters.length} starters carry an injury tag: ${shakyStarters.join(", ")}. Two game-time decisions with no late alternative is how a safe week turns.`,
    );
  }

  return {
    bestTotal,
    submittedTotal,
    submittedGap,
    submittedHoles,
    shakyStarters,
    worstOneOut,
    thinSlots,
    fragile: reasons.length > 0,
    reasons,
  };
}

/**
 * The lineup-as-set warning, separate from fragility because the fix is
 * free: set the lineup. It never changes the posture, since buying a player
 * does not solve a starter left in the lineup by mistake.
 */
export function submittedLineupNote(f: Fragility): string | null {
  if (f.submittedTotal == null) return null;
  if (f.submittedHoles.length === 0 && f.submittedGap < HOLE_POINTS) return null;
  const holes = f.submittedHoles.length > 0 ? ` Holes: ${f.submittedHoles.join(", ")}.` : "";
  return `Your lineup as set on Sleeper projects ${f.submittedTotal.toFixed(1)}, ${f.submittedGap.toFixed(1)} under your best lineup.${holes} Fix that before bidding; it costs nothing.`;
}
