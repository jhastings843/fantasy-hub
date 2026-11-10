import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { nbaNameIndex, nbaTv, parseDavidNbaGames, parseNbaScoreboard, parseSamNba, readDavid, readNba } from "./nba";

const fixture = (f: string) => readFileSync(path.resolve(__dirname, "../../../test/fixtures/picks", f), "utf8");
const slate = parseNbaScoreboard(JSON.parse(fixture("espn-scoreboard-nba-20261020.json")), "20261020");
const index = nbaNameIndex(slate);

// Sam's NFL card markup with NBA names, the shape his NBA board most likely takes.
const card = (away: string, home: string, vegas: string, model: string, pts: [number, number]) => `
<article class="game" data-gap="1">
  <div class="teams">
    <div class="team"><div class="tn"><span class="nm">${away}</span></div><div class="pts">${pts[0]}</div></div>
    <div class="team"><div class="tn"><span class="nm">${home}</span></div><div class="pts">${pts[1]}</div></div>
  </div>
  <div class="mkt">
    <div><span class="lbl">Vegas line</span><span class="val">${vegas}</span></div>
    <div><span class="lbl">Model line</span><span class="val mono">${model}</span></div>
  </div>
</article>`;

describe("ESPN NBA scoreboard", () => {
  it("reads opening night with DraftKings lines from the home side", () => {
    expect(slate.map((g) => `${g.away.abbr}@${g.home.abbr}`)).toEqual(["BOS@DET", "PHI@NY", "OKC@SA"]);
    const det = slate[0];
    // ESPN shows "BOS -1.5", so Detroit at home is +1.5.
    expect(det.line).toEqual({ home: 1.5, homePrice: -115, awayPrice: expect.any(Number) });
    expect(det.total?.points).toBe(222.5);
    expect(det.ml?.home).toBe(-105);
    expect(det.state).toBe("pre");
    expect(det.score).toBeUndefined();
  });

  it("handles a day with no games and an unpriced game", () => {
    expect(parseNbaScoreboard({ events: [] }, "20261019")).toEqual([]);
    const bare = {
      events: [{ id: "1", date: "2026-10-20T23:00Z", competitions: [{ status: { type: { state: "post", shortDetail: "Final" } }, competitors: [
        { homeAway: "home", score: "110", team: { abbreviation: "NY", displayName: "New York Knicks", shortDisplayName: "Knicks" } },
        { homeAway: "away", score: "104", team: { abbreviation: "PHI", displayName: "Philadelphia 76ers", shortDisplayName: "76ers" } },
      ] }] }],
    };
    const [g] = parseNbaScoreboard(bare, "20261020");
    expect(g.line).toBeUndefined();
    expect(g.score).toEqual({ home: 110, away: 104 });
  });
});

describe("Sam's NBA page", () => {
  it("reads today's placeholder as coming soon", () => {
    const r = parseSamNba(fixture("sam-nba-soon.html"), index);
    expect(r.state).toBe("soon");
    expect(r.state === "soon" && r.note).toMatch(/coming 10\/19/);
  });

  it("reads his board template and keys names to ESPN's abbreviations", () => {
    const html =
      card("Boston Celtics", "Detroit Pistons", "Boston Celtics -1.5", "Detroit Pistons -3", [110.2, 113.4]) +
      card("Philadelphia 76ers", "New York Knicks", "New York Knicks -4.5", "New York Knicks -2", [112, 114]) +
      card("Oklahoma City Thunder", "San Antonio Spurs", "San Antonio Spurs -2.5", "PK", [115, 115]);
    const r = parseSamNba(html, index);
    expect(r.state).toBe("live");
    if (r.state !== "live") return;
    expect(r.rows[0]).toEqual({ home: "DET", away: "BOS", model: -3, vegas: 1.5, total: 223.6 });
    expect(r.rows[1]).toMatchObject({ home: "NY", away: "PHI", model: -2, vegas: -4.5 });
    expect(r.rows[2]).toMatchObject({ home: "SA", away: "OKC", model: 0 });
  });

  it("reads his number when the card labels it \"Sam's line\" (MIN at CLE, 10-26)", () => {
    const html = card("Boston Celtics", "Detroit Pistons", "Boston Celtics -1.5", "Detroit Pistons -3", [110, 113]).replace("Model line", "Sam&rsquo;s line");
    const r = parseSamNba(html, index);
    expect(r.state === "live" && r.rows[0]).toMatchObject({ home: "DET", away: "BOS", model: -3 });
  });

  it("says unread when the page is up but has no cards it knows", () => {
    expect(parseSamNba("<html><body><table><tr><td>BOS</td></tr></table></body></html>", index).state).toBe("unread");
  });
});

