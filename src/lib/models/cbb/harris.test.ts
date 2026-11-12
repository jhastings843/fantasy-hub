import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { HarrisCbbSlow, checkCbbRow, fetchHarrisCbb, feedRows, modelSide, fixText, matchRows, mergeDay, nameKey, preOf, usableDays, type BoardTeams, type CbbFeedTable } from "./harris";
import { cbbCandidates, harrisRead, CBB_SLICES } from "./learn";
import type { TrackedCbbGame } from "./track";

// Fixtures: his feed for Nov 3, 4 and 5 (picks_date=YYYY-MM-DD) and his
// default answer (Nov 6 and 7), fetched 2026-11-06, with ESPN's Division I boards for those
// days trimmed to ids, tips and names.
const FX = JSON.parse(readFileSync(path.join(__dirname, "../../../../test/fixtures/models/cbb/harris/feed-and-board.json"), "utf8")) as {
  feed: { [k: string]: CbbFeedTable };
  board: { [day: string]: BoardTeams[] };
};
const day = (feed: string, date: string): CbbFeedTable => ({ headers: FX.feed[feed].headers, rows: FX.feed[feed].rows.filter((r) => r[0] === date) });
const nov6 = day("2026-11-06+07", "2026-11-06");

describe("signs (Spread and Model are home lines; he picks home when Model < Spread)", () => {
  it("Youngstown State at Ohio State: home -25.5, he has Ohio State by 24.6, Edge +0.9 takes the road dog", () => {
    expect(nov6.rows[0]).toEqual(["2026-11-06", "Youngstown State", "Ohio State", "N", "-25.5", "-24.6", "0.477", "+0.9", "Youngstown State +25.5", "N"]);
    const [r] = feedRows({ headers: nov6.headers, rows: [nov6.rows[0]] });
    expect(r).toMatchObject({ away: "Youngstown State", home: "Ohio State", spread: -25.5, model: -24.6, conf: 0.477, edge: 0.9, pick: "away", trigger: false, neutral: false });
    expect(checkCbbRow(r)).toBeNull();
  });

  it("Wofford at Tennessee (Nov 3): he has Tennessee by 31 against -25.5, Edge -5.5, Trigger on, picks home", () => {
    const t = day("2026-11-03", "2026-11-03");
    const [r] = feedRows({ headers: t.headers, rows: t.rows.filter((x) => x[1] === "Wofford") });
    expect(r).toMatchObject({ spread: -25.5, model: -31, edge: -5.5, pick: "home", trigger: true, conf: 0.606 });
  });

  const all = () => [day("2026-11-03", "2026-11-03"), day("2026-11-04", "2026-11-04"), day("2026-11-05", "2026-11-05"), nov6, day("2026-11-06+07", "2026-11-07")].flatMap((t) => feedRows(t));

  it("holds on every priced row of Nov 3 to 6: pick side, Model vs Spread and confidence agree", () => {
    const priced = all().filter((r) => modelSide(r));
    expect(priced.length).toBeGreaterThan(120);
    for (const r of priced) {
      expect(checkCbbRow(r)).toBeNull();
      expect(r.pick).toBe(modelSide(r));
      if (r.conf !== null) expect(r.conf > 0.5).toBe(r.pick === "home");
    }
  });

  it("Edge's sign is not stable: Model - Spread on Nov 3, 5 and 6, Spread - Model on Nov 4, so only its size is checked", () => {
    const sign = (date: string, feed = date) => feedRows(day(feed, date)).filter((r) => modelSide(r) && r.edge).map((r) => Math.sign(r.edge!) === Math.sign(r.model! - r.spread!));
    expect(sign("2026-11-03").every(Boolean)).toBe(true);
    expect(sign("2026-11-05").every(Boolean)).toBe(true);
    expect(sign("2026-11-06", "2026-11-06+07").every(Boolean)).toBe(true);
    const nov4 = sign("2026-11-04");
    expect(nov4).toHaveLength(9);
    expect(nov4.some(Boolean)).toBe(false);
    // Fairleigh Dickinson at Butler: Butler -26.5, he has Butler by 26, Edge printed -0.5, picks the road dog.
    const [fdu] = feedRows(day("2026-11-04", "2026-11-04"));
    expect(fdu).toMatchObject({ spread: -26.5, model: -26, edge: -0.5, pick: "away" });
    expect(checkCbbRow(fdu)).toBeNull();
  });

  it("ignores his Edge column, but names a pick on the wrong side", () => {
    // Edge printed as the Model (his Nov 6 post-game sheet): still a good row.
    const [r] = feedRows({ headers: nov6.headers, rows: [["2026-11-06", "A", "B", "N", "-3.5", "-5", "0.6", "-5", "B -3.5", "N"]] });
    expect(checkCbbRow(r)).toBeNull();
    const [w] = feedRows({ headers: nov6.headers, rows: [["2026-11-06", "A", "B", "N", "-3.5", "-5", "0.6", "-1.5", "A +3.5", "N"]] });
    expect(checkCbbRow(w)).toMatch(/favors home, ATS Pick says away/);
  });
});

