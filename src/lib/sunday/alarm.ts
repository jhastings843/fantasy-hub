// What is worth interrupting a Sunday morning for.
//
// Inactive reports land around 11:30 and the early games lock at 13:00. That
// 90 minutes is the only window in the week where the app knows something Jack
// does not and can still be acted on, and it is also the window he is least
// likely to be at a laptop.
//
// The rule this keeps: an alarm that fires every week is an alarm nobody
// reads. So the bar is "this costs you the week if you do not look", not "this
// is interesting". Questionable does not qualify. A player already ruled out,
// an empty slot, a pool with no pick, and a line that has moved hard against
// the pick do.
//
// Pure, and deliberately built on a narrow input shape rather than on the full
// reports, so a Sunday can be simulated without a network.

export type AlarmKind = "no-pick" | "empty-slot" | "unavailable" | "line-move";

export interface AlarmReason {
  kind: AlarmKind;
  text: string;
}

export interface PoolAlarmInput {
  /** Display name, because the whole point is which pool. */
  pool: string;
  pick: string | null;
  winProb: number | null;
  /** The same number at the Thursday send, if it was recorded. */
  baselineWinProb: number | null;
  /** The pick's game has already kicked off, so nothing can be changed. */
  locked: boolean;
}

export interface SlotAlarmInput {
  league: string;
  slot: string;
  /** Null means the slot is empty, which scores zero. */
  player: string | null;
  /** Sleeper's status string, or "Bye". */
  status: string | null;
}

/** Statuses that mean he will not take a snap, or probably will not. */
const UNAVAILABLE = new Set([
  "Out", "IR", "NA", "PUP", "Sus", "Suspended", "DNR", "Doubtful", "Bye", "Inactive",
]);

/**
 * How far a pick's win probability has to fall before Thursday's advice is
 * worth revisiting. Five points is roughly a starting quarterback being ruled
 * out; anything smaller is the line breathing.
 */
const DEFAULT_DROP = 0.05;

/** Worst first, so the subject line and the first card are the real problem. */
const ORDER: AlarmKind[] = ["no-pick", "empty-slot", "unavailable", "line-move"];

export function lockAlarms(input: {
  pools: PoolAlarmInput[];
  slots: SlotAlarmInput[];
  dropThreshold?: number;
}): AlarmReason[] {
  const drop = input.dropThreshold ?? DEFAULT_DROP;
  const out: AlarmReason[] = [];

  for (const p of input.pools) {
    if (!p.pick) {
      out.push({
        kind: "no-pick",
        text: `No pick logged in the ${p.pool}. A pool with no pick is a strike.`,
      });
      continue;
    }
    // A locked game is a decision already made. Telling him the line moved
    // against a pick he cannot change is a notification with no action in it.
    if (p.locked) continue;
    if (p.winProb == null || p.baselineWinProb == null) continue;
    const fall = p.baselineWinProb - p.winProb;
    if (fall > drop) {
      out.push({
        kind: "line-move",
        text: `${p.pick} in the ${p.pool} is down ${(fall * 100).toFixed(1)} points since Thursday, now ${(p.winProb * 100).toFixed(1)}% to win.`,
      });
    }
  }

  for (const s of input.slots) {
    if (!s.player) {
      out.push({
        kind: "empty-slot",
        text: `${s.league}: ${s.slot} is empty and will score nothing.`,
      });
      continue;
    }
    if (s.status && UNAVAILABLE.has(s.status)) {
      out.push({
        kind: "unavailable",
        text: `${s.league}: ${s.player} is ${s.status.toLowerCase()} and is starting at ${s.slot}.`,
      });
    }
  }

  return out.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
}
