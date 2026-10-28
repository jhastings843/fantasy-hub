// Walk-forward fit and test of the NFL props model (src/lib/models/nfl/props.ts).
//
// Season 2025, week by week: each game projected from earlier weeks only
// (plus all of 2024 as the prior), using nflverse's spread and total for that
// game. Constants fit on weeks 1-9, tested on weeks 10-18, then a second test
// on 2026 weeks 1-6 (2025 as the prior). Players with a stat row stand in for
// who was active (nflverse has no row for a player with no touch); regulars
// (a row in each of the team's last 3 games) without one are tonight's absences.
//
// Judged (param-free), per stat: receptions and receiving yards, 4+ targets a
// game coming in; rushing, 8+ carries; passing, a QB with 20+ attempts.
//
//   npx tsx --tsconfig scripts/tsconfig.json scripts/fit-nfl-props.mts
// Needs .cache/nfl/stats_player_week_{2024,2025,2026}.csv and games.csv (nflverse),
// and .cache/nfl/air_{2024,2025,2026}.json (scripts/nfl-air.mts) for the depth
// of target candidate.
//
// Candidate inputs (opponent defense, implied team total, depth of target) are
// each fit on the train weeks from the same base, then the base and each
// candidate get their own dispersion and calibration and are compared on both
// test sets. KEEP lists the ones that earned a place (judged by hand on that
// comparison: better on both tests for the stats they touch).
//
// --refit (weekly job, scripts/refit/common.mts): test = the last 4 weeks with
// data across 2025 and 2026, train = every game before; refits the same steps
// with the kept inputs (implied total, opponent factor on passing yards and
// receptions), no candidate comparison, and stores the refit only if its
// over/under log loss at the naive line, summed per game, beats the live
// settings by 2+ SE. Writes no JSON. Add --dry to score without storing.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import PROPS_DEFAULTS from "../src/lib/models/nfl/params.json";
import { REFIT, liveParams, paired, submit } from "./refit/common.mjs";
import { readGames, readStats, type NflRow } from "../src/lib/models/nfl/data";
import { NflRunning, nflPos, summarizeNfl, type NflSummary } from "../src/lib/models/nfl/history";
import { NFL_STATS, impliedPoints, nflMedian, teamVolume, nflOverUnder, projectNflGame, type NflParams, type NflPlayerInput, type NflStat, type NflTeamInput } from "../src/lib/models/nfl/props";

const rows = (s: number) => readStats(readFileSync(`.cache/nfl/stats_player_week_${s}.csv`, "utf8"));
const games = new Map(readGames(readFileSync(".cache/nfl/games.csv", "utf8")).map((g) => [g.game, g]));
const ACTUAL: { [s in NflStat]: (r: NflRow) => number } = { pass_yds: (r) => r.passYds, rush_yds: (r) => r.rushYds, rec_yds: (r) => r.recYds, rec: (r) => r.rec };

interface Case {
  season: number;
  week: number;
  game: string;
  home: string;
  margin: number | null;
  total: number | null;
  players: NflPlayerInput[];
  teams: { [t: string]: NflTeamInput };
  absent: NflPlayerInput[];
  actual: Map<string, NflRow>;
  judged: { id: string; stat: NflStat; naive: number }[];
  /** League base of the prior season this case was built on. */
  base: NflSummary["base"];
}

type Air = { [k: string]: [number, number] };
const air = (s: number): Air => (existsSync(`.cache/nfl/air_${s}.json`) ? JSON.parse(readFileSync(`.cache/nfl/air_${s}.json`, "utf8")) : {});
const ALLOWED = (["QB", "RB", "WR", "TE"] as const).flatMap((pos) => NFL_STATS.map((s) => `${pos}:${s}`));