describe("team names to our ESPN board", () => {
  it("fixes his double-encoded accents", () => {
    expect(fixText("San JosÃ© State")).toBe("San José State");
    expect(fixText("Texas A&M")).toBe("Texas A&M");
    expect(nameKey("San JosÃ© State")).toBe("sanjosestate");
    expect(nameKey("St. Thomas-Minnesota")).toBe(nameKey("St. Thomas"));
  });

  it.each([
    ["2026-11-03", "2026-11-03", "20261103", 18],
    ["2026-11-04", "2026-11-04", "20261104", 9],
    ["2026-11-05", "2026-11-05", "20261105", 43],
    ["2026-11-06", "2026-11-06+07", "20261106", 57],
    ["2026-11-07", "2026-11-06+07", "20261107", 44],
  ])("%s: every game he priced matches a game on our board", (date, feed, board, n) => {
    const m = matchRows(feedRows(day(feed, date)), FX.board[board]);
    expect(m.problems).toEqual([]);
    expect(m.unmatched).toEqual([]);
    expect(m.rows).toHaveLength(n);
    expect(m.rows.every((r) => r.event && r.homeId && r.awayId && r.tip)).toBe(true);
  });

  it("unpriced rows with no ESPN game (Incarnate Word at Tulsa, Boston College at Harvard) are left out, not problems", () => {
    expect(matchRows(feedRows(day("2026-11-03", "2026-11-03")), FX.board["20261103"]).unpriced).toEqual(["Incarnate Word at Tulsa"]);
    expect(matchRows(feedRows(day("2026-11-05", "2026-11-05")), FX.board["20261105"]).unpriced).toEqual(["Boston College at Harvard"]);
  });

  it("matches a neutral-site game ESPN lists the other way round, keeping his home team's id", () => {
    const g = FX.board["20261106"][0];
    const rows = feedRows({ headers: nov6.headers, rows: [["2026-11-06", g.home.name, g.away.name, "Y", "-2.5", "-4", "0.6", "-1.5", `${g.away.name} -2.5`, "N"]] });
    const m = matchRows(rows, [g]);
    expect(m.rows[0]).toMatchObject({ event: g.id, homeId: g.away.id, awayId: g.home.id });
  });

  it("an unknown team name is a problem and named", () => {
    const rows = feedRows({ headers: nov6.headers, rows: [["2026-11-06", "Nowhere Tech", "Ohio State", "N", "-30", "-28", "0.4", "+2", "Nowhere Tech +30", "N"]] });
    const m = matchRows(rows, FX.board["20261106"]);
    expect(m.unmatched).toEqual(["Nowhere Tech"]);
    expect(m.problems[0]).toMatch(/no game on our board/);
  });
});

describe("pregame numbers only", () => {
  const base = { away: "A", home: "B", neutral: false, spread: -3, model: -5, conf: 0.6, edge: -2, pick: "home" as const, trigger: false, event: "9", homeId: "h", awayId: "a", tip: "2026-11-06T23:00:00Z" };
  it("a read before tip sets pre; a later read never changes it", () => {
    const first = mergeDay(undefined, [base], "2026-11-06T15:00:00Z");
    expect(first[0].pre).toEqual({ at: "2026-11-06T15:00:00Z", model: -5, spread: -3, trigger: false });
    const after = mergeDay(first, [{ ...base, model: -9 }], "2026-11-07T03:00:00Z");
    expect(after[0].model).toBe(-9);
    expect(after[0].pre?.model).toBe(-5);
    expect(preOf(after)).toEqual({ "9": { homeId: "h", at: "2026-11-06T15:00:00Z", model: -5, spread: -3, trigger: false } });
  });
  it("a day read only after its games has no pregame numbers", () => {
    expect(mergeDay(undefined, [base], "2026-11-07T03:00:00Z")[0].pre).toBeUndefined();
  });
});

