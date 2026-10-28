// Walk-forward fit and test of the NBA props model (src/lib/models/nba/props.ts).
//
// Season 2025-26, every regular-season game in date order: each game is
// projected from games before its tip only (this season so far, plus all of
// 2024-25 as the prior), then added to the running season. Constants are fit
// on games before 2026-01-15 (train) and judged on the rest (test).
// Who played a game stands in for the pregame injury report: the projection
// covers exactly the players who appeared.
//
// Judged population (param-free): players averaging 20+ minutes coming in
// (this season after 3+ games, else last season), the ones books hang props on.
//
//   npx tsx --tsconfig scripts/tsconfig.json scripts/fit-nba-props.mts
// Needs .cache/nba/2024 and 2025 (scripts/nba-history.mts).
//
//   ... scripts/fit-nba-props.mts --refit [--dry]
// Weekly refit (scripts/refit/common.mts): the latest season with 300+ games,
// the one before as the prior, the last 28 days held out. The search starts
// from the live settings, and the refit is stored only if its over/under log
// loss at the naive line beats live's by 2+ standard errors on those games.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import type { NbaGame } from "../src/lib/models/nba/box";
import { summarize, RunningSeason, type SeasonSummary } from "../src/lib/models/nba/history";
import { NBA_STATS, overUnder, pmf, projectGame, type NbaParams, type NbaStat, type PlayerInput, type TeamInput } from "../src/lib/models/nba/props";
import DEFAULTS from "../src/lib/models/nba/params.json";
import { REFIT, latestSeason, liveParams, paired, submit, windowStart } from "./refit/common.mjs";

const load = (s: number): NbaGame[] =>
  readdirSync(`.cache/nba/${s}`)
    .map((f) => JSON.parse(readFileSync(`.cache/nba/${s}/${f}`, "utf8")) as NbaGame)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

const count = (s: number) => (existsSync(`.cache/nba/${s}`) ? readdirSync(`.cache/nba/${s}`).length : 0);
const SEASON = REFIT ? latestSeason(Object.fromEntries([2023, 2024, 2025, 2026, 2027].map((s) => [s, count(s)])), 300) : 2025;
const prior: SeasonSummary = summarize(load(SEASON - 1));
const season = load(SEASON);
const SPLIT = REFIT ? windowStart(season.map((g) => g.date), 28) : "2026-01-15";
const LIVE = REFIT ? await liveParams("nba-props", DEFAULTS as unknown as NbaParams) : null;
if (REFIT) console.log(`refit: season ${SEASON}, prior ${SEASON - 1}, held out from ${SPLIT}`);

interface Case {
  date: string;
  game: string;
  players: PlayerInput[];
  teams: { [t: string]: TeamInput };
  spread: number | null;
  /** Rotation players (last few games) who didn't play: the absences a pregame report would show. */
  absent: PlayerInput[];
  actual: Map<string, { min: number } & { [s in NbaStat]: number }>;
  /** Judged players and their naive baselines (season average so far, else last season's). */
  judged: { id: string; naive: { [s in NbaStat]: number } }[];
}

// Build every game's pregame inputs once.
const run = new RunningSeason();
const cases: Case[] = [];
for (const g of season) {
  const players = g.players.map((l) => run.player(l.id, l.team, l.pos, prior));
  const teams = Object.fromEntries([g.home, g.away].map((t) => [t, run.team(t, prior)]));
  const judged: Case["judged"] = [];
  for (const pl of players) {
    const n = pl.games.length;
    const avg = (s: "min" | NbaStat) => (n >= 3 ? pl.games.reduce((a, x) => a + x[s], 0) / n : pl.prior && pl.prior.games ? pl.prior[s] / pl.prior.games : NaN);
    if (!(avg("min") >= 20)) continue;
    judged.push({ id: pl.id, naive: Object.fromEntries(NBA_STATS.map((s) => [s, avg(s)])) as { [s in NbaStat]: number } });
  }
  const played = new Set(g.players.map((l) => l.id));
  const absent = [g.home, g.away].flatMap((t) => run.rotation(t).filter((id) => !played.has(id)).map((id) => run.player(id, t, "", prior)));
  cases.push({ date: g.date, game: g.id, players, teams, spread: g.spread, absent, actual: new Map(g.players.map((l) => [l.id, l])), judged });
  run.add(g);
}
const train = cases.filter((c) => c.date < SPLIT);
const test = cases.filter((c) => c.date >= SPLIT);
console.log(`games: train ${train.length}, test ${test.length}; judged rows train ${train.reduce((a, c) => a + c.judged.length, 0)}, test ${test.reduce((a, c) => a + c.judged.length, 0)}`);

