import { describe, expect, it } from "vitest";
import { after, type Hypothesis, type Opportunity } from "./model";

// Jack, 2026-11-03: a slice registered Thursday counts that weekend's games,
// even though they were first logged Tuesday, because none had kicked off.
const h = { id: "nfl:su:ours", registeredAt: "2026-10-30T11:00:02.681Z" } as Hypothesis;
const opp = (key: string, firstAt: string, kickoff?: string) =>
  ({ key, league: "nfl", week: 8, first: { at: firstAt, ref: kickoff ? { kickoff } : undefined }, last: { at: firstAt, ref: kickoff ? { kickoff } : undefined } }) as unknown as Opportunity;

describe("after: games that kick off after registration", () => {
  it("counts a game first seen before registration that kicks off after it", () => {
    expect(after(h, [opp("sun", "2026-10-27T15:00:08Z", "2026-11-01T17:00Z")]).map((o) => o.key)).toEqual(["sun"]);
  });
  it("skips a game that kicked off before registration", () => {
    expect(after(h, [opp("tnf", "2026-10-27T15:00:08Z", "2026-10-30T00:15Z")])).toEqual([]);
  });
  it("falls back to first seen when no kickoff was saved", () => {
    const os = [opp("old", "2026-10-29T12:00:00Z"), opp("new", "2026-10-31T12:00:00Z")];
    expect(after(h, os).map((o) => o.key)).toEqual(["new"]);
  });
  it("takes a later start when given one (a source's last state change)", () => {
    expect(after(h, [opp("sun", "2026-10-27T15:00:08Z", "2026-11-01T17:00Z")], "2026-11-02T00:00:00Z")).toEqual([]);
  });
});
