// Regression tests for the 2026-10-09 audit findings, each reproducing the
// failure it guards against.
import { describe, expect, it } from "vitest";
import { allocate } from "./allocate";
import { ENVELOPE, MIN_STAKE, OUTSTANDING_CAP, PER_GAME_CAP, WEEKLY_CAP } from "./limits";
import { BASELINE_POLICY, envelopeViolations } from "./policy";
import { compose, exposureFrom, type PicksCore } from "./compose";
import { gradeGame, strategies, suRecords, type GradedGame } from "./engine";
import { diffUpdate, updateMatters } from "./update";
import type { IssuedRecord } from "./issued";
import { totalsCuts } from "./totals";

const game = (i: number, covers: boolean): GradedGame =>
  gradeGame({ week: 3, home: `HH${i}`, away: `AA${i}`, sam: { market: 3, model: 1 }, david: { market: 3, model: 0 }, final: covers ? { home: 21, away: 20 } : { home: 3, away: 30 } });
// A 14-2 "agree on underdog" history.
const graded = [...Array.from({ length: 14 }, (_, i) => game(i, true)), ...Array.from({ length: 2 }, (_, i) => game(20 + i, false))];

function core(rows: PicksCore["rows"], over: Partial<PicksCore> = {}): PicksCore {
  const s = strategies("nfl", graded);
  return {
    league: "nfl", season: 2026, week: 6, generatedAt: "2026-10-13T12:00:00Z", boardUpdated: { sam: true, david: true },
    weeksCovered: [3], graded, strategies: s, su: suRecords("nfl", graded), rows, notes: [], errors: [], pem: [], names: {},
    clvModels: [], research: [], pemCompare: null,
    totalsBacktest: { cuts: [], rule: null, samAlone: { record: { w: 0, l: 0, p: 0, pct: 0, units: 0, lo: 0, hi: 0 }, weeks: [], clv: { avg: 0, n: 0 } }, archived: 0 },
    totalsEdge: 3, totalsArchived: 0, posted: {}, finals: [], closes: [], policyId: "p1", ...over,
  };
}
// Thursday night: not held, so these tests exercise allocation (hold.ts holds Sunday games on a Tuesday).
const TNF = "2026-10-16T00:15:00Z";
const SUN = "2026-10-18T17:00:00Z";
const dogRow = (i: number) => ({ home: `H${i}`, away: `A${i}`, sam: { market: 3, model: 1 }, david: { market: 3, model: 0 }, samTotal: 50, davidTotal: 49 });
const quote = (i: number, over: Record<string, unknown> = {}) =>
  [`6:A${i}@H${i}`, { line: 3, total: 44.5, source: "DraftKings via ESPN", fetchedAt: "2026-10-13T21:00:00Z", homePrice: -110, awayPrice: -110, overPrice: -110, underPrice: -110, kickoff: TNF, ...over }] as [string, never];
const NOW = new Date("2026-10-13T21:30:00Z");
const noExposure = { weekly: 0, outstanding: 0, perGame: new Map<string, number>() };
const sumStakes = (r: ReturnType<typeof compose>) =>
  r.board.reduce((t, g) => t + (g.stake ?? 0), 0) + r.totals.board.reduce((t, g) => t + (g.stake ?? 0), 0);

describe("protected envelope", () => {
  it("is pinned: an automated cycle cannot change these without this test failing", () => {
    expect(ENVELOPE).toEqual({ MIN_STAKE: 0.25, MAX_STAKE: 5, PER_GAME_CAP: 5, WEEKLY_CAP: 15, OUTSTANDING_CAP: 30, MAX_KELLY_SCALE: 0.25, MIN_PRIOR_GAMES: 100, PARLAY_MAX: 1 });
  });
  it("rejects policies outside it", () => {
    expect(envelopeViolations(BASELINE_POLICY)).toEqual([]);
    expect(envelopeViolations({ ...BASELINE_POLICY, staking: { ...BASELINE_POLICY.staking, kellyScale: 0.5 } })).toHaveLength(1);
    expect(envelopeViolations({ ...BASELINE_POLICY, staking: { ...BASELINE_POLICY.staking, priorGames: 40 } })).toHaveLength(1);
  });
});