function build(season: number, prior: NflSummary): Case[] {
  const all = rows(season);
  const run = new NflRunning();
  const out: Case[] = [];
  // Air yards: all of last season, then this season's games as they finish.
  const airRun = new Map<string, { yds: number; tgt: number }>();
  for (const [k, [yds, tgt]] of Object.entries(air(season - 1))) {
    const a = airRun.get(k.split("|")[1]) ?? { yds: 0, tgt: 0 };
    airRun.set(k.split("|")[1], { yds: a.yds + yds, tgt: a.tgt + tgt });
  }
  const airNow = air(season);
  // What each defense allowed, per game, keyed "POS:stat".
  const allowed = new Map<string, { [k: string]: number }[]>();
  for (const week of [...new Set(all.map((r) => r.week))].sort((a, b) => a - b)) {
    const wk = all.filter((r) => r.week === week);
    for (const game of new Set(wk.map((r) => r.game))) {
      const gr = wk.filter((r) => r.game === game);
      const meta = games.get(game);
      if (!meta) continue;
      const players = gr.map((r) => ({ ...run.player(r.id, r.team, r.pos, prior), ...(airRun.has(r.id) ? { air: { ...airRun.get(r.id)! } } : {}) }));
      const allDef = [...allowed.values()].flat();
      const league = Object.fromEntries(ALLOWED.map((k) => [k, allDef.reduce((a, d) => a + (d[k] ?? 0), 0) / (allDef.length || 1)]));
      const defense = (t: string) => {
        const xs = allowed.get(t) ?? [];
        return { games: xs.length, allowed: Object.fromEntries(ALLOWED.map((k) => [k, xs.reduce((a, d) => a + (d[k] ?? 0), 0)])), league };
      };
      const teams = Object.fromEntries([meta.home, meta.away].map((t) => [t, { ...run.team(t, prior), defense: defense(t) }]));
      const played = new Set(gr.map((r) => r.id));
      const absent = [meta.home, meta.away].flatMap((t) => {
        const last = (run.teams.get(t) ?? []).slice(-3);
        if (last.length < 3) return [];
        return [...new Set(last.flatMap((g) => g.ids))].filter((id) => last.every((g) => g.ids.includes(id)) && !played.has(id)).map((id) => run.player(id, t, "", prior));
      });
      const judged: Case["judged"] = [];
      for (const pl of players) {
        const n = pl.games.length;
        const avg = (f: (g: NflPlayerInput["games"][number]) => number, pf: number | undefined) => (n >= 2 ? pl.games.reduce((a, g) => a + f(g), 0) / n : pl.prior && pl.prior.games ? pf! / pl.prior.games : NaN);
        const tg = avg((g) => g.tgt, pl.prior?.tgt);
        const car = avg((g) => g.car, pl.prior?.car);
        const att = avg((g) => g.att, pl.prior?.att);
        if (tg >= 4) {
          judged.push({ id: pl.id, stat: "rec", naive: avg((g) => g.rec, pl.prior?.rec) });
          judged.push({ id: pl.id, stat: "rec_yds", naive: avg((g) => g.recYds, pl.prior?.recYds) });
        }
        if (car >= 8) judged.push({ id: pl.id, stat: "rush_yds", naive: avg((g) => g.rushYds, pl.prior?.rushYds) });
        if (pl.pos === "QB" && att >= 20) judged.push({ id: pl.id, stat: "pass_yds", naive: avg((g) => g.passYds, pl.prior?.passYds) });
      }
      out.push({ season, week, game, home: meta.home, margin: meta.homeMargin, total: meta.total, players, teams, absent, actual: new Map(gr.map((r) => [r.id, r])), judged, base: prior.base });
    }
    run.addWeek(wk);
    for (const game of new Set(wk.map((r) => r.game))) {
      const gr = wk.filter((r) => r.game === game);
      for (const def of new Set(gr.map((r) => r.opp))) {
        const d: { [k: string]: number } = {};
        for (const r of gr.filter((x) => x.opp === def)) for (const s of NFL_STATS) d[`${nflPos(r.pos)}:${s}`] = (d[`${nflPos(r.pos)}:${s}`] ?? 0) + ACTUAL[s](r);
        allowed.set(def, [...(allowed.get(def) ?? []), d]);
      }
      for (const r of gr) {
        const a = airNow[`${game}|${r.id}`];
        if (!a) continue;
        const cur = airRun.get(r.id) ?? { yds: 0, tgt: 0 };
        airRun.set(r.id, { yds: cur.yds + a[0], tgt: cur.tgt + a[1] });
      }
    }
  }
  return out;
}

