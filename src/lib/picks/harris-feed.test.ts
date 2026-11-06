import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { feedToSheet, feedWeek, fetchHarrisFeed, type FeedTable } from "./harris-feed";
import { checkRow, toHarrisRows, type HarrisRow } from "./harris-sheet";

const FIX = path.join(__dirname, "../../../test/fixtures/picks/harris");
const load = (f: string) => JSON.parse(readFileSync(path.join(FIX, f), "utf8"));
const w10: FeedTable = load("feed-w10.json").picks;

describe("feedToSheet", () => {
  it("maps his row onto the image sheet's Average / Spread / Diff", () => {
    // Ohio at Akron: Spread 13.5 (Akron +13.5), Model +14.7 (Ohio by 14.7), Edge -1.2 (away side).
    const [ohio] = feedToSheet({ headers: w10.headers, rows: [w10.rows[0]] });
    expect(w10.rows[0]).toEqual(["Week 10", "Ohio", "Akron", "N", "13.5", "13.5", "+14.7", "0.463", "-1.2", "Ohio -13.5", "N"]);
    expect(ohio).toEqual({ away: "Ohio", home: "Akron", average: -14.7, spread: 13.5, diff: -1.2 });
    expect(checkRow(ohio)).toBeNull();
    // Stored on the home scale: his line Akron +14.7, the market Akron +13.5.
    const { rows } = toHarrisRows([ohio], [{ away: "ohio", home: "akron" }]);
    expect(rows[0]).toMatchObject({ model: 14.7, market: 13.5 });
  });

  it("home favorite: App St. -4.5, he has them by 3.6, Edge -0.9 takes Georgia St.", () => {
    const row = w10.rows.find((r) => r[2] === "App. St.")!;
    const [s] = feedToSheet({ headers: w10.headers, rows: [row] });
    expect(s).toMatchObject({ average: 3.6, spread: -4.5 });
    expect(s.diff).toBeCloseTo(-0.9, 9);
  });

  it("every week 10 row passes the sheet's own check (Spread - Model = Edge, to rounding)", () => {
    const sheet = feedToSheet(w10);
    expect(sheet).toHaveLength(62);
    expect(sheet.filter((r) => checkRow(r))).toEqual([]);
  });

  it("keeps the printed Edge when it is off by more than rounding, so the check names the row", () => {
    const row = ["Week 10", "A", "B", "N", "-3.5", "-3", "-2.0", "0.5", "-0.9", "", "N"];
    const [s] = feedToSheet({ headers: w10.headers, rows: [row] });
    expect(checkRow(s)).toMatch(/not diff/);
  });

  it("finds columns by name, and throws when one is gone", () => {
    const order = [8, 6, 4, 2, 1];
    const swapped = { headers: order.map((i) => w10.headers[i]), rows: [order.map((i) => w10.rows[0][i])] };
    expect(feedToSheet(swapped)[0]).toEqual(feedToSheet({ headers: w10.headers, rows: [w10.rows[0]] })[0]);
    expect(() => feedToSheet({ headers: ["Away", "Home"], rows: [] })).toThrow(/missing a column/);
  });
});

describe("feedWeek", () => {
  it("reads the week from the Date column", () => {
    expect(feedWeek(w10)).toBe(10);
    expect(feedWeek({ headers: w10.headers, rows: [] })).toBeNull();
  });
});

describe("feed vs the verified image reads (weeks 6 and 7)", () => {
  // Fetched 2026-11-06 with picks_date=Week 6 / Week 7, next to the sheets the
  // image reader stored then. His line (model) matches every game to the
  // feed's 0.1 rounding. The market matches every week 7 game; in week 6 his
  // site shows the line he last updated to, 0.5 to 2 points off the line in
  // the posted image on 11 of 36 games.
  for (const [week, n, marketSame] of [
    [6, 36, 25],
    [7, 59, 59],
  ] as const) {
    it(`week ${week}: all ${n} stored games found, models within 0.05`, () => {
      const fx = load(`w${week}-feed-vs-image.json`);
      const stored: HarrisRow[] = fx.stored.rows;
      const { rows } = toHarrisRows(
        feedToSheet(fx.feed),
        stored.map((r) => ({ away: r.away, home: r.home })),
      );
      const by = new Map(rows.map((r) => [`${r.away}@${r.home}`, r]));
      let same = 0;
      for (const s of stored) {
        const f = by.get(`${s.away}@${s.home}`);
        expect(f, `${s.away} at ${s.home}`).toBeDefined();
        expect(Math.abs(f!.model - s.model)).toBeLessThanOrEqual(0.05 + 1e-9);
        if (f!.market === s.market) same++;
      }
      expect(stored).toHaveLength(n);
      expect(same).toBe(marketSame);
    });
  }
});

describe("fetchHarrisFeed", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("asks for one week by picks_date and returns its table", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ sport: "cfb", tabs: { picks: w10 } })));
    vi.stubGlobal("fetch", fetchMock);
    const t = await fetchHarrisFeed(10, "https://example.test/exec");
    expect(t.rows).toHaveLength(62);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe("https://example.test/exec?picks_date=Week%2010");
  });

  it("refuses a table for a different week", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ tabs: { picks: w10 } }))));
    await expect(fetchHarrisFeed(9, "https://example.test/exec")).rejects.toThrow(/week 10 when asked for week 9/);
  });
});