describe("Sam's read at the DraftKings line", () => {
  it("takes the home dog when he has the home team winning", () => {
    const det = slate[0]; // DET +1.5
    const r = readNba(det, { home: "DET", away: "BOS", model: -3, vegas: 1.5, total: 230 });
    expect(r).toMatchObject({ model: -3, side: "home", edge: 4.5, totalSide: "over", totalEdge: 7.5 });
  });

  it("takes the road side when the book's favorite is too big for him", () => {
    const ny = slate[1]; // NY -4.5
    expect(readNba(ny, { home: "NY", away: "PHI", model: -2, vegas: -4.5 })).toMatchObject({ side: "away", edge: 2.5 });
  });

  it("takes Sam's posted side and flags it when DraftKings has crossed his number", () => {
    const ny = slate[1]; // NY -4.5 at DK
    // Sam posted NY -7 against a model of NY -5.5 (PHI); DK has since moved to NY -4.5.
    expect(readNba(ny, { home: "NY", away: "PHI", model: -5.5, vegas: -7 })).toMatchObject({ side: "away", edge: -1, crossed: true, samLine: -7 });
    // No posted line read: DraftKings decides, as before.
    expect(readNba(ny, { home: "NY", away: "PHI", model: -5.5, vegas: NaN })).toMatchObject({ side: "home", edge: 1, crossed: false });
  });

  it("is null without a model row or a line", () => {
    expect(readNba(slate[0], undefined)).toBeNull();
    expect(readNba({ ...slate[0], line: undefined }, { home: "DET", away: "BOS", model: -3, vegas: 1.5 })).toBeNull();
  });
});

describe("nbaTv", () => {
  it("prefers a national broadcast, else the first listed", () => {
    expect(nbaTv({ geoBroadcasts: [{ media: { shortName: "NBCS-BOS" }, market: { type: "Home" } }, { media: { shortName: "ESPN" }, market: { type: "National" } }] })).toBe("ESPN");
    expect(nbaTv({ broadcasts: [{ market: "home", names: ["FDSN Ohio"] }] })).toBe("FDSN Ohio");
    expect(nbaTv({})).toBeUndefined();
  });
});

describe("David's NBA game board", () => {
  it("reads the Nov 9 slate from the RSC payload, home side, keyed by ESPN id", () => {
    const d = parseDavidNbaGames(fixture("ds-nba-board.html"));
    expect(d.state).toBe("live");
    if (d.state !== "live") return;
    expect(d.rows).toHaveLength(8);
    // LAL at ATL: projection.homeSpread 0.8666 (ATL +0.9), total 233.57, posted ATL -1.5 and 237.5.
    expect(d.rows[0]).toEqual({ id: "401909952", home: "ATL", away: "LAL", model: 0.9, total: 233.6, line: -1.5, postedTotal: 237.5 });
  });

  it("says unread, not empty, when the slate isn't in the page", () => {
    expect(parseDavidNbaGames("<html><body>NBA</body></html>").state).toBe("unread");
  });

  it("takes his side against his posted line and measures the edge at DraftKings", () => {
    // ATL +0.9 model, he posted ATL -1.5, DK still ATL -1.5: Lakers +1.5 by 2.4, under by 3.9.
    const r = readDavid({ line: { home: -1.5 }, total: { points: 237.5 } }, { model: 0.9, total: 233.6, line: -1.5 });
    expect(r).toMatchObject({ side: "away", edge: 2.4, crossed: false, davidLine: -1.5, totalSide: "under", totalEdge: 3.9 });
    // DK moves to ATL +2: through his number, so his Lakers side is crossed.
    expect(readDavid({ line: { home: 2 } }, { model: 0.9, line: -1.5 })).toMatchObject({ side: "away", edge: -1.1, crossed: true });
  });
});
