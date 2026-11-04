import { describe, expect, it } from "vitest";
import { buildRecord, favoriteOf, gradePick, latestPerPick, pickId, problemsOf, splits, type PickInput } from "./log";

const NOW = "2026-11-07T15:00:00.000Z";

const input = (over: Partial<PickInput> = {}): PickInput => ({
  date: "2026-11-07",
  league: "cfb",
  season: 2026,
  week: 11,
  market: "ats",
  home: { name: "Georgia", rank: 3 },
  away: { name: "Ole Miss", rank: 12 },
  line: { home: -6.5, source: "pool" },
  pick: { team: "Ole Miss", side: "away" },
  reason: "agree",
  ...over,
});

describe("buildRecord", () => {
  it("fills defaults, id and favorite", () => {
    const r = buildRecord(input({ pool: "Office Pool" }), "run1", NOW);
    expect(r.id).toBe("cfb-2026-w11-office-pool-ats-ole-miss@georgia");
    expect(r.favorite).toBe("home");
    expect(r.models).toEqual({ sam: null, david: null, pem: null, ours: null });
    expect(r.result).toBeNull();
    expect(r.seasontype).toBe(2);
  });

  it("uses one id for alias spellings of a team", () => {
    const a = pickId({ ...buildRecord(input(), "r", NOW), away: { name: "Miami (FL)", rank: null } });
    const b = pickId({ ...buildRecord(input(), "r", NOW), away: { name: "Miami", rank: null } });
    expect(a).toBe(b);
  });
});

describe("problemsOf", () => {
  it("passes a full pick", () => expect(problemsOf(input())).toEqual([]));
  it("flags an ATS pick with no line", () => expect(problemsOf(input({ line: null }))).toContain("ATS pick needs line"));
  it("flags a pick whose team is not on the side named", () =>
    expect(problemsOf(input({ pick: { team: "Georgia", side: "away" } }))[0]).toMatch(/not the away team/));
  it("allows an SU pick with no line", () => expect(problemsOf(input({ market: "su", line: null }))).toEqual([]));
});

describe("favoriteOf", () => {
  it("reads the home-side sign", () => {
    expect(favoriteOf(-3)).toBe("home");
    expect(favoriteOf(2.5)).toBe("away");
    expect(favoriteOf(0)).toBeNull();
  });
});

describe("gradePick", () => {
  const r = buildRecord(input(), "r", NOW);
  it("covers as a dog that loses by less than the line", () => {
    const g = gradePick(r, { final: { home: 27, away: 24 }, close: { open: -6.5, spread: -7.5, total_open: 52, total: 50.5 } }, NOW, "ESPN");
    expect(g.su).toBe("L");
    expect(g.ats).toBe("W");
    expect(g.graded).toBe("W");
    // Away at +6.5 when it closed +7.5: a point worse than the close.
    expect(g.clv_points).toBe(-1);
  });
  it("pushes on the number", () => {
    const rr = buildRecord(input({ line: { home: -3, source: "pool" } }), "r", NOW);
    expect(gradePick(rr, { final: { home: 20, away: 17 } }, NOW, "ESPN").ats).toBe("P");
  });
  it("grades an SU pick on the winner", () => {
    const su = buildRecord(input({ market: "su", line: null, pick: { team: "Georgia", side: "home" } }), "r", NOW);
    const g = gradePick(su, { final: { home: 27, away: 24 } }, NOW, "ESPN");
    expect(g.graded).toBe("W");
    expect(g.ats).toBeNull();
  });
});

describe("latestPerPick and splits", () => {
  it("keeps the last-logged pick per game and counts the splits", () => {
    const first = buildRecord(input({ pick: { team: "Georgia", side: "home" } }), "r1", "2026-11-05T00:00:00Z");
    const second = buildRecord(input(), "r2", "2026-11-06T00:00:00Z");
    const other = buildRecord(
      input({ home: { name: "Iowa", rank: null }, away: { name: "Purdue", rank: null }, line: { home: -10, source: "pool" }, pick: { team: "Iowa", side: "home" }, tier: "t1" }),
      "r2",
      "2026-11-06T00:00:00Z",
    );
    const fin = { final: { home: 27, away: 24 } };
    const all = [first, second, other].map((r) => ({ ...r, result: gradePick(r, fin, NOW, "ESPN") }));
    expect(latestPerPick(all).map((r) => r.run_id)).toEqual(["r2", "r2"]);
    const rows = splits(all);
    const get = (s: string, g: string) => rows.find((x) => x.split === s && x.group === g);
    expect(get("all", "all")).toMatchObject({ w: 1, l: 1, pct: 0.5 });
    expect(get("ranked", "both ranked")).toMatchObject({ w: 1, l: 0 });
    expect(get("ranked", "unranked")).toMatchObject({ w: 0, l: 1 });
    expect(get("fav_dog", "underdog")).toMatchObject({ w: 1 });
    expect(get("home_away", "home")).toMatchObject({ l: 1 });
    expect(get("tier", "t1")).toMatchObject({ l: 1 });
  });

  it("falls back to ESPN's rank when the skill logged none", () => {
    const r = buildRecord(input({ home: { name: "Iowa", rank: null }, away: { name: "Purdue", rank: null }, line: { home: -3, source: "pool" }, pick: { team: "Purdue", side: "away" } }), "r", NOW);
    const g = { ...r, result: gradePick(r, { final: { home: 10, away: 20 }, ranks: { home: 22, away: null } }, NOW, "ESPN") };
    expect(splits([g]).find((x) => x.split === "ranked")?.group).toBe("one ranked");
  });

  it("skips ungraded picks", () => expect(splits([buildRecord(input(), "r", NOW)])).toEqual([]));
});
