import { describe, expect, it } from "vitest";
import { appeared, boxPlayed, onRoster, rosterPlayed } from "./ftd-void";
import { bestBets } from "./ftd-price";
import type { FtdGame } from "@/lib/firsttd/parse";

describe("onRoster", () => {
  it("reads ESPN's game-roster short names", () => {
    expect(onRoster("Penix Jr.", "M.Penix Jr.")).toBe(true);
    expect(onRoster("D. London", "D.London")).toBe(true);
    expect(onRoster("L. London", "D.London")).toBe(false);
    expect(onRoster("Bi. Robinson", "B.Robinson")).toBe(true);
    expect(onRoster("A.J. Terrell Jr.", "A.Terrell")).toBe(true);
    expect(onRoster("St. Brown", "A.St. Brown")).toBe(true);
    expect(onRoster("Smith-Njigba", "J.Smith-Njigba")).toBe(true);
    expect(onRoster("Chase", "T.Higgins")).toBe(false);
  });

  it("reads box-score full names", () => {
    expect(onRoster("Michael Penix Jr.", "M.Penix Jr.")).toBe(true);
    expect(onRoster("Ja'Marr Chase", "J.Chase")).toBe(true);
    expect(onRoster("Tee Higgins", "J.Chase")).toBe(false);
  });
});

describe("appeared", () => {
  const played = { ATL: ["D. London", "Penix Jr."], SF: [] };
  it("true when on the list, false when not, null with no record for the team", () => {
    expect(appeared(played, "ATL", "M.Penix Jr.")).toBe(true);
    expect(appeared(played, "ATL", "D.Mooney")).toBe(false);
    expect(appeared(played, "SF", "C.McCaffrey")).toBeNull();
    expect(appeared(undefined, "ATL", "D.Mooney")).toBeNull();
  });

  it("builds the list from the game roster and the box score", () => {
    expect(rosterPlayed([{ displayName: "Penix Jr." }, { displayName: "Br. Robinson Jr.", didNotPlay: true }, {}])).toEqual(["Penix Jr."]);
    const box = { team: { abbreviation: "ATL" }, statistics: [{ athletes: [{ athlete: { displayName: "Drake London" } }, { athlete: { displayName: "Kyle Pitts" }, didNotPlay: true }] }, { athletes: [{ athlete: { displayName: "Drake London" } }] }] };
    expect(boxPlayed(box)).toEqual(["Drake London"]);
  });
});

describe("bestBets voids", () => {
  const pl = (name: string, p: number) => ({ key: `CIN_${name}`, name, team: "CIN", p, thin: false, out: false, touches: 0, tds: 0 });
  const game = { teams: [{ team: "CIN", pFirst: 0.5, players: [pl("J.Chase", 0.2), pl("T.Higgins", 0.15)], rest: 0, thin: 0 }] } as unknown as FtdGame;
  const result = { key: "CIN_J.Chase" } as never;
  const dk = { at: "x", prices: { jamarrchase: 650, teehiggins: 800 } };
  it("leaves out a player who did not play; no record grades as before", () => {
    const before = bestBets([{ game, result, dk }], (p, c) => p.p > c);
    expect(before.map((b) => b.net)).toEqual([6.5, -1]);
    const after = bestBets([{ game, result, dk, played: { CIN: ["Chase", "Burrow"] } }], (p, c) => p.p > c);
    expect(after.map((b) => b.player)).toEqual(["CIN_J.Chase"]);
  });
});
