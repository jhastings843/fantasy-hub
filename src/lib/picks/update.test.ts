import { describe, expect, it } from "vitest";
import { type StrategyBoard, tierBoard } from "./engine";
import { gradeIssued, type IssuedRecord } from "./issued";
import { diffUpdate, firstSends, updateMatters } from "./update";
import { stakeBoard } from "./test-helpers";

const staked = <T extends Parameters<typeof stakeBoard>[0]>(b: T) => stakeBoard(b, { t1: { w: 14, l: 2 } }, 7).board;
import type { PicksReport } from "./report";

const rule = { rule: { test: { side: "dog" } }, second: null } as unknown as StrategyBoard;
const ref = (line: number) => ({ line, source: "DraftKings via ESPN", fetchedAt: "2026-10-10T13:30:00Z", homePrice: -110, awayPrice: -110 });
// Both models on the home dog: home model lines below the market.
const row = (home: string, line: number, sam = 1, david = 0) => ({
  home, away: `A-${home}`, sam: { market: line, model: sam }, david: { market: line, model: david }, ref: ref(line),
});

const tuesday: IssuedRecord = {
  league: "cfb", season: 2026, week: 7, slot: "tue", issuedAt: "t", provenance: "issued", subject: "s", ruleVersion: "v",
  rule: null, second: null, suMethod: { id: "avg", label: "a" }, su: [], unverified: [],
  plays: [
    { home: "H1", away: "A-H1", tier: "t1", side: "home", homeLine: 3, play: "", basis: "reference", shownInEmail: true },
    { home: "H2", away: "A-H2", tier: "t1", side: "home", homeLine: 3, play: "", basis: "reference", shownInEmail: true },
    { home: "H3", away: "A-H3", tier: "t1", side: "home", homeLine: 3, play: "", basis: "reference", shownInEmail: true },
  ],
};

describe("game-day update", () => {
  const board = staked(tierBoard("cfb", [
    row("H1", 4), // still a dog at +4: still on, a point better
    row("H2", -1.5, -3, 0), // Sam on the home side, David on the road side: split
    // H3 has kicked off: no pregame quote
    { home: "H3", away: "A-H3", sam: { market: 3, model: 1 }, david: { market: 3, model: 0 } },
    row("H4", 7), // qualifies now, never sent
  ], rule));
  const report = { league: "cfb", week: 7, board, reference: {}, names: {} } as unknown as PicksReport;
  const d = diffUpdate(report, [tuesday]);

  it("says what is still on, what is off, and what is new", () => {
    expect(d.stillOn).toEqual([expect.objectContaining({ nowLine: 4, moved: 1 })]);
    expect(d.off.map((o) => [o.sent.home, o.reason])).toEqual([["H2", "The models now split at the current line"]]);
    expect(d.gone).toBe(1);
    expect(d.added.map((g) => g.home)).toEqual(["H4"]);
    expect(updateMatters(d)).toBe(true);
  });

  it("counts a game once, at the line it was first sent", () => {
    const saturday: IssuedRecord = {
      ...tuesday, slot: "sat",
      plays: [
        { home: "H4", away: "A-H4", tier: "t1", side: "home", homeLine: 7, play: "", basis: "reference", shownInEmail: true },
        // A duplicate of Tuesday's H1 at a different line must not count twice.
        { home: "H1", away: "A-H1", tier: "t1", side: "home", homeLine: 4, play: "", basis: "reference", shownInEmail: true },
      ],
    };
    expect(firstSends([saturday, tuesday]).find((r) => r.slot === "sat")!.plays.map((p) => p.home)).toEqual(["H4"]);
    const finals = new Map([
      ["7:A-H1@H1", { home: 20, away: 22 }], // home +3 covers (lost by 2)
      ["7:A-H2@H2", { home: 10, away: 20 }],
      ["7:A-H3@H3", { home: 10, away: 20 }],
      ["7:A-H4@H4", { home: 14, away: 20 }],
    ]);
    const [w] = gradeIssued([tuesday, saturday], finals);
    // H1 W at +3 (not re-graded at +4), H2 L, H3 L, H4 W.
    expect([w.t1.w, w.t1.l]).toEqual([2, 2]);
  });

  it("marks a new play that Tuesday's card only listed on the page", () => {
    const withPageOnly = {
      ...tuesday,
      plays: [...tuesday.plays, { home: "H4", away: "A-H4", tier: "t2" as const, side: "home" as const, homeLine: 7, play: "", basis: "reference" as const, shownInEmail: false }],
    };
    expect(diffUpdate(report, [withPageOnly]).pageOnly).toEqual(["7:A-H4@H4"]);
  });

  it("stays quiet when nothing is new or off", () => {
    const calm = diffUpdate({ ...report, board: staked(tierBoard("cfb", [row("H1", 3)], rule)) } as PicksReport, [
      { ...tuesday, plays: [tuesday.plays[0]] },
    ]);
    expect(updateMatters(calm)).toBe(false);
    expect(calm.stillOn[0].moved).toBe(0);
  });
});