// A refit searches outward from the live settings (inputs this script doesn't fit, like kOpp, ride along).
let P: NbaParams = LIVE ? { ...LIVE } : {
  halfLife: 5,
  kMin: 4,
  minScale: 1,
  k: { pts: 200, reb: 200, ast: 200, threes: 200 },
  kPrior: 200,
  kPace: 10,
  blowout: 0,
  normalize: "none",
  pace: false,
  phiPts: 2,
  nb: { reb: 10, ast: 10, threes: 10 },
  calib: 1,
};

/** Every judged player's projection over a set of games. */
function project(cs: Case[], p: NbaParams) {
  const rows: { c: Case; id: string; naive: { [s in NbaStat]: number }; min: number; mean: { [s in NbaStat]: number } }[] = [];
  for (const c of cs) {
    const want = new Map(c.judged.map((j) => [j.id, j]));
    for (const pr of projectGame(c.players, c.teams, c.spread, prior.base, p, c.absent)) {
      const j = want.get(pr.id);
      if (j) rows.push({ c, id: pr.id, naive: j.naive, min: pr.min, mean: pr.mean });
    }
  }
  return rows;
}
const mse = (xs: [number, number][]) => xs.reduce((a, [p, y]) => a + (p - y) ** 2, 0) / xs.length;
const mae = (xs: [number, number][]) => xs.reduce((a, [p, y]) => a + Math.abs(p - y), 0) / xs.length;
const variance = (ys: number[]) => {
  const m = ys.reduce((a, y) => a + y, 0) / ys.length;
  return ys.reduce((a, y) => a + (y - m) ** 2, 0) / ys.length;
};
const statErr = (rows: ReturnType<typeof project>, s: NbaStat) => mse(rows.map((r) => [r.mean[s], r.c.actual.get(r.id)![s]]));
const trainVar = Object.fromEntries(NBA_STATS.map((s) => [s, variance(project(train, P).map((r) => r.c.actual.get(r.id)![s]))])) as { [s in NbaStat]: number };
const relErr = (rows: ReturnType<typeof project>) => NBA_STATS.reduce((a, s) => a + statErr(rows, s) / trainVar[s], 0);

const log: string[] = [];
const say = (s: string) => {
  console.log(s);
  log.push(s);
};

// 1. Minutes: half-life, prior weight, blowout cut, team normalization. Minutes MSE.
{
  // "scale" is scored but can't be chosen: here it knows how many players
  // appeared (13 in a blowout, 9 on a short bench), which no pregame report does.
  let best = { e: Infinity, p: P };
  const byMode: { [m: string]: number } = {};
  for (const halfLife of [2, 3, 5, 8, 12, 20])
    for (const kMin of [0, 1, 2, 4, 8, 16])
      for (const blowout of [0, 0.0025, 0.005, 0.0075, 0.01, 0.015])
        for (const normalize of ["none", "scale", "share", "sharePos"] as const) {
          const p = { ...P, halfLife, kMin, blowout, normalize };
          const e = mse(project(train, p).map((r) => [r.min, r.c.actual.get(r.id)!.min]));
          byMode[normalize] = Math.min(byMode[normalize] ?? Infinity, e);
          if (normalize !== "scale" && e < best.e) best = { e, p };
        }
  P = best.p;
  let bs = { e: Infinity, v: 1 };
  for (let v = 0.9; v <= 1.0501; v += 0.01) {
    const e = mse(project(train, { ...P, minScale: v }).map((r) => [r.min, r.c.actual.get(r.id)!.min]));
    if (e < bs.e) bs = { e, v: Math.round(v * 100) / 100 };
  }
  P = { ...P, minScale: bs.v };
  say(`minutes scale ${P.minScale} (train minutes RMSE ${Math.sqrt(bs.e).toFixed(3)})`);
  say(`minutes RMSE by mode (best of grid): ${Object.entries(byMode).map(([m, e]) => `${m} ${Math.sqrt(e).toFixed(3)}`).join(", ")}`);
  say(`minutes: halfLife ${P.halfLife}, kMin ${P.kMin}, blowout ${P.blowout}, normalize ${P.normalize}; train minutes RMSE ${Math.sqrt(best.e).toFixed(2)}`);
}