describe("Harris slices", () => {
  const parts = { ours: { margin: 4, total: 140 }, trank: null };
  const snap = { at: "2026-11-06T12:00:00Z", spread: -3, homePrice: -110, awayPrice: -110, total: 140, open: { spread: -3, total: 140 }, ours: { spread: -4, total: 140, homeWin: 0.6 }, parts };
  const g: TrackedCbbGame = { event: "9", home: "h", away: "a", homeName: "B", awayName: "A", tip: "2026-11-20T23:00:00Z", neutral: false, first: snap, last: snap, final: { home: 80, away: 70 } };
  it("his side against our saved line, turned to our home team", () => {
    // He has h by 8 (model -8) against our -3: h covers by his number by 5.
    expect(harrisRead(g, { homeId: "h", model: -8, spread: -3.5, trigger: true, at: "2026-11-20T12:00:00Z" })).toEqual({ side: "home", edge: 5, trigger: true });
    // Same numbers with ESPN's home as his away team: he has a by 8.
    expect(harrisRead(g, { homeId: "a", model: -8, spread: -3.5, trigger: false, at: "2026-11-20T12:00:00Z" })).toEqual({ side: "away", edge: 11, trigger: false });
    // A read after tip is never used.
    expect(harrisRead(g, { homeId: "h", model: -8, spread: -3.5, trigger: false, at: "2026-11-21T01:00:00Z" })).toBeUndefined();
  });
  it("grade like every other slice, at our first saved price", () => {
    const c = cbbCandidates([g], 2026, { "9": { homeId: "h", model: -8, spread: -3.5, trigger: true, at: "2026-11-20T12:00:00Z" } });
    expect(c.length).toBe(CBB_SLICES.length);
    const bets = (id: string) => c.find((x) => x.id === id)!.bets;
    expect(bets("cbb:harris")).toMatchObject([{ key: "9|home", net: 0.909 }]);
    expect(bets("cbb:harris5")).toHaveLength(1);
    expect(bets("cbb:harris-trigger")).toHaveLength(1);
    expect(bets("cbb:harris-agree")).toHaveLength(1);
    expect(bets("cbb:harris-split")).toEqual([]);
    // Without his numbers his slices have no bets and ours are unchanged.
    const none = cbbCandidates([g], 2026);
    expect(none.find((x) => x.id === "cbb:harris")!.bets).toEqual([]);
    expect(none.find((x) => x.id === "cbb:lean")!.bets).toEqual(c.find((x) => x.id === "cbb:lean")!.bets);
  });
});

describe("usable days", () => {
  it("counts verified days of days on file", () => {
    expect(usableDays([{ date: "2026-11-04", verified: false }, { date: "2026-11-03", verified: true }])).toEqual({ usable: 1, total: 2, missing: ["2026-11-04"] });
  });
});

describe("matchRows with a typo row", () => {
  it("keeps an Edge = Model row and sets a wrong-side pick aside, the day stays clean", () => {
    const games: BoardTeams[] = [
      { id: "g1", tip: "2026-11-07T00:00:00Z", home: { id: "1", name: "Ohio State Buckeyes", short: "Ohio State" }, away: { id: "2", name: "Youngstown State Penguins", short: "Youngstown State" } },
      { id: "g2", tip: "2026-11-07T00:00:00Z", home: { id: "3", name: "Minnesota Golden Gophers", short: "Minnesota" }, away: { id: "4", name: "St. Thomas Tommies", short: "St. Thomas" } },
    ];
    const bad = { date: "2026-11-06", away: "Youngstown State", home: "Ohio State", neutral: false, spread: -25.5, model: -24.7, confidence: 0.477, edge: -24.7, pick: "away", trigger: false };
    const wrongSide = { date: "2026-11-06", away: "St. Thomas", home: "Minnesota", neutral: false, spread: -14.5, model: -14, confidence: 0.489, edge: 0.5, pick: "home", trigger: false };
    const m = matchRows([bad, wrongSide] as never, games);
    expect(m.problems).toEqual([]);
    expect(m.setAside).toHaveLength(1);
    expect(m.setAside[0]).toMatch(/St. Thomas at Minnesota/);
    expect(m.rows.map((r) => r.home)).toEqual(["Ohio State"]);
  });
});


describe("fetchHarrisCbb: slow feed", () => {
  it("a timed-out read throws HarrisCbbSlow (the pulse retries it, not a failure)", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new DOMException("timed out", "TimeoutError"));
    await expect(fetchHarrisCbb("2026-11-11", "https://x.test", 18_000)).rejects.toThrow(HarrisCbbSlow);
    await expect(fetchHarrisCbb("2026-11-11", "https://x.test", 18_000)).rejects.toThrow("his feed took over 18s for 2026-11-11");
    spy.mockRestore();
  });
  it("any other network error passes through unchanged", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));
    await expect(fetchHarrisCbb("2026-11-11", "https://x.test")).rejects.toThrow(TypeError);
    spy.mockRestore();
  });
});