const s2025 = build(2025, summarizeNfl(rows(2024)));
const s2026 = build(2026, summarizeNfl(rows(2025)));
const base2025 = summarizeNfl(rows(2024)).base;
const base2026 = summarizeNfl(rows(2025)).base;
const wkOf = (c: Case) => c.season * 100 + c.week;
const lastWeeks = [...new Set([...s2025, ...s2026].map(wkOf))].sort((a, b) => a - b).slice(-4);
const train = REFIT ? [...s2025, ...s2026].filter((c) => wkOf(c) < lastWeeks[0]) : s2025.filter((c) => c.week <= 9);
const test = REFIT ? [...s2025, ...s2026].filter((c) => lastWeeks.includes(wkOf(c))) : s2025.filter((c) => c.week >= 10);
console.log(REFIT ? `refit: test weeks ${lastWeeks.join(", ")} (season*100+week); games: train ${train.length}, test ${test.length}` : `games: train ${train.length}, test ${test.length}, 2026 ${s2026.length}`);

let P: NflParams = {
  kTeam: 4,
  margin: { att: 0, car: 0 },
  kTgt: 50,
  kCar: 50,
  kAtt: 50,
  kYpt: 50,
  kCr: 50,
  kYpc: 50,
  kYpa: 100,
  share: false,
  disp: { rec: 10, rec_yds: 10, rush_yds: 10, pass_yds: 20 },
  pow: { rec_yds: 1, rush_yds: 1, pass_yds: 1 },
  calib: 1,
};

// Each case carries its prior season's base; callers may pass the same one explicitly.
function project(cs: Case[], p: NflParams, base?: typeof base2025) {
  const out: { c: Case; id: string; stat: NflStat; naive: number; mean: number; y: number }[] = [];
  for (const c of cs) {
    const pr = new Map(projectNflGame(c.players, c.teams, c.home, c.margin, base ?? c.base, p, c.absent, c.total).map((x) => [x.id, x]));
    for (const j of c.judged) out.push({ c, id: j.id, stat: j.stat, naive: j.naive, mean: pr.get(j.id)!.mean[j.stat], y: ACTUAL[j.stat](c.actual.get(j.id)!) });
  }
  return out;
}
const mse = (xs: { mean: number; y: number }[]) => xs.reduce((a, r) => a + (r.mean - r.y) ** 2, 0) / xs.length;
const mae = <T extends { mean: number; y: number }>(xs: T[], f: (r: T) => number = (r) => r.mean) => xs.reduce((a, r) => a + Math.abs(f(r) - r.y), 0) / xs.length;
const err = (p: NflParams, stats: NflStat[]) => {
  const r = project(train, p);
  return stats.reduce((a, s) => {
    const xs = r.filter((x) => x.stat === s);
    const m = xs.reduce((q, x) => q + x.y, 0) / xs.length;
    return a + mse(xs) / (xs.reduce((q, x) => q + (x.y - m) ** 2, 0) / xs.length);
  }, 0);
};
const log: string[] = [];
const say = (s: string) => {
  console.log(s);
  log.push(s);
};
const grid = (key: keyof NflParams, vals: number[] | boolean[], stats: NflStat[]) => {
  let best = { e: Infinity, v: P[key] };
  for (const v of vals) {
    const e = err({ ...P, [key]: v }, stats);
    if (e < best.e) best = { e, v };
  }
  P = { ...P, [key]: best.v };
};

// 1. Team volume: shrink and the margin effect, on team attempts and carries.
{
  const teamErr = (p: NflParams) => {
    let a = 0, n = 0;
    for (const c of train) {
      for (const t of Object.keys(c.teams)) {
        const margin = (c.margin ?? 0) * (t === c.home ? 1 : -1);
        const rowsT = [...c.actual.values()].filter((r) => r.team === t);
        const att = rowsT.reduce((q, r) => q + r.att, 0);
        const car = rowsT.reduce((q, r) => q + r.car, 0);
        const ta = c.teams[t];
        const pa = ta.prior?.att ?? c.base.att;
        const pc = ta.prior?.car ?? c.base.car;
        const ea = (ta.games.reduce((q, g) => q + g.att, 0) + p.kTeam * pa) / (ta.games.length + p.kTeam) + p.margin.att * margin;
        const ec = (ta.games.reduce((q, g) => q + g.car, 0) + p.kTeam * pc) / (ta.games.length + p.kTeam) + p.margin.car * margin;
        a += (ea - att) ** 2 + (ec - car) ** 2;
        n++;
      }
    }
    return a / n;
  };
  let best = { e: Infinity, p: P };
  for (const kTeam of [0, 1, 2, 4, 8, 16])
    for (const ma of [-1.2, -1, -0.8, -0.6, -0.4, -0.2, 0])
      for (const mc of [0, 0.2, 0.4, 0.6, 0.8, 1, 1.2]) {
        const p = { ...P, kTeam, margin: { att: ma, car: mc } };
        const e = teamErr(p);
        if (e < best.e) best = { e, p };
      }
  P = best.p;
  say(`team: kTeam ${P.kTeam}, attempts ${P.margin.att} and carries ${P.margin.car} per point of expected margin`);
}

