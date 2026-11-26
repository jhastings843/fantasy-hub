import type { LineupAdvice, SlotAdvice } from "@/lib/lineup/weekly-advice";
import type { StartableTarget } from "./rank";

// Lineup changes and free-agent pickups, as one list.
//
// They used to be two lists, and read top to bottom they contradicted each
// other: "start Freiermuth at FLEX", then further down, "add Ferguson and start
// him over Freiermuth". The pickup is the last word on that slot, so it is
// folded into the slot's row rather than printed after it.

export interface MergedChange {
  slot: SlotAdvice;
  /** Set when a free agent takes this slot instead of the rostered pick. */
  pickup: StartableTarget | null;
}

export function mergePickups(
  advice: LineupAdvice,
  targets: StartableTarget[],
): { changes: MergedChange[]; leftover: StartableTarget[] } {
  const merged = new Map<SlotAdvice, StartableTarget | null>(
    advice.changes.map((s) => [s, null]),
  );
  const leftover: StartableTarget[] = [];

  for (const target of targets) {
    const displaced = target.displaces?.playerId;
    // The slot the displaced player was going to start in, changed or not.
    const slot = displaced
      ? advice.slots.find((s) => s.recommended?.playerId === displaced && !merged.get(s))
      : undefined;
    if (slot) merged.set(slot, target);
    else leftover.push(target);
  }

  const changes = [...merged.entries()]
    .map(([slot, pickup]) => ({ slot, pickup }))
    .sort((a, b) => a.slot.index - b.slot.index);
  return { changes, leftover };
}

/**
 * What to do with the rostered players if Jack skips the free agent.
 *
 * A pickup row replaces the slot's own row, and when that slot was itself a
 * change the change vanished with it. Week 12 Dah Chopped: the email said "Add
 * DeVonta Smith, ahead of Breece Hall" and never said Hall was meant to start
 * over Tony Pollard, so with no safe drop on the bench Jack was left with
 * nothing to act on. Null when the slot's rostered pick is already starting.
 */
export function skipLine(c: MergedChange): string | null {
  if (!c.pickup || !c.slot.changed || !c.slot.reason) return null;
  return `If you skip the add: ${c.slot.reason}`;
}
