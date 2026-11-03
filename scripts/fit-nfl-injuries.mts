// Does "who's out" help our NFL spread and totals models? (Jack, 2026-11-02.)
// Builds qbOut and skillOut per team per game (src/lib/models/nfl/injuries.ts)
// from nflverse injury reports and weekly stats, 2009 on, then judges them the
// way each model's own fit script judges itself:
//
// Spread (as scripts/fit-nfl-spread.mts): ridge on the residual (margin minus
// the closing line), walk forward by season, lambda picked on 2010-2014, test
// 2015 on. Features as home minus away. Compared with the shipped five
// features on the same test games: margin MSE vs the line, ATS records, and a
// paired standard error on the per-game squared error.
//
// Totals (as scripts/fit-nfl-totals.mts): our points-rating total, then a
// ridge of the miss (points minus ours) on qbOut and skillOut summed over
// both teams, fit 2009-2023, test 2024 on (and, for more games, a season walk
// 2015 on). Compared with an intercept-only correction so the injury terms
// get no credit for fixing the average.
//
// Guard: in games where either team is newly missing its starting QB or a
// skillOut share at or above a cut, did the model's spread and total sides do
// worse? Records split by flag, at several cuts.
//
//   npx tsx --tsconfig scripts/tsconfig.json scripts/nfl-injury-history.mts   (downloads)
//   npx tsx --tsconfig scripts/tsconfig.json scripts/fit-nfl-injuries.mts
// Writes .cache/fit-nfl-injuries.txt. Changes no params.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import SPREAD from "../src/lib/models/nfl/spread-params.json";
import TOTALS from "../src/lib/models/nfl/totals-params.json";
import { parseCsv, readStats } from "../src/lib/models/nfl/data";
import { PointsRatings } from "../src/lib/models/cfb/model";
import { FEATURES, fitRidge, rateAll, toSpreadGame, type Rated, type SpreadGame, type SpreadParams } from "../src/lib/models/nfl/spread";
import { nflResult, type NflTotalsParams } from "../src/lib/models/nfl/totals";
import { UsageBook, bigOut, normTeam, outIds, teamOut, type ReportEntry, type TeamOut } from "../src/lib/models/nfl/injuries";
import { paired } from "./refit/common.mjs";

const DIR = ".cache/nfl";
const FIRST = 2009;
const log: string[] = [];
const say = (s: string) => {
  console.log(s);
  log.push(s);
};
const records = (text: string) => {
  const [head, ...rows] = parseCsv(text);
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])) as Record<string, string>);
};

type G = SpreadGame & { total: number | null };
const games: G[] = records(readFileSync(`${DIR}/games.csv`, "utf8"))
  .map((o) => {
    const g = toSpreadGame(o);
    return g ? { ...g, total: o.total_line === "" ? null : Number(o.total_line) } : null;
  })
  .filter((g): g is G => g !== null)
  .sort((a, b) => a.gameday.localeCompare(b.gameday) || a.id.localeCompare(b.id));
const LAST = Math.max(...games.filter((g) => g.homeScore !== null).map((g) => g.season));

// Reports and usage by season|week|team (current team codes).
const reports = new Map<string, ReportEntry[]>();
const usage = new Map<string, { id: string; opp: number }[]>();
for (let s = FIRST; s <= LAST; s++) {
  const inj = `${DIR}/injuries_${s}.csv`;
  const st = `${DIR}/stats_player_week_${s}.csv`;
  if (!existsSync(inj) || !existsSync(st)) throw new Error(`missing ${inj} or ${st}: run scripts/nfl-injury-history.mts`);
  for (const r of records(readFileSync(inj, "utf8"))) {
    const k = `${s}|${Number(r.week)}|${normTeam(r.team)}`;
    const list = reports.get(k) ?? [];
    list.push({ id: r.gsis_id, pos: r.position, status: r.report_status });
    reports.set(k, list);
  }
  for (const r of readStats(readFileSync(st, "utf8"))) {
    const k = `${s}|${r.week}|${normTeam(r.team)}`;
    const list = usage.get(k) ?? [];
    list.push({ id: r.id, opp: r.tgt + r.car });
    usage.set(k, list);
  }
}

