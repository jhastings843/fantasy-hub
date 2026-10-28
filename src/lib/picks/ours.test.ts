import { describe, expect, it } from "vitest";
import { latestOurs, oursSuRecord } from "./ours";
import { suPick } from "./engine";
import type { ForecastSnapshot } from "./forecasts";

const snap = (at: string, model: number, kickoff = "2026-11-01T17:00:00Z"): ForecastSnapshot => ({
  at, week: 9, home: "KC", away: "BUF", ref: { line: -2.5, source: "DraftKings", fetchedAt: at, kickoff } as ForecastSnapshot["ref"], ours: { market: -2.5, model, total: 48 },
});

describe("our model on the board", () => {
  it("keeps the last read before kickoff, never one after", () => {
    const m = latestOurs([snap("2026-10-30T12:00:00Z", -1), snap("2026-11-01T12:00:00Z", -4), snap("2026-11-01T18:00:00Z", 6)]);
    expect([...m.values()].map((o) => o.model)).toEqual([-4]);
  });

  it("straight-up record counts our projected winner, ties and pick'ems left out", () => {
    const ours = new Map([["a", { market: -3, model: -2 }], ["b", { market: 3, model: 1.5 }], ["c", { market: 1, model: 0 }], ["d", { market: 1, model: -1 }]]);
    const finals = new Map([["a", { home: 24, away: 20 }], ["b", { home: 24, away: 20 }], ["c", { home: 10, away: 7 }], ["d", { home: 17, away: 17 }]]);
    expect(oursSuRecord(ours, finals)).toMatchObject({ id: "ours", w: 1, l: 1 });
  });

  it("suPick 'ours' follows our spread, and stands in with the models' average when we have none", () => {
    const sam = { market: -3, model: 2 };
    const david = { market: -3, model: 4 };
    expect(suPick("ours", sam, david, -3, -1.5)).toEqual({ side: "home", margin: 1.5 });
    expect(suPick("ours", sam, david, -3)).toEqual(suPick("avg", sam, david, -3));
  });
});
