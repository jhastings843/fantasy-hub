import { describe, expect, it } from "vitest";
import {
  type GradedGame,
  type StrategyBoard,
  cutsFor,
  gradeGame,
  read,
  readAt,
  strategies,
  tierBoard,
} from "./engine";
import { gradeIssued, selectForEmail, toIssued, type IssuedRecord } from "./issued";
import { researchRows } from "./research";
import type { PicksReport } from "./report";
import type { ModelLine } from "./parse";

const g = (
  week: number,
  i: number,
  sam: ModelLine,
  david: ModelLine,
  final: { home: number; away: number },
  pem?: { model: number },
): GradedGame => gradeGame({ week, home: `H${week}-${i}`, away: `A${week}-${i}`, sam, david, final, pem });

/** Home dog at +3, both models on the home team. */
const dog = (week: number, i: number, homeWins: boolean, push = false) =>
  g(week, i, { market: 3, model: 1 }, { market: 3, model: 0 }, push ? { home: 17, away: 20 } : homeWins ? { home: 20, away: 17 } : { home: 10, away: 24 });
/** Home favorite at -3, both models on the home team. */
const fav = (week: number, i: number, covers: boolean) =>
  g(week, i, { market: -3, model: -6 }, { market: -3, model: -7 }, covers ? { home: 27, away: 10 } : { home: 10, away: 17 });

const stub = (rule: object | null, second: object | null = null) => ({ rule, second }) as unknown as StrategyBoard;

describe("agreement at one line", () => {
  it("does not call two models agreed when they split at the available number", () => {
    // Sam: home -2 vs his market -3 (road side). David: home -6 vs his -7 (road side).
    const sam = { market: -3, model: -2 };
    const david = { market: -7, model: -6 };
    expect(read(sam, david).agree).toBe(true); // the source-line read, as the backtest sees it
    const at = readAt(-5, sam, david);
    expect(at.agree).toBe(false);
    expect(at.samSide).toBe("away");
    expect(at.davidSide).toBe("home");
  });

  it("tiers the board at the reference line and records where it came from", () => {
    const ref = { line: -5, source: "DraftKings via ESPN", fetchedAt: "2026-10-08T13:00:00Z" };
    const [b] = tierBoard("nfl", [{ home: "H", away: "A", sam: { market: -3, model: -2 }, david: { market: -7, model: -6 }, ref }], stub({ test: {} }));
    expect(b.basis).toBe("reference");
    expect(b.tier).toBe("split");
    // Without a quote the same game is a source-line research signal, not a play.
    const [src] = tierBoard("nfl", [{ home: "H", away: "A", sam: { market: -3, model: -2 }, david: { market: -7, model: -6 } }], stub({ test: {} }));
    expect(src.basis).toBe("source");
    expect(src.tier).toBe("t1");
  });
});

describe("eligibility counts decided games", () => {
  it("does not let pushes make up the 10-game minimum", () => {
    const games = [...Array.from({ length: 9 }, (_, i) => dog(3, i, true)), ...Array.from({ length: 3 }, (_, i) => dog(4, i, false, true))];
    expect(games[9].result).toBe("P");
    const st = strategies("nfl", games);
    expect(st.cuts.find((c) => c.id === "dog")!.games).toBe(12);
    expect(st.rule).toBeNull();
  });
});

