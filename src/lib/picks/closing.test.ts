import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { clvPoints, clvTable, parseScoreboard, parseSummary, playsClv, type ClosingLine } from "./closing";
import { gradeGame, key } from "./engine";

const fx = (f: string) => JSON.parse(readFileSync(path.resolve(__dirname, "../../../test/fixtures/picks", f), "utf8"));

describe("ESPN parsing", () => {
  it("reads Week 4 NFL events as the models' abbreviations", () => {
    const evs = parseScoreboard("nfl", fx("espn-scoreboard-nfl-w4.json"));
    expect(evs.length).toBeGreaterThanOrEqual(14);
    expect(evs[0]).toEqual({ id: "401872964", home: "CLE", away: "PIT", completed: true });
    // ESPN's WSH and LAR are WAS and LA on both sites.
    expect(evs.some((e) => e.home === "WAS" || e.away === "WAS")).toBe(true);
    expect(evs.every((e) => e.home !== "WSH" && e.away !== "WSH" && e.home !== "LAR" && e.away !== "LAR")).toBe(true);
  });

  it("reads open and close off a finished game (PIT at CLE, Week 4)", () => {
    expect(parseSummary(fx("espn-summary-nfl.json"))).toEqual({ open: 2.5, close: 2.5, totalOpen: 40.5, totalClose: 38.5 });
  });

  it("handles pick'em and an unpriced game", () => {
    const pk = { pickcenter: [{ pointSpread: { home: { open: { line: "PK" }, close: { line: "-1" } } } }] };
    expect(parseSummary(pk)).toMatchObject({ open: 0, close: -1 });
    expect(parseSummary({ pickcenter: [] })).toBeNull();
    expect(parseSummary({})).toBeNull();
  });

  it("folds college locations through the shared aliases", () => {
    const sb = {
      events: [
        {
          id: "1",
          status: { type: { completed: true } },
          competitions: [
            {
              competitors: [
                { homeAway: "home", team: { location: "NC State" } },
                { homeAway: "away", team: { location: "App State" } },
              ],
            },
          ],
        },
      ],
    };
    expect(parseScoreboard("cfb", sb)[0]).toMatchObject({ home: "nc state", away: "appalachian state" });
  });
});

describe("closing-line value", () => {
  it("is positive when the bet beat the close", () => {
    // Took the home team -3, it closed -4.5: 1.5 points better.
    expect(clvPoints("home", -3, -4.5)).toBe(1.5);
    // Took the road team with home -3 (road +3), it closed home -1.5 (road +1.5).
    expect(clvPoints("away", -3, -1.5)).toBe(1.5);
    expect(clvPoints("away", -3, -4.5)).toBe(-1.5);
  });

  const final = { home: 20, away: 17 };
  const games = [
    // Both on the road dog at +3 (home -3); closed home -2: rule and both models beat it by 1.
    gradeGame({ week: 5, home: "CLE", away: "PIT", final, sam: { market: -3, model: -1 }, david: { market: -3, model: 0 } }),
    // Split: Sam home, David road at -6; closed -7.
    gradeGame({ week: 5, home: "KC", away: "LV", final, sam: { market: -6, model: -9 }, david: { market: -6, model: -4 } }),
    // No closing line on file: left out.
    gradeGame({ week: 5, home: "NE", away: "NYJ", final, sam: { market: 1, model: -2 }, david: { market: 1, model: -1 } }),
  ];
  const closes = new Map<string, ClosingLine>(
    [
      { week: 5, home: "CLE", away: "PIT", open: -3, close: -2, totalOpen: null, totalClose: null },
      { week: 5, home: "KC", away: "LV", open: -6, close: -7, totalOpen: null, totalClose: null },
    ].map((c) => [key(c), c]),
  );

  it("scores each model at its own market and the shared pick at the worse line", () => {
    const rows = clvTable(games, closes, { label: "Agree on underdog", matches: (g) => !!g.read.dog });
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    // Sam: CLE game road... model -1 > market -3, so road: close -2 minus -3 = +1. KC: home, -6 - -7 = +1.
    expect(by.sam).toMatchObject({ n: 2, avg: 1, beat: 2, worse: 0 });
    // David: road on both: +1 and -7 - -6 = -1.
    expect(by.david).toMatchObject({ n: 2, avg: 0, beat: 1, worse: 1 });
    expect(by.agree).toMatchObject({ n: 1, avg: 1 });
    expect(by.rule).toMatchObject({ n: 1, avg: 1, note: "Agree on underdog" });
    expect(by.pem).toBeUndefined();
  });

  it("grades the plays as sent, by tier", () => {
    const rows = playsClv(
      [
        { week: 5, home: "CLE", away: "PIT", tier: "t1", side: "away", homeLine: -3 },
        { week: 5, home: "KC", away: "LV", tier: "t2", side: "home", homeLine: -6.5 },
        { week: 5, home: "NE", away: "NYJ", tier: "t1", side: "home", homeLine: 1 },
      ],
      closes,
    );
    expect(rows[0]).toMatchObject({ id: "t1", n: 1, avg: 1 });
    expect(rows[1]).toMatchObject({ id: "t2", n: 1, avg: 0.5 });
  });
});