// Features as of kickoff, a game at a time (a team plays once a week, so no same-day leak).
const out = new Map<string, { home: TeamOut; away: TeamOut; reported: boolean }>();
{
  const book = new UsageBook();
  const lastQb = new Map<string, string>();
  const prevOut = new Map<string, Set<string>>();
  let season = 0;
  for (const g of games) {
    if (g.season < FIRST) continue;
    if (g.season !== season) {
      prevOut.clear();
      season = g.season;
    }
    const side = (team: string) => {
      const t = normTeam(team);
      const rep = reports.get(`${g.season}|${g.week}|${t}`);
      return { t, rep: rep ?? [], has: !!rep };
    };
    const H = side(g.home);
    const A = side(g.away);
    const f = (s: typeof H) => teamOut(s.rep, { lastQb: lastQb.get(s.t), prevOut: prevOut.get(s.t) ?? new Set(), share: (id) => book.share(s.t, id) });
    out.set(g.id, { home: f(H), away: f(A), reported: H.has && A.has });
    if (g.homeScore === null) continue;
    for (const [s, qb] of [[H, g.homeQb], [A, g.awayQb]] as const) {
      const u = usage.get(`${g.season}|${g.week}|${s.t}`);
      if (u) book.add(s.t, u);
      if (qb) lastQb.set(s.t, qb);
      prevOut.set(s.t, outIds(s.rep));
    }
  }
}
{
  const done = games.filter((g) => g.season >= FIRST && g.homeScore !== null);
  const rep = done.filter((g) => out.get(g.id)?.reported).length;
  const teamRows = done.flatMap((g) => [out.get(g.id)!.home, out.get(g.id)!.away]);
  say(`games ${FIRST}-${LAST} with a score: ${done.length}; both teams on an injury report: ${rep}`);
  say(`team-games with qbOut: ${teamRows.filter((t) => t.qbOut).length} of ${teamRows.length}; skillOut > 0: ${teamRows.filter((t) => t.skillOut > 0).length}; >= 0.1: ${teamRows.filter((t) => t.skillOut >= 0.1).length}; >= 0.2: ${teamRows.filter((t) => t.skillOut >= 0.2).length}; >= 0.3: ${teamRows.filter((t) => t.skillOut >= 0.3).length}`);
}

const ats = (rows: { pred: number; res: number }[], t: number) => {
  let w = 0, l = 0, p = 0;
  for (const { pred, res } of rows) {
    if (Math.abs(pred) < t || pred === 0) continue;
    if (res === 0) p++;
    else if (Math.sign(res) === Math.sign(pred)) w++;
    else l++;
  }
  const n = w + l;
  const z = n ? (w / n - 0.5238) / Math.sqrt((0.5238 * 0.4762) / n) : 0;
  return `${w}-${l}-${p} ${n ? ((100 * w) / n).toFixed(1) : "0.0"}% ${w * (100 / 110) - l >= 0 ? "+" : ""}${(w * (100 / 110) - l).toFixed(1)}u z ${z.toFixed(2)}`;
};
const mean = (xs: number[]) => xs.reduce((a, x) => a + x, 0) / xs.length;

// ---------- Spread ----------
say("\n== SPREAD (walk forward as fit-nfl-spread.mts; ratings from spread-params.json) ==");
const XKEYS = [...FEATURES, "qbOut", "skillOut"] as const;
type XK = (typeof XKEYS)[number];
type Row = { r: Rated; x: Record<XK, number>; y: number };
const rows: Row[] = rateAll(games, (SPREAD as SpreadParams).rating)
  .filter((r) => r.game.season >= 2002)
  .map((r) => {
    const o = out.get(r.game.id);
    return {
      r,
      x: { ...r.x, qbOut: o ? o.home.qbOut - o.away.qbOut : 0, skillOut: o ? o.home.skillOut - o.away.skillOut : 0 },
      y: r.game.homeScore! - r.game.awayScore! - r.game.line!,
    };
  });
