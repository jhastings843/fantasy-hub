import { describe, expect, it } from "vitest";
import { boardWeek, carryStarted, finishedResults, gradeFinished, reviewedThisWeek, rowsFromForecasts } from "./finished";
import { gradeGame, key } from "./engine";

// ET is UTC-4 in October.
const et = (iso: string) => new Date(`${iso}-04:00`);

describe("boardWeek", () => {
  it("holds the week through Monday night and turns over at 4am ET Tuesday", () => {
    expect(boardWeek("nfl", 5, et("2026-10-12T23:30:00")).week).toBe(5); // MNF
    expect(boardWeek("nfl", 5, et("2026-10-13T03:59:00")).week).toBe(5); // late MNF finish
    expect(boardWeek("nfl", 5, et("2026-10-13T04:00:00"))).toEqual({ week: 6, awaiting: true }); // models not posted yet
    expect(boardWeek("cfb", 6, et("2026-10-13T09:00:00"))).toEqual({ week: 7, awaiting: true });
  });
  it("keeps a site that posts next week early on this week until the turnover", () => {
    expect(boardWeek("nfl", 6, et("2026-10-11T20:00:00"))).toEqual({ week: 5, awaiting: false });
  });
  it("is not awaiting once a site has posted the calendar week", () => {
    expect(boardWeek("nfl", 6, et("2026-10-13T09:00:00"))).toEqual({ week: 6, awaiting: false });
  });
  it("falls back to the sites' week when the calendar runs more than a week ahead", () => {
    expect(boardWeek("nfl", 5, et("2026-10-21T12:00:00")).week).toBe(5);
  });
});

describe("gradeFinished", () => {
  const sam = { market: -10.5, model: -14 };
  const david = { market: -10, model: -12 };
  const rows = [
    { home: "troy", away: "southern miss", sam, david },
    { home: "fiu", away: "nmsu", sam, david },
    { home: "liberty", away: "shsu", sam }, // one model only
    { home: "utsa", away: "usf", sam, david }, // not final
  ];
  const finals = new Map([
    [key({ week: 6, home: "troy", away: "southern miss" }), { home: 55, away: 34 }],
    [key({ week: 6, home: "fiu", away: "nmsu" }), { home: 22, away: 3 }],
    [key({ week: 6, home: "liberty", away: "shsu" }), { home: 20, away: 3 }],
  ]);
  it("grades finished two-model games and leaves site-graded ones to the site", () => {
    const site = gradeGame({ week: 6, home: "fiu", away: "nmsu", final: { home: 22, away: 3 }, sam, david });
    const out = gradeFinished(6, rows, finals, [site]);
    expect(out.map((g) => g.home)).toEqual(["troy"]);
    expect(out[0].result).toBe("W");
    expect(out[0].samResult).toBe("W");
  });
  it("does nothing without a week", () => {
    expect(gradeFinished(null, rows, finals, [])).toEqual([]);
  });
});

describe("finishedResults", () => {
  it("grades the pick, the sent bet and each model at its own line", () => {
    const r = finishedResults(
      {
        home: "kennesaw state",
        away: "jacksonville state",
        sam: { market: -2.5, model: -5 }, // Kennesaw
        david: { market: -3, model: -1 }, // Jacksonville St
        pem: { model: 4, market: -3 }, // Jacksonville St
        side: "away",
        homeLine: -3,
        issued: { homeLine: -2.5, side: "away" },
      },
      { home: 26, away: 27 },
    );
    expect(r).toEqual({ pick: "W", issued: "W", sam: "L", david: "W", pem: "W" });
  });
  it("leaves out a model sitting exactly on the line", () => {
    expect(finishedResults({ home: "a", away: "b", sam: { market: -3, model: -3 } }, { home: 10, away: 7 }).sam).toBeUndefined();
  });
});

describe("carryStarted", () => {
  const now = new Date("2026-10-08T23:45:00Z");
  it("keeps games ESPN dropped after kickoff, not ones still listed or not yet started", () => {
    const prev: [string, { kickoff?: string }][] = [
      ["6:shsu@liberty", { kickoff: "2026-10-08T23:00:00Z" }], // in progress, dropped
      ["6:usf@utsa", { kickoff: "2026-10-08T23:30:00Z" }], // still listed
      ["6:a@b", { kickoff: "2026-10-10T16:00:00Z" }], // dropped before kickoff (pulled line)
      ["6:c@d", {}],
    ];
    const fresh = new Map([["6:usf@utsa", { kickoff: "2026-10-08T23:30:00Z" }]]);
    expect(carryStarted(prev, fresh, now).map(([k]) => k)).toEqual(["6:shsu@liberty"]);
  });
});

describe("reviewedThisWeek", () => {
  // Tue Oct 13 2026: the week turns over at 4am ET (08:00Z), the review runs at 7am ET (11:00Z).
  const review = "2026-10-13T11:00:00.000Z";
  it("is false after the turnover until this week's review has run", () => {
    expect(reviewedThisWeek("nfl", "2026-10-06T11:00:00.000Z", new Date("2026-10-13T10:00:00Z"))).toBe(false);
  });
  it("is true from the review through Monday night", () => {
    expect(reviewedThisWeek("nfl", review, new Date("2026-10-13T11:05:00Z"))).toBe(true);
    expect(reviewedThisWeek("cfb", review, new Date("2026-10-17T23:00:00Z"))).toBe(true);
    expect(reviewedThisWeek("nfl", review, new Date("2026-10-20T03:30:00Z"))).toBe(true);
  });
  it("is false once the next week turns over", () => {
    expect(reviewedThisWeek("nfl", review, new Date("2026-10-20T09:00:00Z"))).toBe(false);
  });
  it("still counts last week's review in the hours before the turnover", () => {
    expect(reviewedThisWeek("nfl", "2026-10-06T11:00:00.000Z", new Date("2026-10-13T07:00:00Z"))).toBe(true);
  });
  it("is false with no review", () => {
    expect(reviewedThisWeek("nfl", null, new Date("2026-10-13T12:00:00Z"))).toBe(false);
  });
});

describe("rowsFromForecasts", () => {
  const line = (model: number, market: number) => ({ model, market });
  const snap = (at: string, week: number, samModel: number, kickoff = "2026-10-12T00:20Z") => ({
    at,
    week,
    home: "KC",
    away: "BUF",
    sam: line(samModel, -3),
    david: line(-4, -3),
    ref: { line: -3, kickoff },
  });
  it("takes each game's latest pregame snapshot for that week only", () => {
    const rows = rowsFromForecasts(
      [snap("2026-10-08T03:00Z", 5, -1), snap("2026-10-11T12:00Z", 5, -2), snap("2026-10-12T01:00Z", 5, -9), snap("2026-10-13T15:00Z", 6, -7)] as never,
      5,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].sam?.model).toBe(-2);
  });
});
