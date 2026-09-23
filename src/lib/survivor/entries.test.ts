import { describe, expect, it } from "vitest";
import { deriveFromEntries, parseEntries } from "./entries";

// The 30-entry pool's board, week 3, as it reads off the screen. Ten entries,
// two weeks played, and two of them already carrying a different second week
// from the rest, which is the whole reason entry rows beat percentages.
const BOARD = `
1. Jack Hastings  JAX  SF
2. Marlon Wiley   JAX  SF
3. Mason Fritch   JAX  SF
4. Mike Fritch    JAX  SF
5. Jordan Carter  PIT  SF
6. Luke Fischer   PIT  SF
7. Jared Adams    JAX  CLE
8. Scott Epperson SF   PHI
9. Nick House     DET  SF
10. Jack Burrows  LV   PHI
`;

describe("parseEntries", () => {
  const parsed = parseEntries(BOARD);

  it("reads every row", () => {
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.entries).toHaveLength(10);
    expect(parsed.weeks).toEqual([1, 2]);
  });

  it("keeps the name and the picks apart", () => {
    if (!parsed.ok) return;
    expect(parsed.entries[0]).toEqual({
      name: "Jack Hastings",
      picks: { "1": "JAX", "2": "SF" },
    });
  });

  it("does not read a list number as a week", () => {
    if (!parsed.ok) return;
    expect(parsed.entries[9].name).toBe("Jack Burrows");
    expect(parsed.entries[9].picks).toEqual({ "1": "LV", "2": "PHI" });
  });

  it("takes the separators a board might use", () => {
    const r = parseEntries("Jordan Carter: PIT, SF\nLuke Fischer | PIT | SF");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entries.map((e) => e.name)).toEqual(["Jordan Carter", "Luke Fischer"]);
    expect(r.entries[0].picks["2"]).toBe("SF");
  });

  it("canonicalises the abbreviations boards actually print", () => {
    const r = parseEntries("Someone JAC WSH");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entries[0].picks).toEqual({ "1": "JAX", "2": "WAS" });
  });

  it("says so rather than returning an empty pool", () => {
    const r = parseEntries("Page 1 of 1\nShow: My Picks Eliminated");
    expect(r.ok).toBe(false);
  });
});

describe("deriveFromEntries", () => {
  const parsed = parseEntries(BOARD);
  const entries = parsed.ok ? parsed.entries : [];
  const derived = deriveFromEntries(entries, 2, 3);

  it("counts who is actually left", () => {
    expect(derived.alive).toBe(10);
  });

  it("knows exactly who has burned what, not on average", () => {
    // Five of ten took JAX in week 1. SF is the one worth checking: seven took
    // it in week 2, and Scott Epperson had already spent it in week 1, so
    // EIGHT of ten can never pick it again. A per-week percentage cannot see
    // that eighth entry, which is the entire argument for reading rows.
    expect(derived.burned.JAX).toBeCloseTo(0.5, 5);
    expect(derived.burned.SF).toBeCloseTo(0.8, 5);
  });

  it("names the teams the field can still follow you onto", () => {
    expect(derived.untouched).toContain("KC");
    expect(derived.untouched).not.toContain("JAX");
  });

  it("drops an entry that missed a week", () => {
    const withDead = [...entries, { name: "Gone", picks: { "1": "KC" } }];
    expect(deriveFromEntries(withDead, 2, 3).alive).toBe(10);
  });

  it("reports this week once picks for it are in", () => {
    const withWeek3 = entries.map((e, i) => ({
      ...e,
      picks: { ...e.picks, "3": i < 8 ? "KC" : "BUF" },
    }));
    const d = deriveFromEntries(withWeek3, 2, 3);
    expect(d.picksThisWeek.KC).toBeCloseTo(0.8, 5);
    expect(d.picksThisWeek.BUF).toBeCloseTo(0.2, 5);
  });
});
