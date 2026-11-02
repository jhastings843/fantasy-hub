import { describe, expect, it } from "vitest";
import { blend, CbbRatings, coverChance, overChance, phi, trankLeague, trankProject, type CbbParams, type TrankTeam } from "./model";
import { readTorvikSked, readTorvikTeams, matchTorvik, squeeze } from "./torvik";
import { readCbbLine, noVig, payout, priceOf } from "./lines";
import { graded, signalRecords, signalsOf, type CbbSnap, type TrackedCbbGame } from "./track";
import PARAMS from "./params.json";

const P = PARAMS as CbbParams;

describe("ratings", () => {
  it("moves offense and defense toward a final and settles the learning rate", () => {
    const r = new CbbRatings({ ...P.rating, hfa: 4, hfaTotal: 0, avg0: 70 });
    r.newSeason(2026);
    expect(r.project("A", "B", true)).toEqual({ margin: 0, total: 140 });
    r.add({ season: 2026, home: "A", away: "B", homeScore: 90, awayScore: 60, neutral: true });
    const p = r.project("A", "B", true);
    expect(p.margin).toBeGreaterThan(0);
    expect(r.k(0)).toBeCloseTo(P.rating.k0);
    expect(r.k(100)).toBeCloseTo(P.rating.kMin, 2);
  });

  it("gives the home side its edge only off a neutral floor", () => {
    const r = new CbbRatings({ ...P.rating, hfa: 4, avg0: 70 });
    expect(r.project("A", "B", false).margin).toBeCloseTo(4);
    expect(r.project("A", "B", true).margin).toBeCloseTo(0);
  });

  it("carries a share into a new season", () => {
    const r = new CbbRatings({ ...P.rating, carry: 0.5 });
    r.newSeason(2025);
    r.off.set("A", 10);
    r.newSeason(2026);
    expect(r.off.get("A")).toBe(5);
  });
});

describe("T-Rank projection", () => {
  const t = (name: string, o: number, d: number, tempo: number): TrankTeam => ({ name, conf: "X", record: "", rank: 1, barthag: 0.5, adjOE: o, adjDE: d, adjT: tempo });
  it("is the KenPom formula: average teams at average tempo score the average", () => {
    const lg = { eff: 105, tempo: 68 };
    const x = trankProject(t("a", 105, 105, 68), t("b", 105, 105, 68), lg, true, 4);
    expect(x.margin).toBeCloseTo(0);
    expect(x.total).toBeCloseTo(2 * 105 * 0.68);
    expect(trankProject(t("a", 105, 105, 68), t("b", 105, 105, 68), lg, false, 4).margin).toBeCloseTo(4);
  });
  it("league means come from the teams", () => {
    expect(trankLeague([t("a", 110, 100, 70), t("b", 100, 110, 66)])).toEqual({ eff: 105, tempo: 68 });
  });
});

describe("blend and chances", () => {
  it("weights ours and T-Rank, falls back to ours alone", () => {
    const b = blend({ margin: 10, total: 140 }, { margin: 6, total: 150 }, P);
    const wm = P.blend.margin;
    expect(b.margin).toBeCloseTo((wm.ours * 10 + wm.trank * 6) / (wm.ours + wm.trank), 1);
    expect(blend({ margin: 10, total: 140 }, null, P).margin).toBe(10);
    expect(b.homeWin).toBeGreaterThan(0.5);
  });
  it("cover and over chances are 50% at our own number", () => {
    expect(coverChance(5, -5, 11)).toBe(0.5);
    expect(overChance(150, 150, 17)).toBe(0.5);
    expect(coverChance(8, -5, 11)).toBeCloseTo(phi(3 / 11), 3);
  });
});

describe("Torvik files", () => {
  it("reads team rows by column", () => {
    const row = [1, "Duke", "ACC", "0-0", 120.7, 3, 91.2, 1, 0.96, ...Array(35).fill(0), 70.1];
    expect(readTorvikTeams([row])).toEqual([{ rank: 1, name: "Duke", conf: "ACC", record: "0-0", adjOE: 120.7, adjDE: 91.2, barthag: 0.96, adjT: 70.1 }]);
  });
  it("reads a schedule row: the second team named in 'A at B' is home", () => {
    const row: unknown[] = Array(55).fill(0);
    row[1] = "2/7/26";
    row[3] = "3 Duke at 27 North Carolina";
    row[8] = "Duke";
    row[14] = "North Carolina";
    row[25] = 63.75;
    row[27] = 68;
    row[28] = 71;
    row[54] = ["k", "2/7/26", "Duke -3.1", "76.4", "73.3"];
    expect(readTorvikSked([row])).toEqual([{ date: "2026-02-07", home: "North Carolina", away: "Duke", neutral: false, pred: { home: 73.3, away: 76.4 }, score: { home: 71, away: 68 }, poss: 63.75 }]);
  });
  it("matches Torvik names to ESPN locations", () => {
    expect(squeeze("Michigan St.")).toBe(squeeze("Michigan State"));
    expect(squeeze("San Jose St.")).toBe(squeeze("San José State"));
    const { map, unmatched } = matchTorvik(["Michigan St.", "Connecticut", "Saint Mary's", "Nowhere Tech"], { "127": "Michigan State", "41": "UConn", "2608": "Saint Mary's" });
    expect(Object.fromEntries(map)).toEqual({ "Michigan St.": "127", Connecticut: "41", "Saint Mary's": "2608" });
    expect(unmatched).toEqual(["Nowhere Tech"]);
  });
});

