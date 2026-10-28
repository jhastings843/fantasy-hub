import { describe, expect, it } from "vitest";
import { allocateNbaDay, compareCut, cutRecord, nbaRoom, NBA_CUT, NBA_CUTS, nbaBets, nbaGate, nbaRule, nbaStake, registerNew, reviewDue, reviewNba, samGaps, settledRows, tierOf, type NbaSnap, type NbaTracked } from "./nba-track";

const snap = (x: Partial<NbaSnap> = {}): NbaSnap => ({ at: "2026-10-20T12:00:00Z", line: -4.5, homePrice: -110, awayPrice: -110, total: 230.5, overPrice: -110, underPrice: -110, mlHome: -190, mlAway: 160, model: -7, modelTotal: 226, ...x });
const game = (i: number, x: Partial<NbaTracked> = {}, s: Partial<NbaSnap> = {}): NbaTracked => ({
  id: `g${i}`,
  day: "20261020",
  week: 1,
  tip: "2026-10-20T23:00:00Z",
  home: "NY",
  away: "PHI",
  first: snap(s),
  last: snap(s),
  ...x,
});

describe("Sam's NBA bets", () => {
  it("reads his side, edge and the dog from the saved copy", () => {
    const b = nbaBets(game(1));
    // Book NY -4.5, Sam NY -7: NY by 2.5 more than the book.
    expect(b.find((x) => x.market === "ats")).toMatchObject({ side: "home", line: -4.5, edge: 2.5, dog: false, price: -110 });
    expect(b.find((x) => x.market === "su")).toMatchObject({ side: "home", price: -190, dog: false });
    expect(b.find((x) => x.market === "ou")).toMatchObject({ side: "under", line: 230.5, edge: 4.5 });
    // Sam OKC (road) +2.5 vs Sam's SA -0.3: the road dog.
    expect(nbaBets(game(2, {}, { line: -2.5, model: -0.3 })).find((x) => x.market === "ats")).toMatchObject({ side: "away", line: 2.5, edge: 2.2, dog: true });
  });

  it("takes the side Sam posts, graded at DraftKings, when DK has moved through his number", () => {
    // OKC at SA, 2026-10-20: Sam posted SA -2.5 with his model SA -0.3 (Thunder). DK closed SA +1.5.
    const okc = game(3, { home: "SA", away: "OKC", final: { home: 104, away: 116 } }, { line: 1.5, homePrice: -112, awayPrice: -108, model: -0.3, samLine: -2.5 });
    expect(nbaBets(okc).find((x) => x.market === "ats")).toMatchObject({ side: "away", line: -1.5, price: -108, edge: -1.8, crossed: true, dog: false, result: "W" });
    // A copy saved before Sam's line was kept falls back to DraftKings, as before.
    expect(nbaBets(game(4, {}, { line: 1.5, model: -0.3 })).find((x) => x.market === "ats")).toMatchObject({ side: "home", line: 1.5, edge: 1.8, crossed: false });
    // Sam's line and DK agree on the side: nothing crossed.
    expect(nbaBets(game(5, {}, { line: -4.5, model: -7, samLine: -5 })).find((x) => x.market === "ats")).toMatchObject({ side: "home", edge: 2.5, crossed: false });
  });

  it("keeps a crossed side out of the edge cuts", () => {
    const b = nbaBets(game(6, {}, { line: 1.5, model: -0.3, samLine: -2.5 })).find((x) => x.market === "ats")!;
    expect(NBA_CUT.get("ats:all")!.test(b)).toBe(true);
    expect(NBA_CUT.get("ats:edge1")!.test(b)).toBe(false);
  });

  it("grades at the saved number and price", () => {
    const b = nbaBets(game(1, { final: { home: 110, away: 104 } }));
    expect(b.find((x) => x.market === "ats")).toMatchObject({ result: "W", net: 0.909 }); // NY by 6 covers 4.5
    expect(b.find((x) => x.market === "ou")).toMatchObject({ result: "W" }); // 214 under 230.5
    expect(nbaBets(game(1, { final: { home: 108, away: 104 } })).find((x) => x.market === "ats")).toMatchObject({ result: "L", net: -1 });
  });

  it("makes no spread bet when Sam is on the number", () => {
    expect(nbaBets(game(1, {}, { model: -4.5 })).some((x) => x.market === "ats")).toBe(false);
  });
});

// n wins then m losses, all NY -4.5 with Sam at -7 (edge 2.5), each its own week if spread.
const record = (w: number, l: number, weeks = 1, s: Partial<NbaSnap> = {}) =>
  Array.from({ length: w + l }, (_, i) => game(i, { week: 1 + (i % weeks), final: i < w ? { home: 110, away: 100 } : { home: 100, away: 110 } }, s));

