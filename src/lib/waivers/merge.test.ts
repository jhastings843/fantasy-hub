import { describe, expect, it } from "vitest";
import { mergePickups, skipLine } from "./merge";
import type { LineupAdvice, SlotAdvice } from "@/lib/lineup/weekly-advice";
import type { StartableTarget } from "./rank";

const player = (playerId: string) => ({ playerId, name: playerId }) as never;
const slot = (s: string, index: number, current: string, recommended: string): SlotAdvice => ({
  slot: s,
  index,
  current: player(current),
  recommended: player(recommended),
  changed: current !== recommended,
  alternative: null,
  reason: "",
});
const target = (add: string, over: string | null): StartableTarget =>
  ({ player: player(add), slot: "FLEX", displaces: over ? player(over) : null, dropFor: null }) as StartableTarget;

function advice(slots: SlotAdvice[]): LineupAdvice {
  return { slots, changes: slots.filter((s) => s.changed), problems: [], superflexFellThrough: false, adjustmentDecided: [] } as unknown as LineupAdvice;
}

describe("mergePickups", () => {
  it("replaces a change whose recommended starter the pickup displaces", () => {
    const a = advice([slot("WR", 0, "a", "a"), slot("FLEX", 1, "bench", "pat")]);
    const { changes, leftover } = mergePickups(a, [target("fa", "pat")]);
    expect(changes).toHaveLength(1);
    expect(changes[0].slot.slot).toBe("FLEX");
    expect(changes[0].pickup?.player.playerId).toBe("fa");
    expect(leftover).toEqual([]);
  });

  it("adds a row for an unchanged slot the pickup takes", () => {
    const a = advice([slot("WR", 0, "a", "a"), slot("FLEX", 1, "bench", "pat")]);
    const { changes } = mergePickups(a, [target("fa", "a")]);
    expect(changes.map((c) => [c.slot.slot, c.pickup?.player.playerId ?? null])).toEqual([
      ["WR", "fa"],
      ["FLEX", null],
    ]);
  });

  it("keeps a pickup with no starter to displace as leftover", () => {
    const { leftover } = mergePickups(advice([slot("WR", 0, "a", "a")]), [target("fa", null)]);
    expect(leftover).toHaveLength(1);
  });

  it("keeps the rostered swap as a fallback when the pickup takes a changed slot", () => {
    const flex = { ...slot("FLEX", 1, "pollard", "hall"), reason: "Start Hall (FLEX 36) over Pollard, at FLEX 37." };
    const { changes } = mergePickups(advice([slot("WR", 0, "a", "a"), flex]), [target("smith", "hall")]);
    expect(skipLine(changes[0])).toBe("If you skip the add: Start Hall (FLEX 36) over Pollard, at FLEX 37.");
  });

  it("has no fallback when the pickup takes a slot that was not changing", () => {
    const { changes } = mergePickups(advice([slot("WR", 0, "a", "a")]), [target("fa", "a")]);
    expect(skipLine(changes[0])).toBeNull();
  });
});