type Pred = { row: Row; pred: number };
function walk(from: number, to: number, lambda: number, keys: readonly XK[], trainFrom: number): Pred[] {
  const res: Pred[] = [];
  for (let s = from; s <= to; s++) {
    const f = fitRidge(rows.filter((r) => r.r.game.season < s && r.r.game.season >= trainFrom).map((r) => ({ x: r.x, y: r.y })), lambda, keys);
    for (const row of rows.filter((r) => r.r.game.season === s)) res.push({ row, pred: f.b + keys.reduce((a, k) => a + f.w[k] * row.x[k], 0) });
  }
  return res;
}
function pickLambda(keys: readonly XK[], trainFrom: number) {
  let best = { e: Infinity, l: 100 };
  for (const l of [1, 10, 100, 1000, 10000, 100000]) {
    const ps = walk(2010, 2014, l, keys, trainFrom);
    const e = mean(ps.map((p) => (p.row.y - p.pred) ** 2));
    if (e < best.e) best = { e, l };
  }
  return best.l;
}
const variants: { name: string; keys: readonly XK[]; from: number }[] = [
  { name: "shipped (5 features, train 2002+)", keys: FEATURES, from: 2002 },
  { name: "5 features, train 2009+", keys: FEATURES, from: 2009 },
  { name: "5 + qbOut + skillOut, train 2009+", keys: XKEYS, from: 2009 },
  { name: "5 + qbOut + skillOut, train 2002+ (zeros before 2009)", keys: XKEYS, from: 2002 },
  { name: "qbOut + skillOut only, train 2009+", keys: ["qbOut", "skillOut"], from: 2009 },
];
const tested = new Map<string, Pred[]>();
for (const v of variants) {
  const lam = pickLambda(v.keys, v.from);
  const t = walk(2015, LAST, lam, v.keys, v.from);
  tested.set(v.name, t);
  const base = mean(t.map((p) => p.row.y ** 2));
  const ours = mean(t.map((p) => (p.row.y - p.pred) ** 2));
  const f = fitRidge(rows.filter((r) => r.r.game.season >= v.from && r.r.game.season < LAST).map((r) => ({ x: r.x, y: r.y })), lam, v.keys);
  say(`${v.name}: lambda ${lam}; TEST 2015-${LAST} ${t.length} games, margin MSE line alone ${base.toFixed(3)}, line + ours ${ours.toFixed(3)} (${((100 * (base - ours)) / base).toFixed(3)}% better)`);
  say(`  ATS |edge|>=0: ${ats(t.map((p) => ({ pred: p.pred, res: p.row.y })), 0)}; >=0.5: ${ats(t.map((p) => ({ pred: p.pred, res: p.row.y })), 0.5)}; >=1: ${ats(t.map((p) => ({ pred: p.pred, res: p.row.y })), 1)}`);
  say(`  weights through ${LAST - 1}: ${v.keys.map((k) => `${k} ${f.w[k].toFixed(3)}`).join(", ")}`);
}
{
  const a = tested.get(variants[0].name)!;
  const c = tested.get(variants[2].name)!;
  const ev = paired(a.map((p) => (p.row.y - p.pred) ** 2), c.map((p) => (p.row.y - p.pred) ** 2));
  say(`paired, shipped vs 5 + injuries (train 2009+): MSE ${ev.before} -> ${ev.after}, gain ${ev.se} SE over ${ev.games} games`);
  const b = tested.get(variants[1].name)!;
  const ev2 = paired(b.map((p) => (p.row.y - p.pred) ** 2), c.map((p) => (p.row.y - p.pred) ** 2));
  say(`paired, 5 features vs 5 + injuries (both train 2009+): MSE ${ev2.before} -> ${ev2.after}, gain ${ev2.se} SE`);
  const d = tested.get(variants[3].name)!;
  const ev3 = paired(a.map((p) => (p.row.y - p.pred) ** 2), d.map((p) => (p.row.y - p.pred) ** 2));
  say(`paired, shipped vs 5 + injuries (both train 2002+, the shipped window): MSE ${ev3.before} -> ${ev3.after}, gain ${ev3.se} SE (the weekly refit stores only at 2+ SE)`);
}
// Raw: the line's own miss when a team is missing a lot.
{
  const t = rows.filter((r) => r.r.game.season >= 2015);
  say(`raw, 2015-${LAST}: mean (margin - line) by home-minus-away qbOut: ${[-1, 0, 1].map((q) => { const s = t.filter((r) => r.x.qbOut === q); return `${q}: ${mean(s.map((r) => r.y)).toFixed(2)} (n ${s.length})`; }).join(", ")}`);
  const hi = t.filter((r) => r.x.skillOut >= 0.15), lo = t.filter((r) => r.x.skillOut <= -0.15);
  say(`raw, skillOut diff >= 0.15: mean (margin - line) ${mean(hi.map((r) => r.y)).toFixed(2)} (n ${hi.length}); <= -0.15: ${mean(lo.map((r) => r.y)).toFixed(2)} (n ${lo.length})`);
}

