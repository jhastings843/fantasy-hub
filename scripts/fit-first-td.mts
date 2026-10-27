// Walk-forward fit and test of the NFL First TD model (src/lib/models/nfl/firsttd.ts).
//
// Every game of 2024, 2025 and 2026 weeks 1-6 with ESPN's first TD
// (scripts/nfl-ftd-history.mts) and nflverse's line: each team's list is its
// players from its last 3 games this season (last season's at week 1) who
// had a stat row in this game (standing in for who was active); each
// player's TD history pools last season and this season before the game.
// Fit on 2024 and 2025 weeks 1-9; tested on 2025 weeks 10-18 and 2026 weeks 1-6.
//
//   npx tsx --tsconfig scripts/tsconfig.json scripts/fit-first-td.mts
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { readGames, readStats, type NflRow } from "../src/lib/models/nfl/data";
import { addTotals, impliedPoints, scorerShares, tdTotals, teamFirst, type FtdParams, type TdLine } from "../src/lib/models/nfl/firsttd";
import { nameKey } from "../src/lib/props/grade";
import type { FirstTd } from "../src/lib/firsttd/grade";

const rows: { [s: number]: NflRow[] } = Object.fromEntries([2023, 2024, 2025, 2026].filter((s) => existsSync(`.cache/nfl/stats_player_week_${s}.csv`)).map((s) => [s, readStats(readFileSync(`.cache/nfl/stats_player_week_${s}.csv`, "utf8"))]));
const games = readGames(readFileSync(".cache/nfl/games.csv", "utf8"));

interface Case {
  season: number;
  week: number;
  game: string;
  home: string;
  away: string;
  pts: { home: number; away: number };
  lists: { [team: string]: TdLine[] };
  /** Each listed player's last-season and this-season totals, to rebuild lists at another wPrev. */
  parts: { [team: string]: { id: string; name: string; a?: Omit<TdLine, "team">; b?: Omit<TdLine, "team"> }[] };
  first: FirstTd;
  drives: number[];
}

const cases: Case[] = [];
for (const season of [2024, 2025, 2026]) {
  const cur = rows[season] ?? [];
  const prev = rows[season - 1] ?? [];
  const prevTot = tdTotals(prev);
  for (const g of games.filter((x) => x.season === season && x.espn && existsSync(`.cache/nfl/ftd/${x.espn}.json`))) {
    if (g.total === null || g.homeMargin === null) continue;
    const ftd = JSON.parse(readFileSync(`.cache/nfl/ftd/${g.espn}.json`, "utf8")) as { first: FirstTd; drives: { [t: string]: number } };
    const before = cur.filter((r) => r.week < g.week);
    const curTot = tdTotals(before);
    const played = new Set(cur.filter((r) => r.game === g.game).map((r) => r.id));
    const lists: Case["lists"] = {};
    const parts: Case["parts"] = {};
    for (const t of [g.home, g.away]) {
      const weeks = [...new Set(before.filter((r) => r.team === t).map((r) => r.week))].sort((a, b) => a - b).slice(-3);
      const pool = weeks.length ? before.filter((r) => r.team === t && weeks.includes(r.week)) : (() => {
        const pw = [...new Set(prev.filter((r) => r.team === t).map((r) => r.week))].sort((a, b) => a - b).slice(-3);
        return prev.filter((r) => r.team === t && pw.includes(r.week));
      })();
      const ids = [...new Set(pool.map((r) => r.id))].filter((id) => played.has(id));
      parts[t] = ids.map((id) => ({ id, name: (curTot.get(id) ?? prevTot.get(id))?.name ?? cur.find((r) => r.id === id)!.name, a: prevTot.get(id), b: curTot.get(id) }));
      lists[t] = ids.map((id) => {
        const a = prevTot.get(id);
        const b = curTot.get(id);
        const z = { rushTd: 0, recTd: 0, car: 0, tgt: 0, teamRushTd: 0, teamRecTd: 0, teamCar: 0, teamTgt: 0 };
        const sum = Object.fromEntries(Object.keys(z).map((k) => [k, ((a as never)?.[k] ?? 0) + ((b as never)?.[k] ?? 0)])) as typeof z;
        return { id, name: (b ?? a)?.name ?? cur.find((r) => r.id === id)!.name, team: t, ...sum };
      });
    }
    cases.push({ season, week: g.week, game: g.game, home: g.home, away: g.away, pts: impliedPoints(g.total, g.homeMargin), lists, parts, first: ftd.first, drives: Object.values(ftd.drives) });
  }
}
const train = cases.filter((c) => c.season === 2024 || (c.season === 2025 && c.week <= 9));
const testA = cases.filter((c) => c.season === 2025 && c.week >= 10);
const testB = cases.filter((c) => c.season === 2026);
console.log(`games: train ${train.length}, test 2025 wks 10-18 ${testA.length}, test 2026 ${testB.length}`);

