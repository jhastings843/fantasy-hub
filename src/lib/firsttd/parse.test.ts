import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fairAmerican, parseBoardLinks, parseFirstTdPage, pricedPlayers } from "./parse";

const fx = (f: string) => readFileSync(path.resolve(import.meta.dirname, "../../../test/fixtures/firsttd", f), "utf8");

describe("Sam's first TD pages", () => {
  it("finds every game's first TD link on the board", () => {
    const links = parseBoardLinks(fx("board-nfl.html"));
    expect(links).toHaveLength(14);
    expect(links).toContain("2026_06_SEA_DEN");
  });

  it("reads the pick, both teams, the remainders and the defense table", () => {
    const g = parseFirstTdPage("2026_06_SEA_DEN", fx("game-2026_06_SEA_DEN.html"))!;
    expect(g).toMatchObject({ season: 2026, week: 6, away: "SEA", home: "DEN", none: 0.063 });
    expect(g.when).toBe("Thursday, October 15 · 8:15 PM ET");
    expect(g.pick).toEqual({ name: "E.Wilson", team: "SEA", p: 0.157 });
    const den = g.teams.find((t) => t.team === "DEN")!;
    const sea = g.teams.find((t) => t.team === "SEA")!;
    expect(den.pFirst).toBe(0.415);
    expect(sea.pFirst).toBe(0.522);
    expect(sea.rest).toBe(0.009);
    // The three blocks add to 100%.
    expect(den.pFirst + sea.pFirst + g.none).toBeCloseTo(1, 2);
    const jsn = sea.players.find((p) => p.key === "SEA_J_Smith-Njigba")!;
    expect(jsn).toMatchObject({ name: "J.Smith-Njigba", touches: 51, tds: 7, p: 0.111, thin: false, out: false });
    expect(jsn.s1).toBeGreaterThan(0);
    expect(den.players.find((p) => p.name === "N.Adkins")).toMatchObject({ thin: true, p: null });
    expect(den.players.find((p) => p.name === "P.Bryant")).toMatchObject({ out: true, p: null });
    expect(g.defense[0]).toEqual({ label: "Touchdowns allowed per game", away: "2.00 25/32", home: "2.40 16/32", league: "2.52" });
    // Printed players, the remainder and the unprinted THIN share add to the side's chance.
    expect(den.thin).toBe(0.068);
    for (const t of g.teams) {
      const sum = t.players.reduce((a, p) => a + (p.p ?? 0), 0) + t.rest + t.thin;
      expect(sum).toBeCloseTo(t.pFirst, 3);
    }
    expect(pricedPlayers(g)[0].name).toBe("E.Wilson");
  });

  it("prices a chance as fair American odds", () => {
    expect(fairAmerican(0.157)).toBe("+537");
    expect(fairAmerican(0.5)).toBe("-100");
    expect(fairAmerican(0.6)).toBe("-150");
  });
});
