import { describe, expect, it } from "vitest";
import { kotezGame } from "./kotez";
import type { AttdRow } from "./anytime";

const row = (id: string, team: string, m: number, dk?: number): AttdRow => ({ id, key: id, name: id, team, m, anytime: 1 - Math.exp(-m), two: 0, dk });

describe("King of the End Zone", () => {
  it("chances add up with no-TD games, and more expected TDs means a better shot", () => {
    const g = kotezGame([row("a", "SEA", 0.7, -120), row("b", "SEA", 0.3, 250), row("c", "CHI", 0.5, 100)], 0.1, 5000);
    const sum = g.rows.reduce((x, r) => x + r.longest, 0) + g.noTd;
    expect(sum).toBeLessThan(1.001);
    expect(sum).toBeGreaterThan(0.8); // the rest goes to other TDs
    expect(g.rows[0].key).toBe("a");
    expect(g.rows.find((r) => r.key === "a")!.longest).toBeGreaterThan(g.rows.find((r) => r.key === "b")!.longest);
  });
  it("is the same every run (seeded) and values the less-backed player", () => {
    const rows = [row("a", "SEA", 0.7, -200), row("b", "CHI", 0.4, 250)];
    expect(kotezGame(rows, 0.1, 3000)).toEqual(kotezGame(rows, 0.1, 3000));
    const g = kotezGame(rows, 0.1, 3000);
    const a = g.rows.find((r) => r.key === "a")!;
    const b = g.rows.find((r) => r.key === "b")!;
    expect(b.value!).toBeGreaterThan(a.value!);
  });
});

import { longestTd } from "./kotez";
describe("longestTd", () => {
  it("credits the receiver, flags returns, splits ties, null with no TD", () => {
    const td = (text: string, type: string, team = "SEA") => ({ text, type: { text: type }, scoringType: { name: "touchdown" }, team: { abbreviation: team } });
    expect(longestTd([td("Will Shipley 2 Yd Rush", "Rushing Touchdown"), td("Parker Washington 51 Yd pass from Trevor Lawrence (Cam Little Kick)", "Passing Touchdown", "JAX")])).toEqual({ yards: 51, winners: [{ name: "Parker Washington", team: "JAX", dst: false }] });
    expect(longestTd([td("Devon Witherspoon 60 Yd Interception Return", "Interception Return Touchdown")])!.winners[0].dst).toBe(true);
    expect(longestTd([td("A B 20 Yd Rush", "Rushing Touchdown"), td("C D 20 Yd pass from E F", "Passing Touchdown")])!.winners).toHaveLength(2);
    expect(longestTd([{ text: "X 40 Yd Field Goal", scoringType: { name: "field-goal" } }])).toBeNull();
  });
});

import { pickPromo } from "./kotez";
describe("pickPromo", () => {
  const g = (slug: string, away: string, home: string, kickoff: string) => ({ slug, away, home, kickoff, espnId: slug, rows: [] });
  const games = [g("thu", "BUF", "DET", "2026-11-06T01:15:00Z"), g("sun", "KC", "LA", "2026-11-09T01:20:00Z"), g("mon", "CHI", "SEA", "2026-11-03T01:15:00Z")];
  it("takes the game DK Network names, else the only Monday game", () => {
    expect(pickPromo(games, ["bills vs. lions thursday night football game"])).toMatchObject({ g: { slug: "thu" }, source: "dknetwork" });
    expect(pickPromo(games, ["chiefs vs. rams sunday"])!.g.slug).toBe("sun");
    expect(pickPromo(games, [])).toMatchObject({ g: { slug: "mon" }, source: "monday" });
    expect(pickPromo(games.slice(0, 2), [])).toBeNull();
  });
});
