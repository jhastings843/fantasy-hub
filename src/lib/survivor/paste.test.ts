import { describe, expect, it } from "vitest";
import { formatPickPaste, parsePickPaste } from "./paste";

const big = { entriesAlive: 375, poolSize: 500 };
const small = { entriesAlive: 20, poolSize: 30 };

describe("parsePickPaste", () => {
  it("reads percentages with any separator and ignores junk lines", () => {
    const r = parsePickPaste("Week 1 picks\nLAC - 32.2%\njax\t21.7\nDET: 18.2 %\nXYZ 9\nnope", big);
    expect(r).toEqual({ ok: true, read: "percent", picks: { LAC: 32.2, JAX: 21.7, DET: 18.2 } });
  });

  it("reads a small pool's counts and converts them to percentages", () => {
    const r = parsePickPaste("LAC 11\nJAX 7\nDET 12", small);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.read).toBe("count");
    expect(r.picks.LAC).toBeCloseTo(36.667, 2);
    expect(r.picks.JAX + r.picks.LAC + r.picks.DET).toBeCloseTo(100, 6);
  });

  it("accepts an earlier week's count that sums above today's entries alive", () => {
    // Week 1 in a 30-entry pool summed to 30; by now only 20 are alive. Editing
    // that week must still read as a count, not be refused.
    const r = parsePickPaste("LAC 18\nJAX 12", small);
    expect(r).toMatchObject({ ok: true, read: "count" });
  });

  it("refuses totals that are neither a distribution nor a plausible count", () => {
    expect(parsePickPaste("LAC 30\nJAX 10", big)).toMatchObject({ ok: false });
    expect(parsePickPaste("LAC 400\nJAX 300", big)).toMatchObject({ ok: false });
    expect(parsePickPaste("LAC 3\nJAX 4", small)).toMatchObject({ ok: false });
  });

  it("needs at least two real teams", () => {
    expect(parsePickPaste("LAC 100%", big)).toMatchObject({ ok: false });
    expect(parsePickPaste("", big)).toMatchObject({ ok: false });
  });
});

describe("formatPickPaste", () => {
  it("lists the biggest share first and round-trips through the parser", () => {
    const text = formatPickPaste({ DET: 18.2, LAC: 32.2, JAX: 21.7, PHI: 18.2 });
    expect(text).toBe("LAC 32.2%\nJAX 21.7%\nDET 18.2%\nPHI 18.2%");
    expect(parsePickPaste(text, big)).toEqual({
      ok: true, read: "percent", picks: { LAC: 32.2, JAX: 21.7, DET: 18.2, PHI: 18.2 },
    });
  });
});