// ---------- Totals ----------
say("\n== TOTALS (as fit-nfl-totals.mts; points ratings from totals-params.json) ==");
const P = TOTALS as NflTotalsParams;
const proj = new Map<string, number>();
{
  const r = new PointsRatings(P.points, P.start);
  for (let i = 0; i < games.length; ) {
    let j = i;
    while (j < games.length && games[j].gameday === games[i].gameday) j++;
    const day = games.slice(i, j);
    for (const g of day) {
      const e = r.expect(g.season, g.home, g.away, g.neutral);
      proj.set(g.id, e.home + e.away);
    }
    for (const g of day) if (g.homeScore !== null && g.awayScore !== null) r.add(nflResult(g));
    i = j;
  }
}
type TK = "qbOut" | "skillOut";
type TRow = { g: G; ours: number; pts: number; x: Record<TK, number> };
const trows: TRow[] = games
  .filter((g) => g.season >= FIRST && g.homeScore !== null && g.total !== null)
  .map((g) => {
    const o = out.get(g.id)!;
    return { g, ours: proj.get(g.id)!, pts: g.homeScore! + g.awayScore!, x: { qbOut: o.home.qbOut + o.away.qbOut, skillOut: o.home.skillOut + o.away.skillOut } };
  });
const tfit = (train: TRow[], keys: readonly TK[], lam: number) => fitRidge(train.map((r) => ({ x: r.x, y: r.pts - r.ours })), lam, keys);
const tpred = (r: TRow, f: { w: Record<string, number>; b: number }, keys: readonly TK[]) => r.ours + f.b + keys.reduce((a, k) => a + f.w[k] * r.x[k], 0);
const ou = (rs: { pred: number; line: number; pts: number }[], edge: number) => {
  let w = 0, l = 0;
  for (const r of rs) {
    if (Math.abs(r.pred - r.line) < edge || r.pred === r.line) continue;
    const v = r.pred > r.line ? r.pts - r.line : r.line - r.pts;
    if (v > 0) w++;
    else if (v < 0) l++;
  }
  const n = w + l;
  return `${w}-${l} ${n ? ((100 * w) / n).toFixed(1) : "0.0"}% ${(w * (100 / 110) - l).toFixed(1)}u`;
};
const TLAM = 100;
for (const [label, testFrom, walkIt] of [["TEST 2024 on (train 2009-2023)", 2024, false], [`season walk 2015-${LAST} (train ${FIRST}..S-1)`, 2015, true]] as const) {
  const test = trows.filter((r) => r.g.season >= testFrom);
  const preds = (keys: readonly TK[]) =>
    walkIt
      ? test.map((r) => tpred(r, tfit(trows.filter((x) => x.g.season < r.g.season), keys, TLAM), keys))
      : (() => {
          const f = tfit(trows.filter((x) => x.g.season < testFrom), keys, TLAM);
          return test.map((r) => tpred(r, f, keys));
        })();
  const raw = test.map((r) => r.ours);
  const icpt = preds([]);
  const inj = preds(["qbOut", "skillOut"]);
  const rm = (p: number[]) => Math.sqrt(mean(test.map((r, i) => (p[i] - r.pts) ** 2))).toFixed(3);
  say(`${label}: ${test.length} games. RMSE raw ours ${rm(raw)}, ours + intercept ${rm(icpt)}, ours + intercept + injuries ${rm(inj)}, total_line ${rm(test.map((r) => r.g.total!))}`);
  for (const e of [0, 3, 5]) say(`  our side of total_line${e ? `, ${e}+ off` : ""}: raw ${ou(test.map((r, i) => ({ pred: raw[i], line: r.g.total!, pts: r.pts })), e)} | +intercept ${ou(test.map((r, i) => ({ pred: icpt[i], line: r.g.total!, pts: r.pts })), e)} | +injuries ${ou(test.map((r, i) => ({ pred: inj[i], line: r.g.total!, pts: r.pts })), e)}`);
  const ev = paired(test.map((r, i) => (icpt[i] - r.pts) ** 2), test.map((r, i) => (inj[i] - r.pts) ** 2));
  say(`  paired, intercept vs + injuries: squared error ${ev.before} -> ${ev.after}, gain ${ev.se} SE`);
}
{
  const f = tfit(trows.filter((x) => x.g.season < 2024), ["qbOut", "skillOut"], TLAM);
  say(`totals injury weights (train 2009-2023): qbOut ${f.w.qbOut.toFixed(2)} pts per QB out, skillOut ${f.w.skillOut.toFixed(2)} pts per unit share, intercept ${f.b.toFixed(2)}`);
  const t = trows.filter((r) => r.g.season >= 2015);
  for (const q of [0, 1, 2]) {
    const s = t.filter((r) => r.x.qbOut === q);
    say(`raw, 2015-${LAST}: QBs out ${q}: points - total_line ${mean(s.map((r) => r.pts - r.g.total!)).toFixed(2)}, points - ours ${mean(s.map((r) => r.pts - r.ours)).toFixed(2)} (n ${s.length})`);
  }
}

