import { describe, expect, it } from "vitest";
import { type Cut, type GradedGame, type StrategyBoard, gradeGame, strategies, tierBoard } from "./engine";
import { applyForward, backfillEntries, forwardCheck } from "./forward";

const agree: Cut = { id: "agree", label: "Both agree, any edge", group: "Agreement", test: {}, candidate: true };

// Both models take the home team at -3; a 10-point home win covers, a home loss doesn't.
let n = 0;
const game = (week: number, win: boolean): GradedGame =>
  gradeGame({
    week,
    home: `H${n++}`,
    away: `A${n}`,
    sam: { market: -3, model: -6 },
    david: { market: -3, model: -7 },
    final: win ? { home: 20, away: 10 } : { home: 10, away: 20 },
  });
const run = (week: number, w: number, l: number) => [...Array(w)].map(() => game(week, true)).concat([...Array(l)].map(() => game(week, false)));

describe("forwardCheck", () => {
  it("a new cut with 5 forward games does not stake", () => {
    const f = forwardCheck(agree, { week: 8 }, [...run(5, 9, 0), ...run(8, 5, 0)], 10);
    expect(f).toMatchObject({ stake: false, n: 5, w: 5, l: 0 });
    expect(f.reason).toBe("Forward check: 5 of 10 games since chosen (5-0), tracked until then.");
  });
  it("a new cut with 10 forward games above break-even stakes", () => {
    const f = forwardCheck(agree, { week: 8 }, [...run(8, 4, 2), ...run(9, 3, 1)], 10);
    expect(f).toMatchObject({ stake: true, n: 10, w: 7, l: 3 });
  });
  it("a new cut at 10+ games below break-even does not stake", () => {
    expect(forwardCheck(agree, { week: 8 }, run(8, 5, 6), 10)).toMatchObject({ stake: false, n: 11 });
  });
  it("a cut never recorded counts as chosen this week: nothing forward yet", () => {
    expect(forwardCheck(agree, undefined, run(8, 20, 0), 10)).toMatchObject({ stake: false, n: 0, since: 10 });
  });
  it("games this week and later don't count yet", () => {
    expect(forwardCheck(agree, { week: 8 }, [...run(8, 6, 0), ...run(10, 6, 0)], 10)).toMatchObject({ stake: false, n: 6 });
  });
  it("the grandfathered rule with 4 forward games keeps staking", () => {
    const f = forwardCheck(agree, { week: 9, grandfathered: true }, run(9, 1, 3), 10);
    expect(f).toMatchObject({ stake: true, n: 4, grandfathered: true });
  });
  it("the grandfathered rule with 12 forward games below break-even drops to tracked", () => {
    const f = forwardCheck(agree, { week: 6, grandfathered: true }, [...run(6, 3, 3), ...run(7, 2, 4)], 10);
    expect(f).toMatchObject({ stake: false, n: 12, w: 5, l: 7 });
    expect(f.reason).toBe("Forward record below break-even (5-7 since Week 6): tracked.");
  });
  it("pushes are not forward games", () => {
    const push = gradeGame({ week: 8, home: "PH", away: "PA", sam: { market: -3, model: -6 }, david: { market: -3, model: -7 }, final: { home: 13, away: 10 } });
    expect(forwardCheck(agree, { week: 8 }, [push, ...run(8, 9, 0)], 10)).toMatchObject({ stake: false, n: 9 });
  });
});

describe("a tier that fails the check stakes nowhere", () => {
  const history = run(3, 14, 2);
  const board = strategies("nfl", history);
  const row = { home: "NE", away: "NYJ", sam: { market: -3, model: -6 }, david: { market: -3, model: -7 }, ref: { line: -3, homePrice: -110, awayPrice: -110, source: "test", fetchedAt: "2026-11-01T00:00:00Z" } };

  it("the rule's game is tracked, marked as held by the forward check", () => {
    expect(board.rule).not.toBeNull();
    const held: StrategyBoard = applyForward(board, history, {}, 10);
    expect(held.rule!.forward!.stake).toBe(false);
    const [g] = tierBoard("nfl", [row], held);
    expect(g.tier).toBe("fav");
    expect(g.forwardHold).toBe("t1");
  });
  it("a passing rule still tiers its game", () => {
    const ok = applyForward(board, history, { [board.rule!.id]: { week: 3, at: "", tier: "t1" } }, 10);
    expect(ok.rule!.forward!.stake).toBe(true);
    expect(tierBoard("nfl", [row], ok)[0].tier).toBe("t1");
  });
  it("unreadable dates fail closed", () => {
    expect(applyForward(board, history, null, 10).rule!.forward!.stake).toBe(false);
  });
});

describe("backfillEntries", () => {
  const b = (rule?: string, second?: string) => ({ rule: rule ? ({ id: rule } as never) : null, second: second ? ({ id: second } as never) : null });
  it("dates each cut from its earliest week as Tier 1 or 2, and grandfathers the current rule from its earliest Tier 1 week", () => {
    const m = backfillEntries(
      [{ week: 7, board: b("dog", "road") }, { week: 8, board: b("road", "dog") }, { week: 9, board: b("road", "fav") }],
      [{ week: 6, rule: { id: "dog" }, second: null }],
      { week: 9, ruleId: "road", grandfather: true },
      "T",
    );
    expect(m.dog).toMatchObject({ week: 6, tier: "t1", source: "issued" });
    expect(m.road).toMatchObject({ week: 8, tier: "t1", grandfathered: true, source: "freeze" });
    expect(m.fav).toMatchObject({ week: 9, tier: "t2" });
    expect(m.fav.grandfathered).toBeUndefined();
  });
  it("with no history the current rule is dated from this week", () => {
    expect(backfillEntries([], [], { week: 9, ruleId: "dog", grandfather: true }, "T").dog).toMatchObject({ week: 9, grandfathered: true, source: "today" });
  });
  it("another season grandfathers nothing", () => {
    expect(backfillEntries([{ week: 2, board: b("dog") }], [], { week: 3, ruleId: "dog", grandfather: false }, "T").dog.grandfathered).toBeUndefined();
  });
});