// 2. Shares and efficiency, two passes of coordinate descent.
const K = [0, 5, 10, 25, 50, 100, 200, 400, 800];
for (let pass = 0; pass < 2; pass++) {
  grid("kTgt", K, ["rec", "rec_yds"]);
  grid("kCr", K, ["rec"]);
  grid("kYpt", K, ["rec_yds"]);
  grid("kCar", K, ["rush_yds"]);
  grid("kYpc", K, ["rush_yds"]);
  grid("kAtt", K, ["pass_yds"]);
  grid("kYpa", [...K, 1600], ["pass_yds"]);
}
say(`shares: kTgt ${P.kTgt}, kCar ${P.kCar}, kAtt ${P.kAtt}; efficiency: kCr ${P.kCr}, kYpt ${P.kYpt}, kYpc ${P.kYpc}, kYpa ${P.kYpa}`);
{
  const off = err({ ...P, share: false }, [...NFL_STATS]);
  const on = err({ ...P, share: true }, [...NFL_STATS]);
  P = { ...P, share: on < off };
  say(`absent shares handed out: ${P.share ? "yes" : "no"} (relative error off ${off.toFixed(4)}, on ${on.toFixed(4)})`);
}

// 3. Dispersion by over/under log loss at the naive line, then 4. calibration slope.
function tail(P0: NflParams, quiet = false): NflParams {
  let P = P0;
  const trainRows = project(train, P);
  for (const s of NFL_STATS) {
    let b = { l: -Infinity, v: 0, w: 1 };
    // Yardage: phi on a log grid for each power (variance phi x mean^pow).
    const phis = (w: number) => Array.from({ length: 40 }, (_, i) => Math.round(Math.pow(10, -2.5 + (i * 4.5) / 39) * 1e4) / 1e4).filter((v) => v * Math.pow(60, w) > 50 && v * Math.pow(60, w) < 200000);
    for (const w of s === "rec" ? [1] : [1, 1.25, 1.5, 1.75, 2])
      for (const v of s === "rec" ? [1, 2, 3, 5, 8, 12, 20, 40, 100] : phis(w)) {
        const p = { ...P, disp: { ...P.disp, [s]: v }, ...(s === "rec" ? {} : { pow: { ...P.pow, [s]: w } }) };
        // Scored on what gets priced: the over/under at a line (the player's
        // average to the half point), not the density, which chases the
        // zero-yard games of a QB who left early and drags the median down.
        const l = trainRows.filter((r) => r.stat === s).reduce((a, r) => {
          const line = Math.floor(r.naive) + 0.5;
          const po = Math.min(Math.max(nflOverUnder(s, Math.max(r.mean, 0.1), line, { ...p, calib: 1 }).over, 1e-6), 1 - 1e-6);
          return a + (r.y > line ? Math.log(po) : Math.log(1 - po));
        }, 0);
        if (l > b.l) b = { l, v, w };
      }
    P = { ...P, disp: { ...P.disp, [s]: b.v }, ...(s === "rec" ? {} : { pow: { ...P.pow, [s]: b.w } }) };
  }
  if (!quiet) say(`dispersion: receptions NB r ${P.disp.rec}; gamma variance phi x mean^pow: rec_yds ${P.disp.rec_yds} x mean^${P.pow.rec_yds}, rush_yds ${P.disp.rush_yds} x mean^${P.pow.rush_yds}, pass_yds ${P.disp.pass_yds} x mean^${P.pow.pass_yds}`);
  let b = { l: Infinity, a: 1 };
  for (let a = 0.4; a <= 1.3001; a += 0.05) {
    let l = 0;
    for (const r of trainRows) {
      const line = Math.floor(r.naive) + 0.5;
      const po = Math.min(Math.max(nflOverUnder(r.stat, Math.max(r.mean, 0.1), line, { ...P, calib: a }).over, 1e-6), 1 - 1e-6);
      l -= r.y > line ? Math.log(po) : Math.log(1 - po);
    }
    if (l < b.l) b = { l, a: Math.round(a * 100) / 100 };
  }
  P = { ...P, calib: b.a };
  if (!quiet) say(`calibration slope: ${P.calib}`);
  return P;
}