describe("the NBA rule", () => {
  it("needs the football minimum and a rate past break-even, ranked by the low end", () => {
    expect(nbaRule(settledRows(record(5, 3)), "ats", []).tier1).toBeNull(); // 8 games: under MIN_SAMPLE
    const r = nbaRule(settledRows(record(14, 6)), "ats", []);
    expect(r.tier1).not.toBeNull();
    expect(r.tier1!.w + r.tier1!.l).toBe(20);
  });

  it("keeps research cuts out until the review activates them", () => {
    const rows = settledRows(record(14, 6));
    const pool = (act: string[]) => [nbaRule(rows, "ats", act).tier1?.id, nbaRule(rows, "ats", act).tier2?.id];
    expect(pool([])).not.toContain("ats:small");
    expect(cutRecord(NBA_CUT.get("ats:small")!, rows).w).toBe(14);
  });

  it("marks an upcoming bet with its tier", () => {
    const r = nbaRule(settledRows(record(14, 6)), "ats", []);
    expect(tierOf(nbaBets(game(99))[0], r)).toBe(1);
  });
});

describe("the go-live gate and NBA's own limits", () => {
  it("stays shut on a short record and opens on a strong long one", () => {
    expect(nbaGate(nbaRule(settledRows(record(14, 6)), "ats", [])).live).toBe(false);
    const g = nbaGate(nbaRule(settledRows(record(75, 45, 5)), "ats", []));
    expect(g.checks.map((c) => c.ok)).toEqual([true, true, true, true]);
    expect(g.live).toBe(true);
  });

  it("sizes inside 1u to 3u, and under 1u is no bet", () => {
    const strong = cutRecord(NBA_CUTS[0], settledRows(record(120, 60, 5)));
    const s = nbaStake(strong, -110)!;
    expect(s).toBeGreaterThanOrEqual(1);
    expect(s).toBeLessThanOrEqual(3);
    expect(nbaStake(cutRecord(NBA_CUTS[0], settledRows(record(11, 9))), -110)).toBeNull();
    expect(nbaStake(strong, undefined)).toBeNull();
  });
});

describe("the NBA learning review", () => {
  it("registers every research cut once, starting its sample now", () => {
    const h = registerNew([], "2026-10-20T00:00:00Z");
    expect(h.length).toBe(NBA_CUTS.filter((c) => c.research).length);
    expect(registerNew(h, "2026-10-27T00:00:00Z")).toEqual([]);
  });

  it("counts only games first seen after registration, paired against the parent", () => {
    // ats:small (spread under 5) vs ats:all: every game is under 5, so they bet the same games.
    const rows = settledRows(record(14, 6));
    expect(compareCut(rows, "ats:small", "2026-10-21T00:00:00Z").n).toBe(0);
    expect(compareCut(rows, "ats:small", "2026-10-19T00:00:00Z")).toMatchObject({ n: 20, mean: 0 });
  });

  it("activates a cut that clears the football criteria, and only one per review", () => {
    // Small spreads win, big spreads lose: ats:small beats ats:all.
    const small = Array.from({ length: 40 }, (_, i) => game(i, { week: 1 + (i % 4), final: { home: 110, away: 100 } }));
    const big = Array.from({ length: 40 }, (_, i) => game(100 + i, { week: 1 + (i % 4), final: { home: 100, away: 110 } }, { line: -12.5, model: -15 }));
    const rows = settledRows([...small, ...big]);
    const hyps = registerNew([], "2026-10-19T00:00:00Z");
    const r = reviewNba(rows, hyps, "2026-11-20T00:00:00Z");
    const active = r.hyps.filter((h) => h.status === "active");
    expect(active).toHaveLength(1);
    expect(r.journal.some((j) => j.kind === "activate")).toBe(true);
  });

  it("tests the market signals but never activates them on its own", () => {
    // Sam NY -7 at DK NY -4.5 (home). NY opened -6.5, now -4.5: moved toward PHI while 70% of tickets are on NY -> RLM against Sam.
    const splits = { homeTickets: 70, homeMoney: 60, open: -6.5, at: "2026-10-20T12:00:00Z" };
    const flagged = Array.from({ length: 40 }, (_, i) => game(i, { week: 1 + (i % 4), final: { home: 100, away: 110 } }, { splits }));
    const clean = Array.from({ length: 40 }, (_, i) => game(100 + i, { week: 1 + (i % 4), final: { home: 110, away: 100 } }));
    const b = nbaBets(flagged[0]).find((x) => x.market === "ats")!;
    expect(b.mkt).toEqual({ rlmAgainst: true, publicOurs: true, sharpAgainst: true });
    expect(NBA_CUT.get("ats:mkt-rlm")!.test(b)).toBe(false);
    // No splits saved: the bet stands, same as the parent.
    expect(NBA_CUT.get("ats:mkt-rlm")!.test(nbaBets(clean[0]).find((x) => x.market === "ats")!)).toBe(true);
    const rows = settledRows([...flagged, ...clean]);
    // Skipping the flagged losers clears the bar, yet the review leaves it collecting.
    expect(compareCut(rows, "ats:mkt-rlm", "2026-10-19T00:00:00Z").t).toBeGreaterThan(1.645);
    const hyps = registerNew([], "2026-10-19T00:00:00Z").filter((h) => h.id.startsWith("ats:mkt-"));
    const r = reviewNba(rows, hyps, "2026-11-20T00:00:00Z");
    expect(r.hyps.every((h) => h.status === "collecting")).toBe(true);
  });

  it("runs daily, after each night's games", () => {
    const now = new Date("2026-10-27T12:00:00Z");
    expect(reviewDue(undefined, now)).toBe(true);
    expect(reviewDue("2026-10-27T06:30:00Z", now)).toBe(false);
    expect(reviewDue("2026-10-26T06:30:00Z", now)).toBe(true);
  });

  it("a market that changed this past week waits, even with a daily review", () => {
    const small = Array.from({ length: 40 }, (_, i) => game(i, { week: 1 + (i % 4), final: { home: 110, away: 100 } }));
    const big = Array.from({ length: 40 }, (_, i) => game(100 + i, { week: 1 + (i % 4), final: { home: 100, away: 110 } }, { line: -12.5, model: -15 }));
    const rows = settledRows([...small, ...big]);
    const first = reviewNba(rows, registerNew([], "2026-10-19T00:00:00Z"), "2026-11-20T00:00:00Z");
    const next = reviewNba(rows, first.hyps, "2026-11-21T00:00:00Z");
    expect(next.hyps.filter((h) => h.status === "active")).toHaveLength(1);
    expect(next.journal.some((j) => j.kind === "activate")).toBe(false);
  });
});

