import { describe, expect, it } from "vitest";
import { entryStatus, endedSentence } from "./status";
import { DEFAULT_POOL, type Game } from "./types";

const game = (week: number, home: string, away: string, hs: number | null, as: number | null, completed = true): Game => ({
  week, home, away, kickoff: "2026-09-27T17:00Z", homeSpread: null, homeMoneyline: null,
  awayMoneyline: null, overUnder: null, homeWinProb: 0.5, probSource: "moneyline",
  completed, homeScore: hs, awayScore: as,
});

const games = [
  game(1, "JAX", "CAR", 27, 10),
  game(2, "SF", "NO", 20, 17),
  game(3, "WAS", "SEA", 33, 31),
  game(3, "MIA", "KC", 10, 24),
];

describe("entryStatus", () => {
  it("is alive while every settled pick has won", () => {
    const s = entryStatus({ ...DEFAULT_POOL, myPicks: { "1": "JAX", "2": "SF" } }, games);
    expect(s.alive).toBe(true);
    expect(s.record.map((r) => r.result)).toEqual(["W", "W"]);
  });

  it("goes out the moment the losing game is final", () => {
    const s = entryStatus({ ...DEFAULT_POOL, myPicks: { "1": "JAX", "2": "SF", "3": "SEA" } }, games);
    expect(s.alive).toBe(false);
    expect(s.endedBy?.week).toBe(3);
    expect(endedSentence(s.endedBy!)).toBe("SEA lost 31-33 at WAS in week 3");
  });

  it("does not settle a game that is still being played", () => {
    const live = [game(3, "WAS", "SEA", 14, 7, false)];
    expect(entryStatus({ ...DEFAULT_POOL, myPicks: { "3": "SEA" } }, live).alive).toBe(true);
  });

  it("survives a loss in a two-strike pool", () => {
    const s = entryStatus({ ...DEFAULT_POOL, strikes: 2, myPicks: { "3": "SEA" } }, games);
    expect(s.alive).toBe(true);
    expect(s.losses).toBe(1);
  });

  it("treats a tie as a loss unless ties advance", () => {
    const tie = [game(4, "DAL", "NYG", 20, 20)];
    expect(entryStatus({ ...DEFAULT_POOL, myPicks: { "4": "DAL" } }, tie).alive).toBe(false);
    expect(entryStatus({ ...DEFAULT_POOL, tieAdvances: true, myPicks: { "4": "DAL" } }, tie).alive).toBe(true);
  });

  it("keeps advising a rebuy pool", () => {
    expect(entryStatus({ ...DEFAULT_POOL, canRebuy: true, myPicks: { "3": "SEA" } }, games).alive).toBe(true);
  });
});
