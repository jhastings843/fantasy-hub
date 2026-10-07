import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseCsv, parseSamRecord, parseSheetWeek, weekOf } from "./parse";
import { gradeGame, join, key, strategies } from "./engine";
import { type CardRow, cardKind, statedCount, toRows } from "./pem-card";

const fx = (f: string) => readFileSync(path.resolve(__dirname, "../../../test/fixtures/picks", f), "utf8");
const rec = (r: { w: number; l: number; p: number }) => `${r.w}-${r.l}-${r.p}`;

/** The Week 5 results card, typed in by hand, as the vision read would return it. */
function week5Card(): CardRow[] {
  return parseCsv(fx("pem-week5.csv"))
    .slice(1)
    .filter((r) => r[0])
    .map(([away, home, ap, hp, pickTeam, pickLine, pemTeam, pem]) => {
      const pl = pickLine === "" ? null : Number(pickLine);
      const other = pickTeam === home ? away : home;
      return {
        away,
        home,
        lineTeam: pl === null ? "" : pl < 0 ? pickTeam : other,
        line: pl === null ? undefined : Math.abs(pl),
        pemTeam,
        pem: Number(pem),
        awayPts: Number(ap),
        homePts: Number(hp),
      };
    });
}

describe("PEM card", () => {
  it("turns card rows into home-side lines", () => {
    const { rows, problems } = toRows(week5Card());
    expect(problems).toEqual([]);
    expect(rows).toHaveLength(56);
    const nd = rows.find((r) => r.home === "north carolina")!;
    expect(nd).toMatchObject({ away: "notre dame", model: 44.2, market: 21 });
  });

  it("flags an edge that doesn't match its lines", () => {
    const { problems } = toRows([{ away: "Southern Miss", home: "Troy", lineTeam: "TROY", line: 10.5, pemTeam: "TROY", pem: 17.6, edge: 9.1 }]);
    expect(problems).toHaveLength(1);
    expect(toRows([{ away: "Southern Miss", home: "Troy", lineTeam: "TROY", line: 10.5, pemTeam: "TROY", pem: 17.6, edge: 7.1 }]).problems).toEqual([]);
  });

  it("resolves the card's abbreviations to one of the two teams", () => {
    const row = (away: string, home: string, abbr: string) =>
      toRows([{ away, home, lineTeam: abbr, line: 3, pemTeam: abbr, pem: 4 }]);
    expect(row("Jacksonville State", "Kennesaw State", "JXST").rows[0].model).toBe(4);
    expect(row("Tulsa", "Navy", "TLSA").rows[0].model).toBe(4);
    expect(row("Missouri State", "Western Kentucky", "MOST").rows[0].model).toBe(4);
    expect(row("Charlotte", "North Texas", "UNT").rows[0].model).toBe(-4);
    expect(row("Maryland", "Ohio State", "OSU").rows[0].model).toBe(-4);
  });

  it("reads the post text", () => {
    expect(cardKind("Week 6 PEM picks. All 58 games, in kickoff order.")).toEqual({ week: 6, kind: "picks" });
    expect(cardKind("The full PEM Week 5 card, with every final result.")).toEqual({ week: 5, kind: "final" });
    expect(statedCount("Week 6 PEM picks. All 58 games, in kickoff order.")).toBe(58);
  });

  it("joins every Week 5 game and reproduces the card's own ATS record", () => {
    const sam = parseSamRecord("cfb", fx("sam-cfb-record.html"), (d) => weekOf("cfb", d)).filter((r) => r.week === 5);
    const david = parseSheetWeek("cfb", 5, fx("ds-cfb-week5.csv"));
    const pem = new Map(toRows(week5Card()).rows.map((r) => [key({ week: 5, ...r }), r]));
    const games = join(sam, david).graded.map((g) => {
      const p = pem.get(key(g));
      return p ? gradeGame({ ...g, pem: { model: p.model, market: p.market ?? p.model } }) : g;
    });
    expect(games.filter((g) => g.pem)).toHaveLength(56);
    const s = strategies("cfb", games);
    const pemAlone = s.baselines.find((b) => b.id === "pem")!.record;
    expect(rec(pemAlone)).toBe("30-24-1");
    const cut = (id: string) => rec(s.cuts.find((c) => c.id === id)!.record);
    expect([cut("pem-agree"), cut("pem-agree-dog"), cut("pem-agree-fav"), cut("pem-disagree"), cut("pem-split")]).toEqual([
      "13-7-0",
      "6-1-0",
      "7-6-0",
      "8-7-0",
      "11-9-1",
    ]);
  });
});