/** Per stat on one set: MAE, Brier and over/under log loss at the season-average line. */
function metrics(cs: Case[], p: NflParams, base: typeof base2025) {
  const rs = project(cs, p, base);
  return Object.fromEntries(
    NFL_STATS.map((s) => {
      const xs = rs.filter((r) => r.stat === s);
      let br = 0, ll = 0;
      for (const r of xs) {
        const line = Math.floor(r.naive) + 0.5;
        const y = r.y > line ? 1 : 0;
        const po = Math.min(Math.max(nflOverUnder(s, Math.max(r.mean, 0.1), line, p).over, 1e-6), 1 - 1e-6);
        br += (po - y) ** 2;
        ll -= y ? Math.log(po) : Math.log(1 - po);
      }
      return [s, { n: xs.length, mae: mae(xs), brier: br / xs.length, ll: ll / xs.length }];
    }),
  ) as { [s in NflStat]: { n: number; mae: number; brier: number; ll: number } };
}

// 5. Candidate inputs, each fit on the train weeks from the base above.
const BASE = P;
// Opponent defense: pseudo-games per stat, each on its own stat.
const kOpp: { [s in NflStat]?: number } = {};
for (const s of NFL_STATS) {
  let b = { e: err(BASE, [s]), v: undefined as number | undefined };
  for (const v of [1, 2, 4, 8, 16, 32, 64, 128, 256]) {
    const e = err({ ...BASE, kOpp: { [s]: v } }, [s]);
    if (e < b.e) b = { e, v };
  }
  if (b.v !== undefined) kOpp[s] = b.v;
}
// Implied team total: elasticity of attempts and carries. Fit on the player
// stats (all four); team volume error is printed alongside for reference.
const implied = (() => {
  const imp: number[] = [];
  for (const c of train) if (c.total !== null && c.margin !== null) for (const t of Object.keys(c.teams)) imp.push(impliedPoints(c.total, c.margin * (t === c.home ? 1 : -1)));
  const mean = Math.round((imp.reduce((a, x) => a + x, 0) / imp.length) * 100) / 100;
  const teamErr = (e: number) => {
    let a = 0, n = 0;
    for (const c of train) {
      for (const t of Object.keys(c.teams)) {
        const margin = (c.margin ?? 0) * (t === c.home ? 1 : -1);
        const rowsT = [...c.actual.values()].filter((r) => r.team === t);
        const v = teamVolume(c.teams[t], margin, c.base, { ...BASE, implied: { e, mean } }, c.total !== null && c.margin !== null ? impliedPoints(c.total, margin) : null);
        a += (v.att - rowsT.reduce((q, r) => q + r.att, 0)) ** 2 + (v.car - rowsT.reduce((q, r) => q + r.car, 0)) ** 2;
        n++;
      }
    }
    return a / n;
  };
  let b = { e: err(BASE, [...NFL_STATS]), v: 0 };
  for (let i = -10; i <= 20; i++) {
    const e = i / 20;
    const x = err({ ...BASE, implied: { e, mean } }, [...NFL_STATS]);
    if (x < b.e) b = { e: x, v: e };
  }
  say(`candidate implied total: league mean ${mean} points; fit e ${b.v} (train relative error ${err(BASE, [...NFL_STATS]).toFixed(4)} at 0, ${b.e.toFixed(4)} at ${b.v}); team volume error ${teamErr(0).toFixed(2)} at 0, ${teamErr(b.v).toFixed(2)} at ${b.v}`);
  return { e: b.v, mean };
})();
// Depth of target: yards per target on aDOT from last season's (2024) receivers,
// target-weighted least squares over players with 30+ targets, then k and w on train.
const adot = (() => {
  const prev = summarizeNfl(rows(2024)).players;
  const sums = new Map<string, [number, number]>();
  for (const [k, [y, t]] of Object.entries(air(2024))) {
    const id = k.split("|")[1];
    const s = sums.get(id) ?? [0, 0];
    sums.set(id, [s[0] + y, s[1] + t]);
  }
  const pts: { x: number; y: number; w: number }[] = [];
  for (const [id, [y, t]] of sums) {
    const pl = prev[id];
    if (!pl || pl.tgt < 30 || t < 30) continue;
    pts.push({ x: y / t, y: pl.recYds / pl.tgt, w: pl.tgt });
  }
  const W = pts.reduce((a, q) => a + q.w, 0);
  const mx = pts.reduce((a, q) => a + q.w * q.x, 0) / W;
  const my = pts.reduce((a, q) => a + q.w * q.y, 0) / W;
  const bb = pts.reduce((a, q) => a + q.w * (q.x - mx) * (q.y - my), 0) / pts.reduce((a, q) => a + q.w * (q.x - mx) ** 2, 0);
  const all = [...sums.values()].reduce((a, s) => [a[0] + s[0], a[1] + s[1]], [0, 0]);
  const q0 = { w: 0, a: Math.round((my - bb * mx) * 1000) / 1000, b: Math.round(bb * 1000) / 1000, k: 25, mean: Math.round((all[0] / all[1]) * 100) / 100 };
  let b = { e: err(BASE, ["rec_yds"]), q: q0 };
  for (const k of [10, 25, 50, 100, 200])
    for (let w = 0.1; w <= 1.0001; w += 0.1) {
      const q = { ...q0, k, w: Math.round(w * 10) / 10 };
      const e = err({ ...BASE, adot: q }, ["rec_yds"]);
      if (e < b.e) b = { e, q };
    }
  say(`candidate depth of target: ypt = ${q0.a} + ${q0.b} x aDOT (2024, ${pts.length} receivers), league aDOT ${q0.mean}; fit k ${b.q.k}, w ${b.q.w}`);
  return b.q;
})();
say(`candidate opponent defense: pseudo-games ${NFL_STATS.map((s) => `${s} ${kOpp[s] ?? "off"}`).join(", ")}`);