describe("finding 1: the weekly cap holds with many qualifying games", () => {
  it("61 games wanting 1.5u each never exceed the cap; the lowest priorities are deferred", () => {
    const cands = Array.from({ length: 61 }, (_, i) => ({ id: `g${i}`, game: `g${i}`, want: 1.5, priority: 1 - i / 100 }));
    const a = allocate(cands, noExposure);
    expect(a.used).toBeLessThanOrEqual(WEEKLY_CAP);
    expect([...a.stakes.values()].every((s) => s >= MIN_STAKE)).toBe(true);
    expect(a.stakes.has("g0")).toBe(true);
    expect(a.stakes.has("g60")).toBe(false);
    expect(a.deferred.some((d) => d.id === "g60")).toBe(true);
  });
  it("respects per-game, weekly-used, outstanding and reserved room", () => {
    const a = allocate(
      [
        { id: "ats", game: "x", want: 5, priority: 2 },
        { id: "ou", game: "x", want: 5, priority: 1 },
      ],
      { weekly: 0, outstanding: 0, perGame: new Map([["x", 2]]) },
    );
    expect([...a.stakes.values()].reduce((t, s) => t + s, 0)).toBeLessThanOrEqual(PER_GAME_CAP - 2);
    expect(allocate([{ id: "a", game: "a", want: 5, priority: 1 }], { weekly: 13, outstanding: 0, perGame: new Map() }).used).toBeLessThanOrEqual(2);
    expect(allocate([{ id: "a", game: "a", want: 5, priority: 1 }], { weekly: 0, outstanding: OUTSTANDING_CAP - 1, perGame: new Map() }).used).toBeLessThanOrEqual(1);
    expect(allocate([{ id: "a", game: "a", want: 5, priority: 1 }], { weekly: 0, outstanding: 20, perGame: new Map(), reserved: 10 }).used).toBe(0);
  });
});

describe("finding 2: one allocation for spreads, totals and earlier sends", () => {
  const rows = Array.from({ length: 12 }, (_, i) => dogRow(i));
  const quotes = { fetchedAt: "2026-10-13T21:00:00Z", lines: rows.map((_, i) => quote(i)) };
  // A totals rule that fires on every game (both models over 44.5).
  const overRule = { ...totalsCuts("nfl")[1], record: { w: 30, l: 10, p: 0, pct: 0.75, units: 0, lo: 0.6, hi: 0.85 }, games: 40, weeks: [3, 4, 5] };
  const c = core(rows, { totalsBacktest: { ...core([]).totalsBacktest, rule: overRule } });

  it("spreads and totals together stay inside the weekly cap", () => {
    const r = compose({ core: c, quotes, issued: [], exposure: noExposure, now: NOW });
    expect(r.totals.board.some((g) => (g.stake ?? 0) > 0)).toBe(true);
    expect(sumStakes(r)).toBeLessThanOrEqual(WEEKLY_CAP);
  });
  it("a game-day addition only gets what the earlier card left", () => {
    const tuesday = compose({ core: c, quotes, issued: [], exposure: noExposure, now: NOW });
    const issued: IssuedRecord = {
      league: "nfl", season: 2026, week: 6, slot: "tue", issuedAt: "t", provenance: "issued", status: "sent", subject: "s", ruleVersion: "v",
      rule: null, second: null, suMethod: { id: "avg", label: "a" }, su: [], unverified: [],
      plays: tuesday.board.filter((g) => g.stake).map((g) => ({ home: g.home, away: g.away, tier: "t1" as const, side: g.side!, homeLine: g.homeLine!, play: g.play, basis: "reference" as const, shownInEmail: true, units: g.stake })),
      totals: tuesday.totals.board.filter((g) => g.stake).map((g) => ({ home: g.home, away: g.away, side: g.side!, line: g.line!, play: g.play!, source: "s", fetchedAt: "t", shownInEmail: true, units: g.stake })),
    };
    const ex = exposureFrom("nfl", 6, [{ league: "nfl", records: [issued] }], new Set());
    expect(ex.weekly).toBeCloseTo(sumStakes(tuesday), 5);
    const saturday = compose({ core: c, quotes, issued: [issued], exposure: ex, now: NOW });
    expect(ex.weekly + saturday.allocation.used).toBeLessThanOrEqual(WEEKLY_CAP);
  });
  it("settled bets stop counting as outstanding; pending intents still count", () => {
    const rec = (status: "pending" | "sent"): IssuedRecord => ({
      league: "cfb", season: 2026, week: 6, issuedAt: "t", provenance: "issued", status, subject: "s", ruleVersion: "v", rule: null, second: null,
      suMethod: { id: "avg", label: "a" }, su: [], unverified: [],
      plays: [{ home: "X", away: "Y", tier: "t1", side: "home", homeLine: 3, play: "", basis: "reference", shownInEmail: true, units: 2 }],
    });
    expect(exposureFrom("nfl", 6, [{ league: "cfb", records: [rec("pending")] }], new Set()).outstanding).toBe(2);
    expect(exposureFrom("nfl", 6, [{ league: "cfb", records: [rec("sent")] }], new Set(["cfb:6:Y@X"])).outstanding).toBe(0);
  });
});

