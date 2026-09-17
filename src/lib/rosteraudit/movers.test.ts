import { describe, expect, it } from "vitest";
import { moversFromValues } from "./movers";
import type { RAValue, RAValuesBySleeperId } from "./types";

function player(id: string, over: Partial<RAValue>): RAValue {
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
  it("splits FantasyCalc players into risers and fallers by 30-day points, biggest move first", () => {
    const values = byId(
      player("a", { trend30Day: 300 }),
      player("b", { trend30Day: -450 }),
      player("c", { trend30Day: 900 }),
      player("d", { trend30Day: -120 }),
      player("e", { trend30Day: 0 }),
    );
    const { risers, fallers } = moversFromValues(values, "fantasycalc", 30);
    expect(risers.map((m) => m.sleeperId)).toEqual(["c", "a"]);
    expect(fallers.map((m) => m.sleeperId)).toEqual(["b", "d"]);
    expect(risers[0].trend30Day).toBe(900);
  });

  it("ranks RosterAudit players by implied point change, not by raw percentage", () => {
    // Live data from 2026-09-16: a 37-point receiver who climbed from 10
    // carries a bigger basis-point trend than Bijan Robinson's week.
    const values = byId(
      player("barion", { value: 37, trend7Day: 27000 }),
      player("bijan", { value: 9985, trend7Day: 584 }),
      player("jones", { value: 1767, trend7Day: 8487 }),
    );
    const { risers } = moversFromValues(values, "rosteraudit", 30);
    expect(risers.map((m) => m.sleeperId)).toEqual(["jones", "bijan", "barion"]);
    expect(risers.map((m) => m.trend7Day)).toEqual([811, 551, 27]);
  });

  it("converts RosterAudit fallers the same way", () => {
    // Down 20% from 5,000 means 6,250 before.
    const values = byId(player("a", { value: 5000, trend7Day: -2000 }));
    const { fallers } = moversFromValues(values, "rosteraudit", 30);
    expect(fallers[0].trend7Day).toBe(-1250);
  });

  it("treats RosterAudit's -100% floor as losing what is left, not as infinity", () => {
    // Live data from 2026-09-16: ten players floored at -10000 with values
    // under 80. A division by zero here rendered "-∞" at the top of fallers.
    const values = byId(
      player("rudolph", { value: 70, trend7Day: -10000 }),
      player("kittle", { value: 330, trend7Day: -5245 }),
    );
    const { fallers } = moversFromValues(values, "rosteraudit", 30);
    expect(fallers.map((m) => m.sleeperId)).toEqual(["kittle", "rudolph"]);
    expect(fallers.map((m) => m.trend7Day)).toEqual([-364, -70]);
    expect(fallers.every((m) => Number.isFinite(m.trend7Day))).toBe(true);
  });

  it("falls back to the 30-day trend when the source has no 7-day trend", () => {
    const values = byId(
      player("a", { trend7Day: 0, trend30Day: 200 }),
      player("b", { trend7Day: 0, trend30Day: -80 }),
    );
    const { risers, fallers } = moversFromValues(values, "fantasycalc", 30);
    expect(risers.map((m) => m.sleeperId)).toEqual(["a"]);
    expect(fallers.map((m) => m.sleeperId)).toEqual(["b"]);
  });

  it("prefers the 7-day trend over the 30-day trend when both exist", () => {
    const values = byId(player("a", { trend7Day: -50, trend30Day: 400 }));
    const { risers, fallers } = moversFromValues(values, "rosteraudit", 30);
    expect(risers).toEqual([]);
    expect(fallers.map((m) => m.sleeperId)).toEqual(["a"]);
  });

  it("caps each list at the limit", () => {
    const values = byId(
      ...Array.from({ length: 12 }, (_, i) =>
        player(`r${i}`, { trend30Day: 100 + i }),
      ),
      ...Array.from({ length: 12 }, (_, i) =>
        player(`f${i}`, { trend30Day: -(100 + i) }),
      ),
    );
    const { risers, fallers } = moversFromValues(values, "fantasycalc", 5);
    expect(risers).toHaveLength(5);
    expect(fallers).toHaveLength(5);
    expect(risers[0].sleeperId).toBe("r11");
    expect(fallers[0].sleeperId).toBe("f11");
  });

  it("only tracks the positions the page shows", () => {
    const values = byId(
      player("k", { position: "K", trend30Day: 500 }),
      player("def", { position: "DEF", trend30Day: 500 }),
      player("qb", { position: "QB", trend30Day: 100 }),
    );
    const { risers } = moversFromValues(values, "fantasycalc", 30);
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
        value: 9985,
        trend7Day: 584,
        trend30Day: 556,
        buyLow: true,
        breakout: true,
      }),
    );
    const { risers } = moversFromValues(values, "rosteraudit", 30);
    expect(risers[0]).toEqual({
      sleeperId: "a",
      name: "Bijan Robinson",
      position: "RB",
      team: "ATL",
      age: 24.6,
      tier: 1,
      valueSf: 9985,
      trend7Day: 551,
      trend30Day: 526,
      buyLow: true,
      sellHigh: false,
      breakout: true,
    });
  });
});