describe("NBA's running week", () => {
  const placed = (day: string, stake: number, id = day) => ({ id, day, stake });

  it("caps any running 7 days at 10u and any day at 4u", () => {
    // Mon-Wed Oct 19-21: 4u, 4u, 2u. Thursday has nothing left.
    const p = [placed("20261019", 4), placed("20261020", 4), placed("20261021", 2)];
    expect(nbaRoom(p, "20261022")).toMatchObject({ window: 10, room: 0, frees: "20261026" });
    // The next Monday the Oct 19 stake has rolled off: 4u back (not all 10u, as a calendar week would give).
    expect(nbaRoom(p, "20261026")).toMatchObject({ window: 6, room: 4 });
  });

  it("leaves a quiet week's Sunday its full day", () => {
    const p = [placed("20261019", 1), placed("20261021", 2)];
    expect(nbaRoom(p, "20261025").room).toBe(4);
  });

  it("re-allocates the day's untipped games instead of counting them", () => {
    const p = [placed("20261025", 3, "g1"), placed("20261025", 1, "g2")];
    expect(nbaRoom(p, "20261025").room).toBe(0);
    expect(nbaRoom(p, "20261025", ["g1", "g2"]).room).toBe(4);
  });

  it("gives short room to the biggest edges, never rounding a bet up to 1u", () => {
    const got = allocateNbaDay(
      [
        { id: "a", stake: 2, edge: 1.5 },
        { id: "b", stake: 2, edge: 4 },
        { id: "c", stake: 2, edge: 3 },
      ],
      3.5,
    );
    expect(Object.fromEntries(got)).toEqual({ b: 2, c: 1.5 });
  });
});

describe("rechecking Sam when today's game has no saved line", () => {
  // Oct 23 to 26: two games a night (NY@BOS, MEM@GS, ...) never got a saved copy of Sam's read.
  const NOW = new Date("2026-10-23T22:00:00Z");
  const g = (id: string, tip: string, state: "pre" | "in" | "post" = "pre") =>
    ({ id, tip, day: "20261023", state, detail: "", home: { abbr: "BOS", name: "Boston" }, away: { abbr: "NY", name: "New York" } }) as Parameters<typeof samGaps>[0][number];

  it("lists only untipped games without a saved read", () => {
    const today = [g("1", "2026-10-23T23:00:00Z"), g("2", "2026-10-24T02:00:00Z"), g("3", "2026-10-23T20:00:00Z", "in")];
    expect(samGaps(today, new Set(["1"]), NOW).map((x) => x.id)).toEqual(["2"]);
  });

  it("nothing to do once every game is saved or has tipped", () => {
    expect(samGaps([g("1", "2026-10-23T23:00:00Z"), g("3", "2026-10-23T21:00:00Z")], new Set(["1"]), NOW)).toEqual([]);
  });
});