describe("finding 4 and price provenance: kickoff, stale quotes, missing prices", () => {
  const rows = [dogRow(0), dogRow(1), dogRow(2)];
  it("a game past kickoff is never actionable, even from an earlier quote", () => {
    const quotes = { fetchedAt: "2026-10-13T21:00:00Z", lines: [quote(0, { kickoff: "2026-10-13T21:15:00Z" }), quote(1), quote(2)] };
    const r = compose({ core: core(rows), quotes, issued: [], exposure: noExposure, now: NOW });
    const g0 = r.board.find((g) => g.home === "H0")!;
    expect(g0.basis).toBe("started");
    expect(g0.stake ?? 0).toBe(0);
    expect(r.reference.started).toBe(1);
    expect(r.board.find((g) => g.home === "H1")!.stake).toBeGreaterThan(0);
  });
  it("quotes older than the freshness limit are shown as stale, not offered", () => {
    const quotes = { fetchedAt: "2026-10-13T18:00:00Z", lines: rows.map((_, i) => quote(i)) };
    const r = compose({ core: core(rows), quotes, issued: [], exposure: noExposure, now: NOW });
    expect(r.reference.stale).toBe(true);
    expect(r.board.every((g) => !g.stake)).toBe(true);
  });
  it("a missing price is never stood in for by -110", () => {
    const quotes = { fetchedAt: "2026-10-13T21:00:00Z", lines: [quote(0, { homePrice: undefined }), quote(1), quote(2)] };
    const r = compose({ core: core(rows), quotes, issued: [], exposure: noExposure, now: NOW });
    const g0 = r.board.find((g) => g.home === "H0")!;
    expect(g0).toMatchObject({ priceSource: "missing", want: 0, stake: 0 });
    expect(g0.price).toBeUndefined();
  });
});

describe("finding 3: updates recheck price and stake, totals, and why a game is gone", () => {
  const rows = [dogRow(0), dogRow(1), dogRow(2), dogRow(3)];
  const tuesday: IssuedRecord = {
    league: "nfl", season: 2026, week: 6, slot: "tue", issuedAt: "t", provenance: "issued", status: "sent", subject: "s", ruleVersion: "v",
    rule: null, second: null, suMethod: { id: "avg", label: "a" }, su: [], unverified: [],
    plays: rows.map((r, i) => ({ home: r.home, away: r.away, tier: "t1" as const, side: "home" as const, homeLine: 3, play: "", basis: "reference" as const, shownInEmail: true, units: 1, price: -110, kickoff: i === 2 ? "2026-10-13T21:00:00Z" : "2026-10-18T17:00:00Z" })),
    totals: [{ home: "H0", away: "A0", side: "under", line: 44.5, play: "Under 44.5", source: "s", fetchedAt: "t", shownInEmail: true, units: 1, price: -110 }],
  };
  // H0: same side, but now -125 (the audit's reproduction). H1: unchanged. H2: kicked off. H3: no quote.
  const quotes = { fetchedAt: "2026-10-13T21:00:00Z", lines: [quote(0, { homePrice: -125 }), quote(1), quote(2, { kickoff: "2026-10-13T21:00:00Z" })] };
  const r = compose({ core: core(rows), quotes, issued: [tuesday], exposure: noExposure, now: NOW });
  const d = diffUpdate(r, [tuesday], NOW);

  it("a sent pick whose price now leaves no bet is off, not still on", () => {
    expect(d.off.map((o) => o.sent.home)).toContain("H0");
    expect(d.off.find((o) => o.sent.home === "H0")!.reason).toMatch(/Price now -125/);
    expect(d.stillOn.map((x) => x.sent.home)).toEqual(["H1"]);
    expect(updateMatters(d)).toBe(true);
  });
  it("kicked off and no-quote are told apart", () => {
    expect(d.kickedOff).toBe(1);
    expect(d.noQuote).toBe(1);
  });
  it("issued totals are rechecked too", () => {
    // No totals rule now: the sent under no longer qualifies.
    expect(d.totalsOff.map((o) => o.sent.home)).toEqual(["H0"]);
  });
});