// ---------- Guard ----------
say("\n== GUARD: games where either team is newly missing its QB or skillOut >= cut ==");
const shipped = tested.get(variants[0].name)!;
const tAll = trows.filter((r) => r.g.season >= 2015);
const t24 = new Set(trows.filter((r) => r.g.season >= 2024).map((r) => r.g.id));
for (const cut of [0.1, 0.15, 0.2, 0.25, 0.3, Infinity]) {
  const flag = (id: string) => {
    const o = out.get(id);
    return !!o && (bigOut(o.home, cut) || bigOut(o.away, cut));
  };
  const sp = (f: boolean) => shipped.filter((p) => flag(p.row.r.game.id) === f).map((p) => ({ pred: p.pred, res: p.row.y }));
  const lineMse = (f: boolean) => mean(shipped.filter((p) => flag(p.row.r.game.id) === f).map((p) => p.row.y ** 2)).toFixed(1);
  const tt = (f: boolean, only24: boolean) => tAll.filter((r) => flag(r.g.id) === f && (!only24 || t24.has(r.g.id))).map((r) => ({ pred: r.ours, line: r.g.total!, pts: r.pts }));
  const name = cut === Infinity ? "QB only" : `QB or skillOut >= ${cut}`;
  say(`${name}: spread side (shipped model, 2015-${LAST}) flagged ${ats(sp(true), 0)} [line MSE ${lineMse(true)}] vs rest ${ats(sp(false), 0)} [line MSE ${lineMse(false)}]`);
  const diffZ = (a: { pred: number; res: number }[], b: { pred: number; res: number }[]) => {
    const wl = (xs: typeof a) => xs.reduce((o, { pred, res }) => (res === 0 || pred === 0 ? o : Math.sign(res) === Math.sign(pred) ? { w: o.w + 1, n: o.n + 1 } : { w: o.w, n: o.n + 1 }), { w: 0, n: 0 });
    const A = wl(a), B = wl(b), pp = (A.w + B.w) / (A.n + B.n);
    return ((A.w / A.n - B.w / B.n) / Math.sqrt(pp * (1 - pp) * (1 / A.n + 1 / B.n))).toFixed(2);
  };
  say(`  spread win rate flagged minus rest: z ${diffZ(sp(true), sp(false))}`);
  say(`  spread |edge|>=0.5 flagged ${ats(sp(true), 0.5)} vs rest ${ats(sp(false), 0.5)}`);
  say(`  totals side (ours vs total_line) 2015-${LAST}: flagged ${ou(tt(true, false), 0)} vs rest ${ou(tt(false, false), 0)}; 3+ off flagged ${ou(tt(true, false), 3)} vs rest ${ou(tt(false, false), 3)}`);
  say(`  totals side 2024 on (held out of the totals fit): flagged ${ou(tt(true, true), 0)} vs rest ${ou(tt(false, true), 0)}; 3+ off flagged ${ou(tt(true, true), 3)} vs rest ${ou(tt(false, true), 3)}`);
}
writeFileSync(".cache/fit-nfl-injuries.txt", log.join("\n") + "\n");