// 2. Rates: k per stat, with a shared prior-season shrink kPrior. Each stat's MSE.
{
  let best = { e: Infinity, p: P };
  for (const kPrior of [0, 50, 100, 200, 400, 800]) {
    let p: NbaParams = { ...P, kPrior };
    for (const s of NBA_STATS) {
      let bs = { e: Infinity, k: 0 };
      for (const k of [0, 25, 50, 100, 200, 400, 800, 1600, 3200]) {
        const e = statErr(project(train, { ...p, k: { ...p.k, [s]: k } }), s);
        if (e < bs.e) bs = { e, k };
      }
      p = { ...p, k: { ...p.k, [s]: bs.k } };
    }
    const e = relErr(project(train, p));
    if (e < best.e) best = { e, p };
  }
  P = best.p;
  say(`rates: kPrior ${P.kPrior}, k pts ${P.k.pts}, reb ${P.k.reb}, ast ${P.k.ast}, threes ${P.k.threes}`);
}

// 3. Pace on or off, and its shrink.
{
  let best = { e: relErr(project(train, { ...P, pace: false })), p: { ...P, pace: false } };
  for (const kPace of [0, 5, 10, 20, 40, 80]) {
    const p = { ...P, pace: true, kPace };
    const e = relErr(project(train, p));
    if (e < best.e) best = { e, p };
  }
  P = best.p;
  say(`pace: ${P.pace ? `on, kPace ${P.kPace}` : "off (did not lower the error)"}`);
}

// 4. Dispersion: maximum likelihood on train.
const trainRows = project(train, P);
{
  const ll = (s: NbaStat, p: NbaParams) => trainRows.reduce((a, r) => a + Math.log(Math.max(pmf(s, r.c.actual.get(r.id)![s], Math.max(r.mean[s], 0.01), p), 1e-12)), 0);
  let bp = { l: -Infinity, v: 0 };
  for (const v of [1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 8]) {
    const l = ll("pts", { ...P, phiPts: v });
    if (l > bp.l) bp = { l, v };
  }
  P = { ...P, phiPts: bp.v };
  for (const s of ["reb", "ast", "threes"] as const) {
    let b = { l: -Infinity, v: 0 };
    for (const v of [1, 2, 3, 5, 8, 12, 20, 40, 100, 1000]) {
      const l = ll(s, { ...P, nb: { ...P.nb, [s]: v } });
      if (l > b.l) b = { l, v };
    }
    P = { ...P, nb: { ...P.nb, [s]: b.v } };
  }
  say(`dispersion: points phi ${P.phiPts}; negative binomial r reb ${P.nb.reb}, ast ${P.nb.ast}, threes ${P.nb.threes}`);
}

// 5. Calibration slope: log loss of over/under at the naive line, train only.
{
  let b = { l: Infinity, a: 1 };
  for (let a = 0.4; a <= 1.3001; a += 0.05) {
    let l = 0;
    for (const r of trainRows)
      for (const s of NBA_STATS) {
        const line = Math.floor(r.naive[s]) + 0.5;
        const po = Math.min(Math.max(overUnder(s, Math.max(r.mean[s], 0.01), line, { ...P, calib: a }).over, 1e-6), 1 - 1e-6);
        l -= r.c.actual.get(r.id)![s] > line ? Math.log(po) : Math.log(1 - po);
      }
    if (l < b.l) b = { l, a: Math.round(a * 100) / 100 };
  }
  P = { ...P, calib: b.a };
  say(`calibration slope: ${P.calib}`);
}

if (REFIT && LIVE) {
  // Per player-game loss: over/under log loss at the naive line, summed over the four stats.
  const loss = (p: NbaParams) => {
    const m = new Map<string, number>();
    for (const r of project(test, p)) {
      let l = 0;
      for (const s of NBA_STATS) {
        const line = Math.floor(r.naive[s]) + 0.5;
        const po = Math.min(Math.max(overUnder(s, Math.max(r.mean[s], 0.01), line, p).over, 1e-6), 1 - 1e-6);
        l -= r.c.actual.get(r.id)![s] > line ? Math.log(po) : Math.log(1 - po);
      }
      m.set(`${r.c.game}|${r.id}`, l);
    }
    return m;
  };
  const a = loss(LIVE);
  const b = loss(P);
  const keys = [...a.keys()].filter((k) => b.has(k));
  await submit("nba-props", DEFAULTS as unknown as NbaParams, P, paired(keys.map((k) => a.get(k)!), keys.map((k) => b.get(k)!), `${test.length} games from ${SPLIT}`));
  process.exit(0);
}