describe("independent review findings 6 and 7", () => {
  it("finding 6: an issued game is not allocated again, so a new qualifier gets the last of the room", () => {
    const rows = [dogRow(0), dogRow(1)];
    const quotes = { fetchedAt: "2026-10-13T21:00:00Z", lines: [quote(0), quote(1)] };
    const issued: IssuedRecord = {
      league: "nfl", season: 2026, week: 6, slot: "tue", issuedAt: "t", provenance: "issued", status: "sent", subject: "s", ruleVersion: "v",
      rule: null, second: null, suMethod: { id: "avg", label: "a" }, su: [], unverified: [],
      plays: [{ home: "H0", away: "A0", tier: "t1", side: "home", homeLine: 3, play: "", basis: "reference", shownInEmail: true, units: 1.5 }],
    };
    const ex = { weekly: WEEKLY_CAP - 0.25, outstanding: 0, perGame: new Map([["6:A0@H0", 1.5]]) };
    const r = compose({ core: core(rows), quotes, issued: [issued], exposure: ex, now: NOW });
    expect(r.board.find((g) => g.home === "H0")!.issued?.units).toBe(1.5);
    expect(r.board.find((g) => g.home === "H1")!.stake).toBe(0.25);
  });
  it("finding 7: an older record's kickoff inside its quote still counts as kicked off", () => {
    const legacy: IssuedRecord = {
      league: "nfl", season: 2026, week: 6, slot: "tue", issuedAt: "t", provenance: "issued", subject: "s", ruleVersion: "v",
      rule: null, second: null, suMethod: { id: "avg", label: "a" }, su: [], unverified: [],
      plays: [{ home: "H9", away: "A9", tier: "t1", side: "home", homeLine: 3, play: "", basis: "reference", shownInEmail: true, ref: { line: 3, source: "s", fetchedAt: "t", kickoff: "2026-10-13T20:00:00Z" } }],
    };
    const r = compose({ core: core([dogRow(0)]), quotes: { fetchedAt: "2026-10-13T21:00:00Z", lines: [quote(0)] }, issued: [legacy], exposure: noExposure, now: NOW });
    const d = diffUpdate(r, [legacy], NOW);
    expect([d.kickedOff, d.noQuote]).toEqual([1, 0]);
  });
});

describe("hold: NFL Sunday and Monday games are early looks until the Sunday brief", () => {
  const rows = [dogRow(0), dogRow(1)];
  const quotes = { fetchedAt: "2026-10-13T21:00:00Z", lines: [quote(0), quote(1, { kickoff: SUN })] };
  it("on Tuesday the Thursday game is a bet and the Sunday game is held with no stake or room spent", () => {
    const r = compose({ core: core(rows), quotes, issued: [], exposure: noExposure, now: NOW });
    const thu = r.board.find((g) => g.home === "H0")!;
    const sun = r.board.find((g) => g.home === "H1")!;
    expect(thu.stake).toBeGreaterThan(0);
    expect(thu.held).toBeUndefined();
    expect(sun.want).toBeGreaterThan(0);
    expect(sun.stake).toBe(0);
    expect(sun.held).toBe("2026-10-18T13:00:00.000Z");
    expect(r.allocation.used).toBe(thu.stake);
  });
  it("the Tuesday card issues only the Thursday game and lists the Sunday one as an early look", async () => {
    const { selectForEmail, toIssued } = await import("./issued");
    const r = compose({ core: core(rows), quotes, issued: [], exposure: noExposure, now: NOW });
    const sel = selectForEmail(r, 99, 16);
    expect(sel.plays.map((g) => g.home)).toEqual(["H0"]);
    expect(sel.early.map((g) => g.home)).toEqual(["H1"]);
    expect(sel.overBudget).toEqual([]);
    expect(toIssued(r, sel, { issuedAt: NOW.toISOString(), subject: "s" }).plays.map((p) => p.home)).toEqual(["H0"]);
  });
  it("at the Sunday brief the held game is a new bet at that morning's line", () => {
    const brief = new Date("2026-10-18T13:00:00Z");
    const tuesday: IssuedRecord = {
      league: "nfl", season: 2026, week: 6, issuedAt: NOW.toISOString(), provenance: "issued", subject: "s", ruleVersion: 1, rule: null, second: null,
      suMethod: { id: "avg", label: "" }, slot: "tue", unverified: [], su: [], totals: [],
      plays: [{ home: "H0", away: "A0", tier: "t1", side: "home", homeLine: 3, play: "", basis: "reference", shownInEmail: true, units: 1, price: -110, kickoff: TNF }],
    } as unknown as IssuedRecord;
    const sunQuotes = { fetchedAt: "2026-10-18T12:55:00Z", lines: [quote(0, { kickoff: TNF }), quote(1, { kickoff: SUN, line: 2.5 })] };
    const r = compose({ core: core(rows), quotes: sunQuotes, issued: [tuesday], exposure: { weekly: 1, outstanding: 1, perGame: new Map([["6:A0@H0", 1]]) }, now: brief });
    const d = diffUpdate(r, [tuesday], brief);
    expect(d.added.map((g) => g.home)).toEqual(["H1"]);
    expect(d.added[0].homeLine).toBe(2.5);
    expect(d.added[0].stake).toBeGreaterThan(0);
  });
  it("college is never held", () => {
    const r = compose({ core: core(rows, { league: "cfb" }), quotes: { fetchedAt: "2026-10-13T21:00:00Z", lines: [quote(1, { kickoff: SUN })] }, issued: [], exposure: noExposure, now: NOW });
    expect(r.board.find((g) => g.home === "H1")!.held).toBeUndefined();
  });
});
