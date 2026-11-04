import { describe, expect, it } from "vitest";
import { OURS_CUTS, matches, read } from "./engine";
import { nbaBets, type NbaTracked } from "./nba-track";

const cut = (id: string) => OURS_CUTS.find((c) => c.id === id)!.test;

describe("our model as a third vote", () => {
  it("football: agrees when our line sits on the same side of the market as Sam and David", () => {
    // Market home -3; Sam and David both like the home team; ours -5 agrees, ours -1 disagrees.
    const sam = { model: -6, market: -3 }, david = { model: -5, market: -3 };
    expect(matches(read(sam, david, undefined, -5), cut("ours-agree"))).toBe(true);
    expect(matches(read(sam, david, undefined, -1), cut("ours-disagree"))).toBe(true);
    expect(matches(read(sam, david, undefined, -1), cut("ours-agree"))).toBe(false);
    // No read from us: neither cut counts the game.
    expect(matches(read(sam, david), cut("ours-agree"))).toBe(false);
    expect(matches(read(sam, david), cut("ours-disagree"))).toBe(false);
  });

  it("NBA: flags Sam's spread and total by our game model", () => {
    const snap = { at: "2026-11-04T23:00:00Z", line: -4, homePrice: -110, awayPrice: -110, total: 220, overPrice: -110, underPrice: -110, model: -7, modelTotal: 226 };
    const g = { id: "1", day: "20261104", week: 3, tip: "2026-11-05T00:00:00Z", home: "BOS", away: "NYK", first: snap, last: snap, ours: { spread: -2, total: 224 } } as NbaTracked;
    const bets = nbaBets(g);
    expect(bets.find((b) => b.market === "ats")?.ours).toBe("disagree"); // Sam home -4, ours -2 likes the road side
    expect(bets.find((b) => b.market === "ou")?.ours).toBe("agree"); // both over 220
    expect(nbaBets({ ...g, ours: undefined }).find((b) => b.market === "ats")?.ours).toBeUndefined();
  });
});