// Test: accuracy against naive averages, and calibration at a naive line
// (the player's average so far, to the half point below or above).
const rows = project(test, P);
say(`\nTEST (games from ${SPLIT}, ${test.length} games, ${rows.length} player-games)`);
say(`minutes MAE ${mae(rows.map((r) => [r.min, r.c.actual.get(r.id)!.min])).toFixed(2)}`);
const cal: { p: number; y: number }[] = [];
for (const s of NBA_STATS) {
  const ours = mae(rows.map((r) => [r.mean[s], r.c.actual.get(r.id)![s]]));
  const naive = mae(rows.map((r) => [r.naive[s], r.c.actual.get(r.id)![s]]));
  let brier = 0;
  let brier50 = 0;
  let n = 0;
  for (const r of rows) {
    const line = Math.floor(r.naive[s]) + 0.5;
    const y = r.c.actual.get(r.id)![s] > line ? 1 : 0;
    const po = overUnder(s, Math.max(r.mean[s], 0.01), line, P).over;
    brier += (po - y) ** 2;
    brier50 += (0.5 - y) ** 2;
    n++;
    cal.push({ p: po, y });
  }
  say(`${s}: MAE ours ${ours.toFixed(2)} vs season average ${naive.toFixed(2)}; Brier at the average's line ${(brier / n).toFixed(4)} vs coin flip ${(brier50 / n).toFixed(4)}`);
}
for (const [lo, hi] of [[20, 28], [28, 33], [33, 48]]) {
  const t = rows.filter((r) => r.naive.pts >= 0 && (r.c.judged.find((j) => j.id === r.id) ? true : false)).filter((r) => {
    const m = r.c.players.find((x) => x.id === r.id)!;
    const avg = m.games.length >= 3 ? m.games.reduce((a, x) => a + x.min, 0) / m.games.length : m.prior ? m.prior.min / m.prior.games : 0;
    return avg >= lo && avg < hi;
  });
  const bias = (f: (r: (typeof rows)[number]) => number) => t.reduce((a, r) => a + f(r), 0) / t.length;
  say(`bias, players averaging ${lo}-${hi} min (n ${t.length}): minutes ${bias((r) => r.min - r.c.actual.get(r.id)!.min).toFixed(2)}, points ${bias((r) => r.mean.pts - r.c.actual.get(r.id)!.pts).toFixed(2)}`);
}
say("calibration (all four stats, P(over) bins: predicted vs happened, n)");
for (const [lo, hi] of [[0, 0.2], [0.2, 0.3], [0.3, 0.4], [0.4, 0.5], [0.5, 0.6], [0.6, 0.7], [0.7, 0.8], [0.8, 1.01]]) {
  const b = cal.filter((c) => c.p >= lo && c.p < hi);
  if (b.length) say(`  ${lo.toFixed(1)}-${Math.min(hi, 1).toFixed(1)}: ${(b.reduce((a, c) => a + c.p, 0) / b.length).toFixed(3)} vs ${(b.reduce((a, c) => a + c.y, 0) / b.length).toFixed(3)}, n ${b.length}`);
}

// Keep what this script does not fit (maxGap, and rateHalfLife / kOpp / k from scripts/fit-nba-props-inputs.mts): run that script after this one.
const keep = JSON.parse(readFileSync("src/lib/models/nba/params.json", "utf8")) as Partial<NbaParams>;
writeFileSync("src/lib/models/nba/params.json", JSON.stringify({ ...keep, ...P, ...(keep.maxGap !== undefined ? { maxGap: keep.maxGap } : {}), ...(keep.rateHalfLife ? { rateHalfLife: keep.rateHalfLife } : {}), ...(keep.kOpp ? { kOpp: keep.kOpp } : {}) }, null, 2) + "\n");
writeFileSync(".cache/fit-nba-props.txt", log.join("\n") + "\n");
console.log("\nwrote src/lib/models/nba/params.json");