describe("Tier 2 is judged on the games it adds", () => {
  // 12 agreeing home dogs, all win; 11 agreeing favorites, 3-8.
  const games = [
    ...Array.from({ length: 12 }, (_, i) => dog(3, i, true)),
    ...Array.from({ length: 3 }, (_, i) => fav(4, i, true)),
    ...Array.from({ length: 8 }, (_, i) => fav(4, 10 + i, false)),
  ];

  it("refuses a runner-up whose full record is profitable but whose added games lose", () => {
    const st = strategies("nfl", games);
    expect(st.rule?.id).toBe("dog");
    const agree = st.cuts.find((c) => c.id === "agree")!;
    // As a whole, "both agree" is 15-8 (65%): it would have been Tier 2 before.
    expect([agree.record.w, agree.record.l]).toEqual([15, 8]);
    // Its only games outside Tier 1 are the favorites, 3-8. Nothing qualifies.
    expect(st.second).toBeNull();
  });

  it("reports the added-games record, with the full cut kept as context", () => {
    const more = [...games, ...Array.from({ length: 12 }, (_, i) => fav(5, i, true))];
    const st = strategies("nfl", more);
    expect(st.second).not.toBeNull();
    const extraGames = more.filter((x) => !x.read.dog);
    expect(st.second!.games).toBeLessThanOrEqual(extraGames.length);
    expect(st.second!.record.w + st.second!.record.l).toBe(st.second!.games);
    expect(st.second!.fullRecord.w).toBeGreaterThanOrEqual(st.second!.record.w);
  });
});

describe("PEM is missing, not disagreeing", () => {
  const sam = { market: 3, model: 1 };
  const david = { market: 3, model: 0 };
  const ref = { line: 3, source: "t", fetchedAt: "t" };
  const rule = stub({ test: { pem: "agree" } });

  it("waits on a game PEM has not covered", () => {
    const [b] = tierBoard("cfb", [{ home: "H", away: "A", sam, david, ref }], rule);
    expect(b.tier).toBe("wait");
    expect(b.missing).toBe("PEM");
    expect(b.waitFor).toBe("t1");
  });
  it("passes when PEM is on file and disagrees, bets when it agrees", () => {
    const [no] = tierBoard("cfb", [{ home: "H", away: "A", sam, david, ref, pem: { model: 6 } }], rule);
    expect(no.tier).toBe("pass");
    const [yes] = tierBoard("cfb", [{ home: "H", away: "A", sam, david, ref, pem: { model: -1 } }], rule);
    expect(yes.tier).toBe("t1");
  });
  it("gives a PEM split play its side and line, so it can be graded", () => {
    const [b] = tierBoard(
      "cfb",
      [{ home: "H", away: "A", sam: { market: -6, model: -9 }, david: { market: -6, model: -4 }, ref: { line: -6.5, source: "t", fetchedAt: "t" }, pem: { model: -10 } }],
      stub({ test: { pemSplit: true } }),
    );
    expect(b.tier).toBe("t1");
    expect(b.pemPick).toBe(true);
    expect(b.side).toBe("home");
    expect(b.homeLine).toBe(-6.5);
  });
});

describe("straight up follows the selected method", () => {
  it("uses the Vegas favorite at the reference line when that method is selected, with a margin label", () => {
    // Both models like the road team outright; the market favors home by 3.5.
    const [b] = tierBoard(
      "cfb",
      [{ home: "H", away: "A", sam: { market: -3, model: 2 }, david: { market: -3, model: 1 }, ref: { line: -3.5, source: "t", fetchedAt: "t" } }],
      stub(null),
      "vegas",
    );
    expect(b.su).toMatchObject({ side: "home", margin: 3.5, method: "vegas", band: "close" });
  });
});

