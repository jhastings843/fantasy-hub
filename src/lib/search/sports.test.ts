import { describe, expect, it } from "vitest";
import { currentOnly, type Dated } from "./sports";

const e = (key: string, subjects: string[], at: string, done: boolean): Dated => ({ key, title: key, meta: "", terms: "", rank: 1, rows: [], subjects, at, done });

describe("currentOnly", () => {
  it("drops a finished game once every team in it has a later game posted", () => {
    const out = currentOnly([
      e("old", ["nba:BOS", "nba:NY"], "2026-11-01T23:30:00Z", true),
      e("bos-next", ["nba:BOS", "nba:MIA"], "2026-11-03T23:30:00Z", false),
      e("ny-next", ["nba:NY", "nba:CHI"], "2026-11-04T00:00:00Z", false),
    ]).map((x) => x.key);
    expect(out).toEqual(["bos-next", "ny-next"]);
  });
  it("keeps it while one team has nothing newer, so its last result is still findable", () => {
    const out = currentOnly([e("old", ["nba:BOS", "nba:NY"], "2026-11-01T23:30:00Z", true), e("bos-next", ["nba:BOS", "nba:MIA"], "2026-11-03T23:30:00Z", false)]).map((x) => x.key);
    expect(out).toEqual(["old", "bos-next"]);
  });
  it("never drops a game that hasn't ended, and keeps a player's latest final", () => {
    const out = currentOnly([
      e("live", ["cbb:1", "cbb:2"], "2026-11-02T23:00:00Z", false),
      e("tomorrow", ["cbb:1", "cbb:3"], "2026-11-03T23:00:00Z", false),
      e("p-old", ["nba:BOS"], "2026-10-31T23:00:00Z", true),
      e("p-last", ["nba:BOS"], "2026-11-01T23:00:00Z", true),
    ]).map((x) => x.key);
    expect(out).toEqual(["live", "tomorrow", "p-last"]);
  });
  it("keeps last night's player props through the day, until his next props are saved", () => {
    const morning = currentOnly([
      e("tonight", ["nba:BOS", "nba:MIA"], "2026-11-03T23:30:00Z", false),
      e("brown-last", ["nbap:BOS|jaylen brown"], "2026-11-03T00:00Z", true),
    ]).map((x) => x.key);
    expect(morning).toEqual(["tonight", "brown-last"]);
    const evening = currentOnly([
      e("brown-last", ["nbap:BOS|jaylen brown"], "2026-11-03T00:00Z", true),
      e("brown-tonight", ["nbap:BOS|jaylen brown"], "2026-11-03T23:30:00Z", false),
    ]).map((x) => x.key);
    expect(evening).toEqual(["brown-tonight"]);
  });
});
