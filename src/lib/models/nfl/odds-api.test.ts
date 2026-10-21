import { describe, expect, it } from "vitest";
import { samTeam } from "@/lib/firsttd/grade";
import { fdProp, matchEvent, oddsPrice, parseEventOdds, readDue } from "./odds-api";

// Shaped like The Odds API's /events/{id}/odds response (docs example, 2026-10-21).
const body = {
  bookmakers: [
    {
      key: "fanduel",
      markets: [
        { key: "player_rush_yds", outcomes: [{ name: "Over", description: "Chase Brown", price: 999, point: 1 }] },
        { key: "player_rec", outcomes: [] },
        {
          key: "player_reception_yds",
          outcomes: [
            { name: "Over", description: "Ja'Marr Chase", price: -105, point: 79.5 },
            { name: "Under", description: "Ja'Marr Chase", price: -125, point: 79.5 },
          ],
        },
      ],
    },
    {
      key: "draftkings",
      markets: [
        {
          key: "player_rush_yds",
          outcomes: [
            { name: "Over", description: "Chase Brown", price: -115, point: 76.5 },
            { name: "Under", description: "Chase Brown", price: -115, point: 76.5 },
            { name: "Over", description: "Rico Dowdle", price: -105, point: 65.5 },
            { name: "Under", description: "Rico Dowdle", price: -125, point: 65.5 },
          ],
        },
        { key: "player_receptions", outcomes: [{ name: "Over", description: "Ja'Marr Chase", price: -130, point: 6.5 }] },
        { key: "player_1st_td", outcomes: [{ name: "Yes", description: "Ja'Marr Chase", price: 650 }, { name: "No", description: "Ja'Marr Chase", price: -1200 }] },
      ],
    },
  ],
};

describe("The Odds API reads", () => {
  const r = parseEventOdds(body, "2026-10-25T13:00:00Z");

  it("keeps DraftKings only, both sides, by player and stat", () => {
    expect(oddsPrice(r, "Chase Brown", "rush_yds", 76.5)).toEqual({ over: -115, under: -115 });
    expect(oddsPrice(r, "Rico Dowdle", "rush_yds", 65.5)).toEqual({ over: -105, under: -125 });
  });
  it("uses a price only at ESPN's line", () => {
    expect(oddsPrice(r, "Chase Brown", "rush_yds", 77.5)).toBeNull();
  });
  it("drops a market with one side missing", () => {
    expect(oddsPrice(r, "Ja'Marr Chase", "rec", 6.5)).toBeNull();
  });
  it("reads First TD yes prices, not the no side", () => {
    expect(Object.values(r.firstTd)).toEqual([650]);
  });
  it("keeps FanDuel apart, at its own line, both sides only", () => {
    expect(fdProp(r, "Ja'Marr Chase", "rec_yds")).toEqual({ line: 79.5, over: -105, under: -125 });
    expect(fdProp(r, "Chase Brown", "rush_yds")).toBeNull(); // one side only
    expect(oddsPrice(r, "Ja'Marr Chase", "rec_yds", 79.5)).toBeNull(); // DK's price never comes from FanDuel
  });
  it("tolerates junk", () => {
    expect(parseEventOdds(null, "x")).toMatchObject({ props: {}, firstTd: {} });
  });
});

describe("matching and timing", () => {
  const events = [{ id: "e1", home_team: "Los Angeles Rams", away_team: "Washington Commanders", commence_time: "2026-10-25T20:25:00Z" }];
  it("matches ESPN's abbreviations through samTeam", () => {
    expect(matchEvent(events, samTeam("LAR"), samTeam("WSH"), "2026-10-25T20:25Z")?.id).toBe("e1");
    expect(matchEvent(events, samTeam("LAR"), samTeam("WSH"), "2026-11-01T20:25Z")).toBeUndefined();
  });
  it("reads once, on game day, from 8am ET", () => {
    const k = "2026-10-25T17:00:00Z"; // Sunday 1pm EDT
    expect(readDue(k, new Date("2026-10-25T11:30:00Z"), false)).toBe(false); // 7:30am
    expect(readDue(k, new Date("2026-10-25T12:30:00Z"), false)).toBe(true); // 8:30am
    expect(readDue(k, new Date("2026-10-25T12:30:00Z"), true)).toBe(false); // already read
    expect(readDue(k, new Date("2026-10-24T22:30:00Z"), false)).toBe(false); // Saturday
    expect(readDue(k, new Date("2026-10-25T17:30:00Z"), false)).toBe(false); // kicked off
  });
});