describe("issued records", () => {
  const ref = { line: 3, source: "DraftKings via ESPN", fetchedAt: "2026-10-14T13:00:00Z" };
  const board = tierBoard(
    "nfl",
    [
      { home: "H1", away: "A1", sam: { market: 3, model: 1 }, david: { market: 3, model: 0 }, ref },
      { home: "H2", away: "A2", sam: { market: 3, model: 1 }, david: { market: 3, model: 0 }, ref },
      // Fits at the sites' lines but has no current quote: research only.
      { home: "H3", away: "A3", sam: { market: 3, model: 1 }, david: { market: 3, model: 0 } },
    ],
    stub({ id: "dog", label: "Agree on underdog", test: { side: "dog" }, record: { w: 14, l: 2, p: 0 } }),
    "avg",
  );
  const report = {
    league: "nfl",
    season: 2026,
    week: 6,
    board,
    strategies: { rule: { id: "dog", label: "Agree on underdog", test: { side: "dog" }, record: { w: 14, l: 2, p: 0 } }, second: null },
    su: { best: { id: "avg", label: "Average of both models" } },
  } as unknown as PicksReport;

  it("stores exactly the plays the email shows, at their quote, and leaves research signals out", () => {
    const sel = selectForEmail(report, 1, 2);
    expect(sel.plays.map((p) => p.home)).toEqual(["H1", "H2"]);
    expect(sel.sourceOnly).toBe(1);
    const rec = toIssued(report, sel, { issuedAt: "2026-10-14T13:01:00Z", emailId: "e1", subject: "s" });
    expect(rec.provenance).toBe("issued");
    expect(rec.plays.map((p) => [p.home, p.shownInEmail, p.homeLine, p.ref?.source])).toEqual([
      ["H1", true, 3, "DraftKings via ESPN"],
      ["H2", false, 3, "DraftKings via ESPN"],
    ]);
    expect(rec.rule).toMatchObject({ id: "dog", test: { side: "dog" } });
    expect(rec.suMethod.id).toBe("avg");
    expect(rec.su.filter((x) => x.shownInEmail)).toHaveLength(2);
  });

  it("grades only what the email showed", () => {
    const sel = selectForEmail(report, 1, 0);
    const rec: IssuedRecord = toIssued(report, sel, { issuedAt: "t", subject: "s" });
    const finals = new Map([
      ["6:A1@H1", { home: 20, away: 17 }],
      ["6:A2@H2", { home: 0, away: 30 }],
    ]);
    const [w] = gradeIssued([rec], finals);
    expect([w.t1.w, w.t1.l]).toEqual([1, 0]);
  });
});

describe("issued totals", () => {
  it("records totals plays as sent and grades them on the final total", () => {
    const report = {
      league: "nfl", season: 2026, week: 6, board: [],
      strategies: { rule: null, second: null },
      su: { best: null },
      totals: {
        backtest: { rule: { id: "t-over", label: "Both agree on the over", test: { side: "over" }, record: { w: 9, l: 2, p: 0 } } },
        board: [
          { home: "H", away: "A", sam: 49, david: 48, ref: { total: 45, source: "DraftKings via ESPN", fetchedAt: "t" }, tier: "t1", play: "Over 45", side: "over", line: 45, read: { minEdge: 3 } },
          { home: "H2", away: "A2", sam: 49, david: 48, ref: { total: 45, source: "s", fetchedAt: "t" }, tier: "lean", play: "Over 45", side: "over", line: 45 },
        ],
      },
    } as unknown as PicksReport;
    const sel = selectForEmail(report, 5, 5);
    expect(sel.totals.map((g) => g.home)).toEqual(["H"]);
    const rec = toIssued(report, sel, { issuedAt: "t", subject: "s" });
    expect(rec.totals).toEqual([
      { home: "H", away: "A", side: "over", line: 45, play: "Over 45", source: "DraftKings via ESPN", fetchedAt: "t", shownInEmail: true },
    ]);
    expect(rec.totalsRule?.id).toBe("t-over");
    const [w] = gradeIssued([rec], new Map([["6:A@H", { home: 24, away: 24 }]]));
    expect([w.totals.w, w.totals.l]).toEqual([1, 0]);
  });
});

describe("research cuts", () => {
  it("are never eligible to be the rule, and report what they leave out", () => {
    expect(cutsFor("cfb").filter((c) => c.group === "Research").every((c) => !c.candidate && c.parent)).toBe(true);
    // Home dogs at +3 (NFL band "3 or less") all win; the 7+ band is empty.
    const games = Array.from({ length: 12 }, (_, i) => dog(3, i, true));
    const st = strategies("nfl", games);
    expect(st.rule?.group).not.toBe("Research");
    const rows = researchRows(games, st.cuts, new Map());
    const a = rows.find((r) => r.id === "dog-band-a")!;
    const c = rows.find((r) => r.id === "dog-band-c")!;
    expect([a.record.w, a.excluded.w]).toEqual([12, 0]);
    expect([c.record.w, c.excluded.w]).toEqual([0, 12]);
    expect(c.parent.id).toBe("dog");
  });
});
