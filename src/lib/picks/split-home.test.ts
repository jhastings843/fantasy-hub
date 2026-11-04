import { describe, expect, it } from "vitest";
import { cutResult, cutsFor, gradeGame } from "./engine";

const cut = (league: "nfl" | "cfb", id: string) => cutsFor(league, true).find((c) => c.id === id)!;

describe("split-home slice (Jack, 2026-11-04)", () => {
  // Line 7 home side means home gets 7. Sam 4 (home), David 10 (away): a split.
  const split = (final: { home: number; away: number }) =>
    gradeGame({ week: 10, home: "a", away: "b", sam: { market: 7, model: 4 }, david: { market: 7, model: 10 }, final });

  it("backs the home team on a split, graded at the home model's line", () => {
    expect(cutResult(split({ home: 20, away: 24 }), cut("cfb", "split-home"))).toBe("W"); // lost by 4, +7 covers
    expect(cutResult(split({ home: 10, away: 24 }), cut("cfb", "split-home"))).toBe("L");
  });

  it("skips games where the models agree", () => {
    const g = gradeGame({ week: 10, home: "a", away: "b", sam: { market: 7, model: 4 }, david: { market: 7, model: 3 }, final: { home: 20, away: 24 } });
    expect(cutResult(g, cut("nfl", "split-home"))).toBeUndefined();
  });

  it("is tracked, never a tier candidate, and PEM's cuts no longer are either", () => {
    expect(cut("cfb", "split-home").candidate).toBe(false);
    for (const c of cutsFor("cfb", true).filter((x) => x.group === "PEM, third model")) expect(c.candidate).toBe(false);
  });
});