describe("lines", () => {
  it("reads DraftKings first with prices and the open", () => {
    const l = readCbbLine({
      items: [
        { provider: { name: "ESPN BET" }, spread: -1, overUnder: 140, homeTeamOdds: {}, awayTeamOdds: {} },
        {
          provider: { name: "DraftKings" },
          homeTeamOdds: { moneyLine: -170, spreadOdds: -110, open: { pointSpread: { american: "-4.5" } }, current: { pointSpread: { american: "-3.5" }, spread: { american: "-110" }, moneyLine: { american: "-170" } } },
          awayTeamOdds: { moneyLine: 145, current: { spread: { american: "-110" }, moneyLine: { american: "+145" } } },
          open: { total: { american: "130.5" } },
          current: { total: { american: "128.5" }, over: { american: "-105" }, under: { american: "-115" } },
        },
      ],
    });
    expect(l).toMatchObject({ provider: "DraftKings", spread: -3.5, total: 128.5, homePrice: -110, mlHome: -170, mlAway: 145, overPrice: -105, open: { spread: -4.5, total: 130.5 } });
  });
  it("reads the close for grading and the current number before tip (Astra: event 401820810)", () => {
    const d = { items: [{ provider: { name: "DraftKings" }, homeTeamOdds: { current: { pointSpread: { american: "+19.5" } }, close: { pointSpread: { american: "+22.5" } } } }] };
    expect(readCbbLine(d, "close")!.spread).toBe(22.5);
    expect(readCbbLine(d, "now")!.spread).toBe(19.5);
  });
  it("falls back field by field: a current block with only a moneyline keeps the close's spread", () => {
    const l = readCbbLine({ items: [{ provider: { name: "DraftKings" }, homeTeamOdds: { current: { moneyLine: { american: "-150" } }, close: { pointSpread: { american: "-3.5" } } } }] });
    expect(l).toMatchObject({ spread: -3.5, mlHome: -150 });
  });
  it("reads EVEN as +100, never as a zero price", () => {
    expect(priceOf("EVEN")).toBe(100);
    expect(priceOf("-110")).toBe(-110);
    expect(priceOf("PK")).toBeNull();
  });
  it("prices", () => {
    expect(payout(-110)).toBeCloseTo(0.909, 3);
    expect(payout(150)).toBe(1.5);
    const nv = noVig(-110, -110)!;
    expect(nv[0]).toBeCloseTo(0.5);
  });
});

describe("tracking", () => {
  const snap = (o: Partial<CbbSnap> = {}): CbbSnap => ({
    at: "2026-11-10T12:00:00Z",
    spread: -5,
    total: 140,
    open: { spread: -4, total: 141 },
    ours: { spread: -8, total: 145, homeWin: 0.75 },
    parts: { ours: { margin: 7, total: 144 }, trank: { margin: 8.5, total: 146 } },
    mlHome: -220,
    mlAway: 180,
    ...o,
  });
  it("fires lean, strong, agree, totals and winner on the right sides", () => {
    const x = signalsOf(snap(), { strong: 2.5, strongTotal: 4 });
    expect(x).toEqual([
      { id: "lean", side: "home" },
      { id: "strong", side: "home" },
      { id: "agree", side: "home" },
      { id: "total", side: "over" },
      { id: "strongT", side: "over" },
      { id: "winner", side: "home" },
    ]);
    expect(signalsOf(snap({ ours: { spread: -10.5, total: 140, homeWin: 0.8 } }), { strong: 2.5, strongTotal: 4 }).map((s) => s.id)).toContain("big");
  });
  it("grades at the first number and prices", () => {
    const s = snap();
    expect(graded("lean", "home", s, { home: 80, away: 70 })).toEqual({ r: 1, u: payout(-110) });
    expect(graded("lean", "home", s, { home: 75, away: 70 })).toEqual({ r: 0, u: 0 });
    expect(graded("total", "over", s, { home: 70, away: 60 })).toEqual({ r: -1, u: -1 });
    expect(graded("winner", "away", s, { home: 60, away: 70 })).toEqual({ r: 1, u: 1.8 });
    // No moneyline saved: no bet, so it counts toward neither record nor gate.
    expect(graded("winner", "home", snap({ mlHome: undefined }), { home: 60, away: 70 })).toBeNull();
  });
  it("records CLV and says collecting below the gate", () => {
    const g: TrackedCbbGame = { event: "1", home: "A", away: "B", homeName: "A", awayName: "B", tip: "2026-11-10T23:00:00Z", neutral: false, first: snap(), last: snap(), close: { spread: -6.5, total: 142 }, final: { home: 80, away: 70 } };
    const lean = signalRecords([g], { strong: 2.5, strongTotal: 4 }).find((r) => r.id === "lean")!;
    expect(lean).toMatchObject({ games: 1, w: 1, l: 0, clv: 1.5, verdict: "collecting" });
  });
});