if (REFIT) {
  // The kept structure (see KEEP_OPP below), refit on train, against the live settings on the test weeks.
  const refit = tail({ ...BASE, implied, kOpp: Object.fromEntries((["pass_yds", "rec"] as NflStat[]).filter((s) => kOpp[s] !== undefined).map((s) => [s, kOpp[s]])) });
  const L = await liveParams("nfl-props", PROPS_DEFAULTS as unknown as NflParams);
  const perGame = (p: NflParams) => {
    const byGame = new Map<string, number>();
    for (const r of project(test, p)) {
      const line = Math.floor(r.naive) + 0.5;
      if (!Number.isFinite(line)) continue;
      const po = Math.min(Math.max(nflOverUnder(r.stat, Math.max(r.mean, 0.1), line, p).over, 1e-6), 1 - 1e-6);
      byGame.set(r.c.game, (byGame.get(r.c.game) ?? 0) - (r.y > line ? Math.log(po) : Math.log(1 - po)));
    }
    return test.map((c) => byGame.get(c.game) ?? 0);
  };
  const ev = paired(perGame(L), perGame(refit), `over/under log loss at the naive line, summed per game, weeks ${lastWeeks.join(",")}`);
  await submit("nfl-props", PROPS_DEFAULTS as unknown as NflParams, refit, ev);
  process.exit(0);
}

const VARIANTS: { name: string; p: NflParams }[] = [
  { name: "base", p: BASE },
  { name: "opponent", p: { ...BASE, kOpp } },
  { name: "implied", p: { ...BASE, implied } },
  { name: "adot", p: { ...BASE, adot } },
];
// Kept after the comparison (2026-10-26): the implied total, and the opponent
// factor on passing yards and receptions only (on rushing it was worse on the
// 2025 test, and train left receiving yards off). Depth of target was worse
// on receiving yards in both tests, so it stays off.
const KEEP_OPP: NflStat[] = ["pass_yds", "rec"];
const kept: NflParams = { ...BASE, implied, kOpp: Object.fromEntries(KEEP_OPP.filter((s) => kOpp[s] !== undefined).map((s) => [s, kOpp[s]])) };
VARIANTS.push({ name: "kept", p: kept });
const SETS = [
  { name: "2025 wk 10-18", cs: test, base: base2025 },
  { name: "2026 wk 1-6", cs: s2026, base: base2026 },
];
say("\ncandidates (each with its own dispersion and calibration): MAE / Brier / log loss");
const fitted = VARIANTS.map((v) => ({ ...v, p: tail(v.p, true) }));
for (const set of SETS) {
  say(`  ${set.name}`);
  const ms = fitted.map((v) => metrics(set.cs, v.p, set.base));
  for (const s of NFL_STATS) say(`    ${s} (n ${ms[0][s].n}): ${fitted.map((v, i) => `${v.name} ${ms[i][s].mae.toFixed(2)} / ${ms[i][s].brier.toFixed(4)} / ${ms[i][s].ll.toFixed(4)}`).join("; ")}`);
}

