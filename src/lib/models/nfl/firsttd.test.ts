import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { readStats } from "./data";
import { addTotals, ftdGame, impliedPoints, scorerShares, shortName, tdTotals, teamFirst, type FtdParams } from "./firsttd";
import { grade, sameName } from "@/lib/firsttd/grade";
import FTD from "./ftd-params.json";

const P = FTD as FtdParams;
const rows = readStats(readFileSync("test/fixtures/models/nflverse-week-2026-ne-chi.csv", "utf8"));

describe("teamFirst", () => {
  it("adds to 1 and favors the bigger implied total", () => {
    const t = teamFirst(27, 20, P);
    expect(t.home + t.away + t.none).toBeCloseTo(1, 9);
    expect(t.home).toBeGreaterThan(t.away);
  });
  it("is even for an even game", () => {
    const t = teamFirst(22, 22, P);
    expect(t.home).toBeCloseTo(t.away, 9);
  });
  it("reads implied points from the total and margin", () => {
    expect(impliedPoints(50.5, 3)).toEqual({ home: 26.75, away: 23.75 });
  });
});

describe("scorer shares (NE and CHI, 2026 weeks 1-6)", () => {
  const tot = tdTotals(rows);
  const ne = [...tot.values()].filter((x) => rows.find((r) => r.id === x.id)!.team === "NE").map((x) => ({ ...x, team: "NE" }));
  it("adds to 1 less the off-list share", () => {
    expect(scorerShares(ne, P).reduce((a, x) => a + x, 0)).toBeCloseTo(1 - P.other, 9);
  });
  it("pools two seasons' totals", () => {
    const a = tot.get(ne[0].id)!;
    expect(addTotals(a, a)!.car).toBe(2 * a.car);
    expect(addTotals(undefined, undefined)).toBeNull();
  });
  it("builds an FtdGame the tracker grades", () => {
    const chi = [...tot.values()].filter((x) => rows.find((r) => r.id === x.id)!.team === "CHI").map((x) => ({ ...x, team: "CHI" }));
    const g = ftdGame({ season: 2026, week: 7, slug: "2026_07_NE_CHI", away: "NE", home: "CHI", when: "" }, 26.75, 23.75, { NE: ne, CHI: chi }, P);
    const sum = g.teams.reduce((a, t) => a + t.players.reduce((q, p) => q + (p.p ?? 0), 0) + t.rest, 0) + g.none;
    expect(sum).toBeCloseTo(1, 2);
    const maye = g.teams.find((t) => t.team === "NE")!.players.find((p) => p.name === "D.Maye")!;
    expect(sameName(maye.name, "Drake Maye")).toBe(true);
    const r = grade(g, { kind: "offense", team: "NE", scorer: "Drake Maye", how: "rush", period: 1, clock: "10:00" });
    expect(r.bucket).toBe("priced");
    expect(r.pOutcome).toBe(maye.p);
  });
  it("writes names the tracker's way", () => {
    expect(shortName("Jaxon Smith-Njigba")).toBe("J.Smith-Njigba");
    expect(shortName("Luther Burden III")).toBe("L.Burden III");
  });
});
