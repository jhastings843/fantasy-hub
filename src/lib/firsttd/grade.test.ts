import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseFirstTdPage } from "./parse";
import { firstTouchdown, grade, sameName, type EspnScoringPlay } from "./grade";

const fx = (f: string) => readFileSync(path.resolve(import.meta.dirname, "../../../test/fixtures/firsttd", f), "utf8");
const game = () => parseFirstTdPage("2026_06_SEA_DEN", fx("game-2026_06_SEA_DEN.html"))!;
const td = (type: string, text: string, team: string): EspnScoringPlay => ({
  type: { text: type }, text, team: { abbreviation: team }, scoringType: { name: "touchdown" }, period: { number: 1 }, clock: { displayValue: "9:12" },
});

describe("first touchdown from ESPN", () => {
  it("reads the scorer from a real game, skipping field goals", () => {
    const plays = (JSON.parse(fx("espn-summary-jax-phi.json")) as { scoringPlays: EspnScoringPlay[] }).scoringPlays;
    expect(firstTouchdown(plays)).toMatchObject({ kind: "offense", team: "JAX", scorer: "Parker Washington", how: "pass" });
    const fgFirst = [{ ...plays[3] }, ...plays];
    expect(firstTouchdown(fgFirst)).toMatchObject({ scorer: "Parker Washington" });
  });

  it("files return and defensive scores under none, as Sam's page does", () => {
    expect(firstTouchdown([td("Interception Return Touchdown", "Devon Witherspoon 40 Yd Interception Return", "SEA")])).toMatchObject({ kind: "none" });
    expect(firstTouchdown([])).toMatchObject({ kind: "none", detail: "No touchdown scored" });
  });

  it("maps ESPN's team codes to Sam's", () => {
    expect(firstTouchdown([td("Rushing Touchdown", "Kyren Williams 3 Yd Rush", "LAR")])).toMatchObject({ team: "LA" });
  });

  it("matches names across the two sites", () => {
    expect(sameName("J.Smith-Njigba", "Jaxon Smith-Njigba")).toBe(true);
    expect(sameName("A.St. Brown", "Amon-Ra St. Brown")).toBe(true);
    expect(sameName("M.Harrison", "Marvin Harrison Jr.")).toBe(true);
    expect(sameName("J.Williams", "Kyren Williams")).toBe(false);
  });
});

describe("grading a saved page", () => {
  it("credits the pick and the favored side", () => {
    const r = grade(game(), { kind: "offense", team: "SEA", scorer: "Emanuel Wilson", how: "rush", period: 1, clock: "3:00" });
    expect(r).toMatchObject({ pickHit: true, teamHit: true, rank: 1, bucket: "priced", p: 0.157, pOutcome: 0.157 });
  });

  it("ranks a non-pick scorer and misses the side", () => {
    const r = grade(game(), { kind: "offense", team: "DEN", scorer: "Courtland Sutton", how: "pass", period: 2, clock: "1:00" });
    expect(r).toMatchObject({ pickHit: false, teamHit: false, bucket: "priced", p: 0.061 });
    expect(r.rank).toBeGreaterThan(2);
  });

  it("charges a THIN or unlisted scorer to his team's remainder", () => {
    expect(grade(game(), { kind: "offense", team: "DEN", scorer: "Nate Adkins", how: "pass", period: 1, clock: "1:00" })).toMatchObject({ bucket: "thin", rank: null });
    expect(grade(game(), { kind: "offense", team: "SEA", scorer: "Some Body", how: "rush", period: 1, clock: "1:00" })).toMatchObject({ bucket: "unlisted", pOutcome: 0.009 });
  });

  it("grades none against the page's none", () => {
    expect(grade(game(), { kind: "none", detail: "No touchdown scored" })).toMatchObject({ bucket: "none", teamHit: null, pOutcome: 0.063 });
  });
});
