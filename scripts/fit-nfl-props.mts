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
// Needs .cache/nfl/stats_player_week_{2024,2025,2026}.csv and games.csv (nflverse).
import { readFileSync, writeFileSync } from "node:fs";
import { readGames, readStats, type NflRow } from "../src/lib/models/nfl/data";
import { NflRunning, summarizeNfl, type NflSummary } from "../src/lib/models/nfl/history";
import { NFL_STATS, nflMedian, nflOverUnder, projectNflGame, type NflParams, type NflPlayerInput, type NflStat, type NflTeamInput } from "../src/lib/models/nfl/props";

const rows = (s: number) => readStats(readFileSync(`.cache/nfl/stats_player_week_${s}.csv`, "utf8"));
const games = new Map(readGames(readFileSync(".cache/nfl/games.csv", "utf8")).map((g) => [g.game, g]));
const ACTUAL: { [s in NflStat]: (r: NflRow) => number } = { pass_yds: (r) => r.passYds, rush_yds: (r) => r.rushYds, rec_yds: (r) => r.recYds, rec: (r) => r.rec };

interface Case {
  season: number;
  week: number;
  game: string;
  home: string;
  margin: number | null;
  players: NflPlayerInput[];
  teams: { [t: string]: NflTeamInput };
  absent: NflPlayerInput[];
  actual: Map<string, NflRow>;
  judged: { id: string; stat: NflStat; naive: number }[];
}

function build(season: number, prior: NflSummary): Case[] {
  const all = rows(season);
  const run = new NflRunning();
  const out: Case[] = [];
  for (const week of [...new Set(all.map((r) => r.week))].sort((a, b) => a - b)) {
    const wk = all.filter((r) => r.week === week);
    for (const game of new Set(wk.map((r) => r.game))) {
      const gr = wk.filter((r) => r.game === game);
      const meta = games.get(game);
      if (!meta) continue;
      const players = gr.map((r) => run.player(r.id, r.team, r.pos, prior));
      const teams = Object.fromEntries([meta.home, meta.away].map((t) => [t, run.team(t, prior)]));
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
      out.push({ season, week, game, home: meta.home, margin: meta.homeMargin, players, teams, absent, actual: new Map(gr.map((r) => [r.id, r])), judged });
    }
    run.addWeek(wk);
  }
  return out;
}

const s2025 = build(2025, summarizeNfl(rows(2024)));
const s2026 = build(2026, summarizeNfl(rows(2025)));
const base2025 = summarizeNfl(rows(2024)).base;
const base2026 = summarizeNfl(rows(2025)).base;
const train = s2025.filter((c) => c.week <= 9);
const test = s2025.filter((c) => c.week >= 10);
console.log(`games: train ${train.length}, test ${test.length}, 2026 ${s2026.length}`);

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

function project(cs: Case[], p: NflParams, base = base2025) {
  const out: { c: Case; id: string; stat: NflStat; naive: number; mean: number; y: number }[] = [];
  for (const c of cs) {
    const pr = new Map(projectNflGame(c.players, c.teams, c.home, c.margin, base, p, c.absent).map((x) => [x.id, x]));
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
        const pa = ta.prior?.att ?? base2025.att;
        const pc = ta.prior?.car ?? base2025.car;
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
say(`dispersion: receptions NB r ${P.disp.rec}; gamma variance phi x mean^pow: rec_yds ${P.disp.rec_yds} x mean^${P.pow.rec_yds}, rush_yds ${P.disp.rush_yds} x mean^${P.pow.rush_yds}, pass_yds ${P.disp.pass_yds} x mean^${P.pow.pass_yds}`);
{
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
  say(`calibration slope: ${P.calib}`);
}

function report(name: string, cs: Case[], base: typeof base2025) {
  const rs = project(cs, P, base);
  say(`\n${name} (${cs.length} games)`);
  const cal: { p: number; y: number }[] = [];
  for (const s of NFL_STATS) {
    const xs = rs.filter((r) => r.stat === s);
    let br = 0;
    for (const r of xs) {
      const line = Math.floor(r.naive) + 0.5;
      const y = r.y > line ? 1 : 0;
      const po = nflOverUnder(s, Math.max(r.mean, 0.1), line, P).over;
      br += (po - y) ** 2;
      cal.push({ p: po, y });
    }
    const coin = xs.reduce((a, r) => a + (0.5 - (r.y > Math.floor(r.naive) + 0.5 ? 1 : 0)) ** 2, 0);
    say(`${s}: n ${xs.length}; MAE ours ${mae(xs).toFixed(2)} vs season average ${mae(xs, (r) => r.naive).toFixed(2)}; Brier at the average's line ${(br / xs.length).toFixed(4)} vs coin flip ${(coin / xs.length).toFixed(4)}; mean bias ${(xs.reduce((a, r) => a + r.mean - r.y, 0) / xs.length).toFixed(2)}`);
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