const log: string[] = [];
const say = (s: string) => {
  console.log(s);
  log.push(s);
};

// Data constants from train: drives per team, rushing share of first offensive TDs' kind, scorers off the list.
const drives = train.flatMap((c) => c.drives).reduce((a, x, _i, xs) => a + x / xs.length, 0);
const off = train.filter((c) => c.first.kind === "offense");
const rushShare = off.filter((c) => c.first.kind === "offense" && c.first.how === "rush").length / off.length;
const scorerIdx = (c: Case) => (c.first.kind === "offense" ? (c.lists[c.first.team] ?? []).findIndex((l) => nameKey(l.name) === nameKey((c.first as { scorer: string }).scorer)) : -1);
const other = off.filter((c) => scorerIdx(c) < 0).length / off.length;
let P: FtdParams = { c: 0.1, delta: 0.003, drives: Math.round(drives * 100) / 100, kTd: 5, kR: 10, rushShare: Math.round(rushShare * 1000) / 1000, other: Math.round(other * 1000) / 1000 };
say(`data: ${P.drives} drives per team, ${(P.rushShare * 100).toFixed(1)}% of first offensive TDs rushing, ${(P.other * 100).toFixed(1)}% scored by a player off the list`);

const teamLoss = (cs: Case[], p: FtdParams) =>
  cs.reduce((a, c) => {
    const t = teamFirst(c.pts.home, c.pts.away, p);
    const y = c.first.kind === "none" ? t.none : c.first.team === c.home ? t.home : t.away;
    return a - Math.log(Math.max(y, 1e-6));
  }, 0) / cs.length;
{
  let b = { e: Infinity, c: 0, d: 0 };
  for (let c = 0.06; c <= 0.2001; c += 0.005)
    for (const d of [0, 0.002, 0.004, 0.006, 0.008, 0.01, 0.0125, 0.015, 0.0175, 0.02, 0.025, 0.03]) {
      const e = teamLoss(train, { ...P, c, delta: d });
      if (e < b.e) b = { e, c: Math.round(c * 1000) / 1000, d };
    }
  P = { ...P, c: b.c, delta: b.d };
  say(`teams: c ${P.c} offensive TDs per implied point, delta ${P.delta} per drive (train log loss ${b.e.toFixed(4)})`);
}
const scorerLoss = (cs: Case[], p: FtdParams) => {
  let l = 0, n = 0;
  for (const c of cs) {
    if (c.first.kind !== "offense") continue;
    const ls = c.lists[c.first.team] ?? [];
    const i = scorerIdx(c);
    const sh = scorerShares(ls, p);
    l -= Math.log(Math.max(i >= 0 ? sh[i] : p.other, 1e-6));
    n++;
  }
  return l / n;
};
{
  let b = { e: Infinity, kTd: 0, kR: 0 };
  for (const kTd of [0, 0.5, 1, 2, 3, 5, 8, 12, 20, 40, 100])
    for (const kR of [0, 2, 5, 10, 20, 50, 1000]) {
      const e = scorerLoss(train, { ...P, kTd, kR });
      if (e < b.e) b = { e, kTd, kR };
    }
  P = { ...P, kTd: b.kTd, kR: b.kR };
  say(`scorer: kTd ${P.kTd}, kR ${P.kR} (train log loss given the team ${b.e.toFixed(4)})`);
}

