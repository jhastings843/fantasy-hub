import { describe, expect, it } from "vitest";
import { searchEntries, type SearchEntry } from "./WeekSearch";
import { playerKey } from "../props/search";

const e = (title: string, terms: string, rank = 1): SearchEntry => ({ key: title, title, meta: "", terms, rank, rows: [] });

describe("searchEntries", () => {
  const list = [
    e("BUF at NYJ", "buf buffalo bills nyj new york jets", 1),
    e("KC at LV", "kc kansas city chiefs lv las vegas raiders", 0),
    e("Travis Kelce", "kc kansas city chiefs lv kc at lv", 2),
    e("Ja'Marr Chase", "cin cincinnati bengals", 1),
  ];
  it("matches every word, by name, abbreviation or team", () => {
    expect(searchEntries(list, "bills").map((x) => x.title)).toEqual(["BUF at NYJ"]);
    expect(searchEntries(list, "Jets").map((x) => x.title)).toEqual(["BUF at NYJ"]);
    expect(searchEntries(list, "kansas city").map((x) => x.title)).toEqual(["KC at LV", "Travis Kelce"]);
    expect(searchEntries(list, "")).toEqual([]);
  });
  it("puts a name match first, and ignores case, accents and apostrophes", () => {
    expect(searchEntries(list, "kelce")[0].title).toBe("Travis Kelce");
    expect(searchEntries(list, "chiefs kelce").map((x) => x.title)).toEqual(["Travis Kelce"]);
    expect(searchEntries(list, "jamarr").map((x) => x.title)).toEqual(["Ja'Marr Chase"]);
  });
});

describe("playerKey", () => {
  it("joins the first TD page's short names to full names", () => {
    expect(playerKey("SEA", "J.Smith-Njigba")).toBe(playerKey("SEA", "Jaxon Smith-Njigba"));
    expect(playerKey("DEN", "Troy Franklin")).toBe("DEN|t|franklin");
    expect(playerKey("KC", "Kenneth Walker III")).toBe(playerKey("KC", "K.Walker"));
    expect(playerKey("KC", "T.Kelce")).not.toBe(playerKey("LV", "T.Kelce"));
  });
});
