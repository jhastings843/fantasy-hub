import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { matchSamRows, mergeSam, parseSamCbb, samPreOf } from "./sam";
import { CBB_SLICES, betOf, type Read } from "./learn";

const html = readFileSync("test/fixtures/picks/sam-cbb-board.html", "utf8");

describe("parseSamCbb (Nov 25 page)", () => {
  const p = parseSamCbb(html);
  it("reads every card", () => {
    expect(p.rows).toHaveLength(41);
    expect(p.unread).toBe(0);
    expect(p.updated).toMatch(/UPDATED WEDNESDAY/);
  });
  it("orients lines to his home (second) team", () => {
    const r = p.rows.find((x) => x.home === "Ohio Bobcats")!;
    expect(r).toMatchObject({ away: "Rice Owls", spread: -3.5, model: -0.4, pick: "away", edge: 3.1, neutral: true, total: 148.4, samEvent: "401928845" });
    const v = p.rows.find((x) => x.home === "Charlotte 49ers")!;
    expect(v.model).toBe(-8.5);
  });
  it("turns a road favorite into a positive home line", () => {
    const r = p.rows.find((x) => x.away === "Virginia Cavaliers")!;
    expect(r.model).toBe(3.9);
    expect(r.spread).toBe(5.5);
    expect(r.pick).toBe("home");
  });
  it("throws when cards exist but none read", () => {
    expect(() => parseSamCbb('<article class="game"><div>nothing</div></article>')).toThrow(/layout changed/);
  });
  it("reads an empty page as no rows", () => {
    expect(parseSamCbb("<main>coming soon</main>").rows).toEqual([]);
  });
});

describe("mergeSam / samPreOf", () => {
  const row = { away: "A", home: "B", neutral: false, spread: -3, model: -5, conf: null, edge: 2, pick: "home" as const, trigger: false, total: 140, event: "9", homeId: "h", tip: "2026-11-25T20:00:00Z" };
  it("saves pre only before tip and keeps it after", () => {
    const a = mergeSam(undefined, [row], "2026-11-25T18:00:00Z");
    expect(a[0].pre).toMatchObject({ model: -5, total: 140 });
    const b = mergeSam(a, [{ ...row, model: -9 }], "2026-11-25T21:00:00Z");
    expect(b[0].pre!.model).toBe(-5);
    expect(samPreOf(b)["9"]).toMatchObject({ homeId: "h", model: -5, total: 140, postedTotal: null });
  });
});

describe("Sam slices", () => {
  const ids = CBB_SLICES.map((x) => x[0]).filter((x) => x.startsWith("cbb:sam"));
  it("registers ten", () => expect(ids).toHaveLength(10));
  it("bets his side and his total", () => {
    const r = { sam: { side: "away", edge: 4, total: { side: "under", edge: 6 } } } as unknown as Read;
    expect(betOf("sam", r)).toEqual({ market: "ats", side: "away" });
    expect(betOf("sam-total", r)).toEqual({ market: "ou", side: "under" });
  });
});

describe("matchSamRows", () => {
  const base = { neutral: true, spread: -3, model: -1, conf: null, edge: 2, pick: "away" as const, trigger: false, total: 140 };
  const games = [
    { id: "1", tip: "2026-11-25T16:00:00Z", home: { id: "h1", name: "Ohio" }, away: { id: "a1", name: "Rice" } },
    { id: "2", tip: "2026-11-25T17:00:00Z", home: { id: "h2", name: "Ohio" }, away: { id: "a2", name: "Ohio State" } },
  ];
  it("matches by his ESPN link and keeps his home", () => {
    const m = matchSamRows([{ ...base, away: "Rice Owls", home: "Ohio Bobcats", samEvent: "1" }], games);
    expect(m.problems).toEqual([]);
    expect(m.rows[0]).toMatchObject({ event: "1", homeId: "h1", awayId: "a1" });
  });
  it("flips when ESPN calls his road team home", () => {
    const m = matchSamRows([{ ...base, away: "Ohio Bobcats", home: "Rice Owls", samEvent: "1" }], games);
    expect(m.rows[0]).toMatchObject({ homeId: "a1", awayId: "h1" });
  });
  it("tells Ohio from Ohio State", () => {
    expect(matchSamRows([{ ...base, away: "Ohio Bobcats", home: "Ohio State Buckeyes", samEvent: "2" }], games).rows[0].homeId).toBe("a2");
    expect(matchSamRows([{ ...base, away: "Ohio State Buckeyes", home: "Ohio Bobcats", samEvent: "2" }], games).rows[0].homeId).toBe("h2");
  });
  it("reports a card off the board or with wrong names", () => {
    const m = matchSamRows([{ ...base, away: "X", home: "Y", samEvent: "9" }, { ...base, away: "Duke Blue Devils", home: "UNC Tar Heels", samEvent: "1" }], games);
    expect(m.problems).toHaveLength(2);
    expect(m.rows.every((r) => !r.event)).toBe(true);
  });
});
