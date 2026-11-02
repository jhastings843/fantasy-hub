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
