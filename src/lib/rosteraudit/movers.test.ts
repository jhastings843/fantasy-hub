import { describe, expect, it } from "vitest";
import { moversFromValues } from "./movers";
import type { RAValue, RAValuesBySleeperId } from "./types";

function player(
  id: string,
  over: Partial<RAValue> & { position?: string },
): RAValue {
  return {
    sleeperId: id,
    name: `Player ${id}`,
    position: "WR",
    team: "KC",
    age: 25,
    tier: 2,
    value: 5000,
    overallRank: 10,
    positionRank: 5,
    trend7Day: 0,
    trend30Day: 0,
    buyLow: false,
    sellHigh: false,
    breakout: false,
    photoUrl: null,
    ...over,
  };
}

function byId(...players: RAValue[]): RAValuesBySleeperId {
  return Object.fromEntries(players.map((p) => [p.sleeperId, p]));
}

describe("moversFromValues", () => {
  it("splits players into risers and fallers by 7-day trend, biggest move first", () => {
    const values = byId(
      player("a", { trend7Day: 300 }),
      player("b", { trend7Day: -450 }),
      player("c", { trend7Day: 900 }),
      player("d", { trend7Day: -120 }),
      player("e", { trend7Day: 0 }),
    );
    const { risers, fallers } = moversFromValues(values, 30);
    expect(risers.map((m) => m.sleeperId)).toEqual(["c", "a"]);
    expect(fallers.map((m) => m.sleeperId)).toEqual(["b", "d"]);
  });

  it("falls back to the 30-day trend when the source has no 7-day trend", () => {
    // FantasyCalc (redraft) values carry only a 30-day trend.
    const values = byId(
      player("a", { trend7Day: 0, trend30Day: 200 }),
      player("b", { trend7Day: 0, trend30Day: -80 }),
    );
    const { risers, fallers } = moversFromValues(values, 30);
    expect(risers.map((m) => m.sleeperId)).toEqual(["a"]);
    expect(fallers.map((m) => m.sleeperId)).toEqual(["b"]);
  });

  it("prefers the 7-day trend over the 30-day trend when both exist", () => {
    const values = byId(player("a", { trend7Day: -50, trend30Day: 400 }));
    const { risers, fallers } = moversFromValues(values, 30);
    expect(risers).toEqual([]);
    expect(fallers.map((m) => m.sleeperId)).toEqual(["a"]);
  });

  it("caps each list at the limit", () => {
    const values = byId(
      ...Array.from({ length: 12 }, (_, i) =>
        player(`r${i}`, { trend7Day: 100 + i }),
      ),
      ...Array.from({ length: 12 }, (_, i) =>
        player(`f${i}`, { trend7Day: -(100 + i) }),
      ),
    );
    const { risers, fallers } = moversFromValues(values, 5);
    expect(risers).toHaveLength(5);
    expect(fallers).toHaveLength(5);
    expect(risers[0].sleeperId).toBe("r11");
    expect(fallers[0].sleeperId).toBe("f11");
  });

  it("only tracks the positions the page shows", () => {
    const values = byId(
      player("k", { position: "K", trend7Day: 500 }),
      player("def", { position: "DEF", trend7Day: 500 }),
      player("qb", { position: "QB", trend7Day: 100 }),
    );
    const { risers } = moversFromValues(values, 30);
    expect(risers.map((m) => m.sleeperId)).toEqual(["qb"]);
  });

  it("carries the fields the mover row renders", () => {
    const values = byId(
      player("a", {
        name: "Bijan Robinson",
        position: "RB",
        team: "ATL",
        age: 24.6,
        tier: 1,
        value: 9800,
        trend7Day: 584,
        trend30Day: 556,
        buyLow: true,
        breakout: true,
      }),
    );
    const { risers } = moversFromValues(values, 30);
    expect(risers[0]).toEqual({
      sleeperId: "a",
      name: "Bijan Robinson",
      position: "RB",
      team: "ATL",
      age: 24.6,
      tier: 1,
      valueSf: 9800,
      trend7Day: 584,
      trend30Day: 556,
      buyLow: true,
      sellHigh: false,
      breakout: true,
    });
  });
});