// Candidates (2026-10-26, after the live board ran flat: 12 of 13 first scorers priced shorter by the market than by us):
// sharpen the shares (sharp > 1), and count last season's TD history less (wPrev < 1). Fit on train, kept only if both tests improve.
const withPrev = (cs: Case[], w: number): Case[] =>
  w === 1 ? cs : cs.map((c) => ({ ...c, lists: Object.fromEntries(Object.entries(c.parts).map(([t, ps]) => [t, ps.map((x) => ({ ...addTotals(x.a, x.b, w)!, id: x.id, name: x.name, team: t }))])) }));
{
  const base = { train: scorerLoss(train, P), A: scorerLoss(testA, P), B: scorerLoss(testB, P) };
  let b = { e: base.train, sharp: 1, wPrev: 1, kTd: P.kTd };
  const trainBy = new Map<number, Case[]>();
  for (const w of [1, 0.75, 0.5, 0.25]) trainBy.set(w, withPrev(train, w));
  for (const [w, tr] of trainBy)
    for (const sharp of [1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.7])
      for (const kTd of [20, 40, 80]) {
        const e = scorerLoss(tr, { ...P, sharp, kTd });
        if (e < b.e) b = { e, sharp, wPrev: w, kTd };
      }
  const Q = { ...P, sharp: b.sharp, wPrev: b.wPrev, kTd: b.kTd };
  const A = scorerLoss(withPrev(testA, b.wPrev), Q);
  const B = scorerLoss(withPrev(testB, b.wPrev), Q);
  say(`candidates: sharp ${b.sharp}, wPrev ${b.wPrev}, kTd ${b.kTd}; scorer log loss train ${b.e.toFixed(4)} vs ${base.train.toFixed(4)}, test 2025 ${A.toFixed(4)} vs ${base.A.toFixed(4)}, test 2026 ${B.toFixed(4)} vs ${base.B.toFixed(4)}`);
  for (const [sharp, w] of [[1.2, 1], [1.4, 1], [1, 0.5], [1.3, 0.5]] as const)
    say(`  sharp ${sharp} wPrev ${w}: train ${scorerLoss(withPrev(train, w), { ...P, sharp }).toFixed(4)}, test 2025 ${scorerLoss(withPrev(testA, w), { ...P, sharp }).toFixed(4)}, test 2026 ${scorerLoss(withPrev(testB, w), { ...P, sharp }).toFixed(4)}`);
  // Paired check per game: the mean drop in scorer log loss and its standard error, both tests pooled.
  const per = (cs: Case[], p: FtdParams) => cs.filter((c) => c.first.kind === "offense").map((c) => scorerLoss([c], p));
  const d0 = [...per(testA, P), ...per(testB, P)];
  const d1 = [...per(withPrev(testA, b.wPrev), Q), ...per(withPrev(testB, b.wPrev), Q)];
  const diff = d1.map((x, i) => x - d0[i]);
  const mean = diff.reduce((a, x) => a + x, 0) / diff.length;
  const se = Math.sqrt(diff.reduce((a, x) => a + (x - mean) ** 2, 0) / (diff.length - 1) / diff.length);
  say(`  paired over ${diff.length} test games: ${mean.toFixed(4)} per game, SE ${se.toFixed(4)} (${(mean / se).toFixed(1)} SE)`);
  // Same bar as every input tested on 2026-10-26: both tests better AND the paired gain beyond 2 standard errors.
  if (A < base.A && B < base.B && mean < -2 * se) {
    P = Q;
    for (const cs of [train, testA, testB]) for (const [i, c] of withPrev(cs, b.wPrev).entries()) cs[i].lists = c.lists;
    say("  kept (both tests improved, beyond 2 SE)");
  } else say("  not kept (needs both tests better and a paired gain beyond 2 SE)");
}

function report(name: string, cs: Case[]) {
  const tl = teamLoss(cs, P);
  // Baseline: the league's rates, no market (each team even, "none" at its rate).
  const noneRate = train.filter((c) => c.first.kind === "none").length / train.length;
  const base = cs.reduce((a, c) => a - Math.log(c.first.kind === "none" ? noneRate : (1 - noneRate) / 2), 0) / cs.length;
  let full = 0, even = 0;
  const cal: { p: number; y: number }[] = [];
  for (const c of cs) {
    const t = teamFirst(c.pts.home, c.pts.away, P);
    const probs: { p: number; hit: boolean }[] = [];
    for (const team of [c.home, c.away]) {
      const tp = team === c.home ? t.home : t.away;
      const ls = c.lists[team] ?? [];
      scorerShares(ls, P).forEach((s, i) => probs.push({ p: tp * s, hit: c.first.kind === "offense" && c.first.team === team && scorerIdx(c) === i }));
    }
    for (const x of probs) cal.push({ p: x.p, y: x.hit ? 1 : 0 });
    const hit = probs.find((x) => x.hit);
    const pOut = c.first.kind === "none" ? t.none : hit ? hit.p : (c.first.team === c.home ? t.home : t.away) * P.other;
    full -= Math.log(Math.max(pOut, 1e-6));
    const n = probs.length || 1;
    even -= Math.log(c.first.kind === "none" ? noneRate : hit ? ((1 - noneRate) * (1 - P.other)) / n : ((1 - noneRate) / 2) * P.other);
  }
  say(`\n${name} (${cs.length} games)`);
  say(`team first: log loss ${tl.toFixed(4)} vs even teams ${base.toFixed(4)}`);
  say(`scorer: log loss ${(full / cs.length).toFixed(4)} vs every listed player even ${(even / cs.length).toFixed(4)}`);
  say("calibration per player (predicted vs happened, n)");
  for (const [lo, hi] of [[0, 0.02], [0.02, 0.04], [0.04, 0.07], [0.07, 0.1], [0.1, 0.15], [0.15, 1]]) {
    const b = cal.filter((x) => x.p >= lo && x.p < hi);
    if (b.length) say(`  ${lo.toFixed(2)}-${Math.min(hi, 1).toFixed(2)}: ${(b.reduce((a, x) => a + x.p, 0) / b.length).toFixed(3)} vs ${(b.reduce((a, x) => a + x.y, 0) / b.length).toFixed(3)}, n ${b.length}`);
  }
}
report("TEST 2025 weeks 10-18", testA);
report("TEST 2026 weeks 1-6", testB);
writeFileSync("src/lib/models/nfl/ftd-params.json", JSON.stringify(P, null, 2) + "\n");
writeFileSync(".cache/fit-first-td.txt", log.join("\n") + "\n");
