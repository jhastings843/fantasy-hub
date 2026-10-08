import { describe, expect, it } from "vitest";
import { checkRow, harrisKey, matchGame, parsePicks, toHarrisRows } from "./harris-sheet";

describe("harrisKey", () => {
  it("expands his abbreviations to our team keys", () => {
    expect(harrisKey("S. Alabama")).toBe("south alabama");
    expect(harrisKey("Wash. St.")).toBe("washington state");
    expect(harrisKey("Ga. Southern")).toBe("georgia southern");
    expect(harrisKey("BGSU")).toBe("bowling green");
    expect(harrisKey("Miss. St.")).toBe("mississippi state");
    expect(harrisKey("So. Miss")).toBe("southern miss");
    expect(harrisKey("Miami-OH")).toBe("miami oh");
    expect(harrisKey("Ole Miss")).toBe("ole miss");
    expect(harrisKey("Pitt")).toBe("pittsburgh");
  });
});

describe("checkRow", () => {
  it("passes when Average + Spread = Diff, fails otherwise", () => {
    expect(checkRow({ away: "Iowa", home: "Washington", average: -1.14, spread: -3.5, diff: -4.64 })).toBeNull();
    expect(checkRow({ away: "Iowa", home: "Washington", average: -1.14, spread: -3.5, diff: -3.64 })).toMatch(/not diff/);
    expect(checkRow({ away: "a", home: "b", average: 4.245, spread: -3, diff: 1.24 })).toBeNull();
  });
});

describe("matchGame and toHarrisRows", () => {
  const games = [
    { away: "iowa", home: "washington" },
    { away: "south alabama", home: "arkansas state" },
    { away: "georgia", home: "alabama" },
    { away: "uab", home: "memphis" },
  ];
  it("matches abbreviations, and a game listed the other way round with the sign flipped", () => {
    expect(matchGame("S. Alabama", "Arkansas St.", games)).toEqual({ away: "south alabama", home: "arkansas state", swapped: false });
    const { rows, problems } = toHarrisRows(
      [
        { away: "Iowa", home: "Washington", average: -1.14, spread: -3.5, diff: -4.64 },
        { away: "Alabama", home: "Georgia", average: 2, spread: -1.5, diff: 0.5 },
        { away: "Nowhere", home: "Somewhere", average: 1, spread: 1 },
      ],
      games,
    );
    expect(rows[0]).toMatchObject({ away: "iowa", home: "washington", model: 1.14, market: -3.5 });
    // Swapped: Georgia "home" by 2 on his sheet = Alabama (our home) loses by 2.
    expect(rows[1]).toMatchObject({ away: "georgia", home: "alabama", model: 2, market: 1.5 });
    expect(problems).toEqual(["Nowhere at Somewhere: no matching game this week"]);
  });
});

describe("parsePicks", () => {
  const w6 = `CONTEST PICKS OF THE WEEK

Best Picks
Iowa +3.5 (Confidence, Edge, Picker Vs, Scenarios)

BYU -10.5 (Confidence, Edge, Picker Vs, Signals)

Best
James Madison -7.5 (Confidence, Edge, Signals, Scenarios)

Games of the Week
Georgia +1.5
Nebraska +7.5 (Liked it a lot more at 9)

Strong - Not Played
Vandy -20.5 (Edge, Picker Vs)

Others Considered
San Diego St +14.5
Memphis -14.5

Tracking

Last Week
Best 2-1`;
  it("reads each section; a second Best heading is his Strong tier; not-played and tracking lines are skipped", () => {
    expect(parsePicks(w6)).toEqual([
      { tier: "best", team: "Iowa", line: 3.5 },
      { tier: "best", team: "BYU", line: -10.5 },
      { tier: "strong", team: "James Madison", line: -7.5 },
      { tier: "gow", team: "Georgia", line: 1.5 },
      { tier: "gow", team: "Nebraska", line: 7.5 },
      { tier: "other", team: "San Diego St", line: 14.5 },
      { tier: "other", team: "Memphis", line: -14.5 },
    ]);
  });
});