P = kept;
say(`\nkept: implied total e ${P.implied?.e} (mean ${P.implied?.mean}); opponent pseudo-games ${JSON.stringify(P.kOpp)}`);
P = tail(P);
{
  // What the live store gets until it passes the game total and each defense:
  // these dispersions with today's means.
  const bare = { ...P, implied: undefined, kOpp: undefined };
  for (const set of SETS) {
    const m = metrics(set.cs, bare, set.base);
    say(`  without the new inputs, ${set.name}: ${NFL_STATS.map((s) => `${s} ${m[s].mae.toFixed(2)} / ${m[s].brier.toFixed(4)} / ${m[s].ll.toFixed(4)}`).join("; ")}`);
  }
}

function report(name: string, cs: Case[], base: typeof base2025) {
  const rs = project(cs, P, base);
  say(`\n${name} (${cs.length} games)`);
  const cal: { p: number; y: number }[] = [];
  for (const s of NFL_STATS) {
    const xs = rs.filter((r) => r.stat === s);
    let br = 0, ll = 0;
    for (const r of xs) {
      const line = Math.floor(r.naive) + 0.5;
      const y = r.y > line ? 1 : 0;
      const po = nflOverUnder(s, Math.max(r.mean, 0.1), line, P).over;
      br += (po - y) ** 2;
      ll -= Math.log(Math.min(Math.max(y ? po : 1 - po, 1e-6), 1));
      cal.push({ p: po, y });
    }
    const coin = xs.reduce((a, r) => a + (0.5 - (r.y > Math.floor(r.naive) + 0.5 ? 1 : 0)) ** 2, 0);
    say(`${s}: n ${xs.length}; MAE ours ${mae(xs).toFixed(2)} vs season average ${mae(xs, (r) => r.naive).toFixed(2)}; Brier at the average's line ${(br / xs.length).toFixed(4)} vs coin flip ${(coin / xs.length).toFixed(4)}; log loss ${(ll / xs.length).toFixed(4)}; mean bias ${(xs.reduce((a, r) => a + r.mean - r.y, 0) / xs.length).toFixed(2)}`);
  }
  for (const s of ["rec_yds", "rush_yds", "pass_yds"] as const) {
    const xs = rs.filter((r) => r.stat === s).sort((a, b) => a.naive - b.naive);
    const third = Math.floor(xs.length / 3);
    const parts = [xs.slice(0, third), xs.slice(third, 2 * third), xs.slice(2 * third)].map((t) => {
      const bias = t.reduce((a, r) => a + r.mean - r.y, 0) / t.length;
      const med = t.reduce((a, r) => a + nflMedian(s, Math.max(r.mean, 0.1), P), 0) / t.length;
      const below = t.filter((r) => r.y < nflMedian(s, Math.max(r.mean, 0.1), P)).length / t.length;
      return `avg ${(t.reduce((a, r) => a + r.naive, 0) / t.length).toFixed(0)}: mean bias ${bias.toFixed(1)}, our median ${med.toFixed(0)}, ${(below * 100).toFixed(0)}% finished below it`;
    });
    say(`  ${s} by volume third: ${parts.join("; ")}`);
  }
  say("calibration (P(over) bins: predicted vs happened, n)");
  for (const [lo, hi] of [[0, 0.3], [0.3, 0.4], [0.4, 0.5], [0.5, 0.6], [0.6, 0.7], [0.7, 1.01]]) {
    const b = cal.filter((c) => c.p >= lo && c.p < hi);
    if (b.length) say(`  ${lo.toFixed(1)}-${Math.min(hi, 1).toFixed(1)}: ${(b.reduce((a, c) => a + c.p, 0) / b.length).toFixed(3)} vs ${(b.reduce((a, c) => a + c.y, 0) / b.length).toFixed(3)}, n ${b.length}`);
  }
}
report("TEST 2025 weeks 10-18", test, base2025);
report("TEST 2026 weeks 1-6 (2025 as the prior)", s2026, base2026);

writeFileSync("src/lib/models/nfl/params.json", JSON.stringify(P, null, 2) + "\n");
writeFileSync(".cache/fit-nfl-props.txt", log.join("\n") + "\n");
