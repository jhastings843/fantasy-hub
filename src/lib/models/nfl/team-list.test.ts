import { describe, expect, it } from "vitest";
import { teamList } from "./team-list";
import type { NflRow } from "./data";

const nk = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
const row = (id: string, name: string, team: string, week: number, car = 10): NflRow => ({ id, name, team, week, car, tgt: 2, rushTd: 0, recTd: 0 }) as unknown as NflRow;
const tot = (id: string, name: string, car: number) => ({ id, name, rushTd: 2, recTd: 0, car, tgt: 5, teamRushTd: 10, teamRecTd: 10, teamCar: 300, teamTgt: 400 });

describe("teamList", () => {
  const rows = [
    row("price", "Jadarian Price", "SEA", 1), row("price", "Jadarian Price", "SEA", 2),
    row("wil", "Emanuel Wilson", "SEA", 3), row("wil", "Emanuel Wilson", "SEA", 4), row("wil", "Emanuel Wilson", "SEA", 5), row("wil", "Emanuel Wilson", "SEA", 6),
    row("hol", "George Holani", "SEA", 6),
    row("other", "Traded Guy", "KC", 6),
  ];
  const cur = new Map([["price", tot("price", "Jadarian Price", 30)], ["wil", tot("wil", "Emanuel Wilson", 60)], ["hol", tot("hol", "George Holani", 10)], ["other", tot("other", "Traded Guy", 20)]]);
  const prior = { charb: tot("charb", "Zach Charbonnet", 150), gone: tot("gone", "Retired Back", 100) };
  it("adds players back from injury and season debuts when ESPN has them active", () => {
    const r = teamList({ team: "SEA", rows, prior, cur, active: new Set(["jadarianprice", "zachcharbonnet", "emanuelwilson", "georgeholani"]), out: new Set(), nameKey: nk });
    expect(r.lines.map((l) => l.id).sort()).toEqual(["charb", "hol", "price", "wil"]);
    expect(r.returners.sort()).toEqual(["Jadarian Price", "Zach Charbonnet"]);
  });
  it("leaves out returners ESPN doesn't list active, and anyone Out", () => {
    const r = teamList({ team: "SEA", rows, prior, cur, active: new Set(["emanuelwilson"]), out: new Set(["georgeholani"]), nameKey: nk });
    expect(r.lines.map((l) => l.id)).toEqual(["wil"]);
    expect(r.returners).toEqual([]);
  });
});
