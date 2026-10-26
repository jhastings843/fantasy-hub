// Tests three candidate inputs for the NBA props model (src/lib/models/nba/props.ts)
// against today's params.json, walk forward, same games, split and judged
// players as scripts/fit-nba-props.mts:
//
//   1. Opponent defense by position: what tonight's opponent has allowed to the
//      player's position group (per minute or per possession-minute) over the
//      league's rate, shrunk toward 1 by kOpp pseudo-games. For rebounds also
//      the opponent's own misses per possession (defensive rebound chances).
//   2. Recent form: per-minute rates recency weighted (rateHalfLife), k refit.
//   3. Threes as attempts per minute x a heavily shrunk 3P%, instead of makes
//      per minute (needs .cache/nba-3pa from scripts/nba-3pa.mts).
//
// Every constant is fit on train (before 2026-01-15) by MSE of the mean; test
// reports MAE, MSE, and Brier and log loss of over/under at the naive line.
// Prints only; writes nothing.
//
//   npx tsx --tsconfig scripts/tsconfig.json scripts/fit-nba-props-inputs.mts
import { readdirSync, readFileSync } from "node:fs";
import type { NbaGame } from "../src/lib/models/nba/box";
import { summarize, RunningSeason, type SeasonSummary } from "../src/lib/models/nba/history";
import { NBA_STATS, oppFactor, overUnder, posOf, projectGame, projectRates, recencyWeights, type NbaParams, type NbaStat, type PlayerInput, type Pos, type TeamInput, type Allowed } from "../src/lib/models/nba/props";

const load = (s: number): NbaGame[] =>
  readdirSync(`.cache/nba/${s}`)
    .map((f) => JSON.parse(readFileSync(`.cache/nba/${s}/${f}`, "utf8")) as NbaGame)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
const tpa = (s: number, id: string): { [pid: string]: number } => JSON.parse(readFileSync(`.cache/nba-3pa/${s}/${id}.json`, "utf8"));

const priorGames = load(2024);
const prior: SeasonSummary = summarize(priorGames);
const season = load(2025);
const SPLIT = "2026-01-15";
// Baseline: params.json without the inputs this script added (2026-10-26), at the k it had then.
const BASE: NbaParams = (() => {
  const { rateHalfLife: _h, kOpp: _o, ...rest } = JSON.parse(readFileSync("src/lib/models/nba/params.json", "utf8")) as NbaParams;
  return { ...rest, k: { pts: 100, reb: 400, ast: 100, threes: 400 } };
})();
const POS: Pos[] = ["G", "F", "C"];

// Prior-season 3PA per player, and league 3PA / 3PM by position.
const prior3a: { [id: string]: number } = {};
const lg3 = Object.fromEntries(POS.map((p) => [p, { min: 0, a: 0, m: 0 }])) as { [p in Pos]: { min: number; a: number; m: number } };
for (const g of priorGames) {
  const a = tpa(2024, g.id);
  for (const l of g.players) {
    prior3a[l.id] = (prior3a[l.id] ?? 0) + (a[l.id] ?? 0);
    const q = lg3[posOf(l.pos)];
    q.min += l.min;
    q.a += a[l.id] ?? 0;
    q.m += l.threes;
  }
}

const emptyAllowed = (): Allowed => ({ games: 0, byPos: Object.fromEntries(POS.map((p) => [p, { n: 0, pts: 0, reb: 0, ast: 0, threes: 0 }])) as Allowed["byPos"] });
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

interface Case {
  date: string;
  players: PlayerInput[];
  teams: { [t: string]: TeamInput };
  spread: number | null;
  absent: PlayerInput[];
  actual: Map<string, { min: number } & { [s in NbaStat]: number }>;
  judged: { id: string; naive: { [s in NbaStat]: number } }[];
  /** Per team: the opponent's allowed tables (per minute, per possession-minute) and misses. */
  opp: { [t: string]: { min: Allowed; poss: Allowed; miss: { games: number; miss: number; poss: number } } };
  league: { min: Allowed; poss: Allowed; miss: { games: number; miss: number; poss: number } };
  threesA: Map<string, number[]>;
}

const run = new RunningSeason();
const allowedMin: { [t: string]: Allowed } = {};
const allowedPoss: { [t: string]: Allowed } = {};
const offMiss: { [t: string]: { games: number; miss: number; poss: number } } = {};
const lgMin = emptyAllowed();
const lgPoss = emptyAllowed();
const lgMiss = { games: 0, miss: 0, poss: 0 };
const a3: Map<string, number[]> = new Map();
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
  const other = (t: string) => (t === g.home ? g.away : g.home);
  const opp: Case["opp"] = {};
  for (const t of [g.home, g.away]) {
    const o = other(t);
    opp[t] = { min: clone(allowedMin[o] ?? emptyAllowed()), poss: clone(allowedPoss[o] ?? emptyAllowed()), miss: { ...(offMiss[o] ?? { games: 0, miss: 0, poss: 0 }) } };
  }
  const threesA = new Map(g.players.map((l) => [l.id, [...(a3.get(l.id) ?? [])]]));
  cases.push({ date: g.date, players, teams, spread: g.spread, absent, actual: new Map(g.players.map((l) => [l.id, l])), judged, opp, league: { min: clone(lgMin), poss: clone(lgPoss), miss: { ...lgMiss } }, threesA });

  // Fold the game in.
  run.add(g);
  const att = tpa(2025, g.id);
  for (const l of g.players) a3.set(l.id, [...(a3.get(l.id) ?? []), att[l.id] ?? 0]);
  const gp = ((g.poss[g.home] ?? 100) + (g.poss[g.away] ?? 100)) / 2;
  lgMin.games++;
  lgPoss.games++;
  for (const t of [g.home, g.away]) {
    const o = other(t);
    const am = (allowedMin[t] ??= emptyAllowed());
    const ap = (allowedPoss[t] ??= emptyAllowed());
    am.games++;
    ap.games++;
    for (const l of g.players.filter((x) => x.team === o)) {
      const p = posOf(l.pos);
      am.byPos[p].n += l.min;
      ap.byPos[p].n += (l.min / 48) * gp;
      lgMin.byPos[p].n += l.min;
      lgPoss.byPos[p].n += (l.min / 48) * gp;
      for (const s of NBA_STATS) {
        am.byPos[p][s] += l[s];
        ap.byPos[p][s] += l[s];
        lgMin.byPos[p][s] += l[s];
        lgPoss.byPos[p][s] += l[s];
      }
    }
    const mine = g.players.filter((x) => x.team === t);
    const miss = mine.reduce((a, x) => a + x.fga - x.fgm, 0);
    const om = (offMiss[t] ??= { games: 0, miss: 0, poss: 0 });
    om.games++;
    om.miss += miss;
    om.poss += g.poss[t] ?? gp;
    lgMiss.games++;
    lgMiss.miss += miss;
    lgMiss.poss += g.poss[t] ?? gp;
  }
}
const train = cases.filter((c) => c.date < SPLIT);
const test = cases.filter((c) => c.date >= SPLIT);

interface Row {
  c: Case;
  pl: PlayerInput;
  naive: { [s in NbaStat]: number };
  min: number;
  pf: number;
  mean: { [s in NbaStat]: number };
  y: { [s in NbaStat]: number };
}
function project(cs: Case[], p: NbaParams): Row[] {
  const rows: Row[] = [];
  for (const c of cs) {
    const want = new Map(c.judged.map((j) => [j.id, j]));
    const byId = new Map(c.players.map((x) => [x.id, x]));
    for (const pr of projectGame(c.players, c.teams, c.spread, prior.base, p, c.absent)) {
      const j = want.get(pr.id);
      if (!j) continue;
      const pl = byId.get(pr.id)!;
      const r = projectRates(pl, prior.base, p);
      const pf = pr.min > 0 && r.pts > 0 ? pr.mean.pts / (pr.min * r.pts) : 1;
      const a = c.actual.get(pr.id)!;
      rows.push({ c, pl, naive: j.naive, min: pr.min, pf, mean: { ...pr.mean }, y: { pts: a.pts, reb: a.reb, ast: a.ast, threes: a.threes } });
    }
  }
  return rows;
}

type MeanFn = (r: Row, s: NbaStat) => number;
const plain: MeanFn = (r, s) => r.mean[s];
const mseOf = (rows: Row[], s: NbaStat, f: MeanFn) => rows.reduce((a, r) => a + (f(r, s) - r.y[s]) ** 2, 0) / rows.length;
function metrics(rows: Row[], s: NbaStat, f: MeanFn) {
  let mae = 0, mse = 0, brier = 0, ll = 0;
  for (const r of rows) {
    const m = Math.max(f(r, s), 0.01);
    mae += Math.abs(m - r.y[s]);
    mse += (m - r.y[s]) ** 2;
    const line = Math.floor(r.naive[s]) + 0.5;
    const y = r.y[s] > line ? 1 : 0;
    const po = Math.min(Math.max(overUnder(s, m, line, BASE).over, 1e-6), 1 - 1e-6);
    brier += (po - y) ** 2;
    ll -= y ? Math.log(po) : Math.log(1 - po);
  }
  const n = rows.length;
  return { mae: mae / n, mse: mse / n, brier: brier / n, ll: ll / n };
}
const fmt = (m: ReturnType<typeof metrics>) => `MAE ${m.mae.toFixed(4)}  MSE ${m.mse.toFixed(3)}  Brier ${m.brier.toFixed(4)}  logloss ${m.ll.toFixed(4)}`;

const trainRows = project(train, BASE);
const testRows = project(test, BASE);
console.log(`games: train ${train.length}, test ${test.length}; judged rows train ${trainRows.length}, test ${testRows.length}`);
console.log(`\nBASELINE (params.json), test:`);
for (const s of NBA_STATS) console.log(`  ${s}: ${fmt(metrics(testRows, s, plain))}`);

// 1. Opponent defense by position.
const K_OPP = [1, 2, 5, 10, 20, 40, 80, 160, 320];
const posOfRow = (r: Row) => r.pl.prior?.pos ?? r.pl.pos;
const team = (r: Row) => r.pl.team;
const oppMean = (kind: "min" | "poss", k: number): MeanFn => (r, s) => r.mean[s] * oppFactor(r.c.opp[team(r)][kind], r.c.league[kind], posOfRow(r), s, k);
const missMean = (k: number): MeanFn => (r, s) => {
  const o = r.c.opp[team(r)].miss;
  const L = r.c.league.miss;
  if (s !== "reb" || !o.games || !L.poss || !o.poss) return r.mean[s];
  const ratio = o.miss / o.poss / (L.miss / L.poss);
  return r.mean[s] * ((o.games * ratio + k) / (o.games + k));
};
console.log(`\n1. OPPONENT DEFENSE BY POSITION (train MSE; off = ${NBA_STATS.map((s) => `${s} ${mseOf(trainRows, s, plain).toFixed(3)}`).join(", ")})`);
const oppPick: { [s in NbaStat]?: { kind: string; k: number; f: MeanFn } } = {};
for (const s of NBA_STATS) {
  let best = { e: mseOf(trainRows, s, plain), kind: "off", k: Infinity, f: plain };
  const line: string[] = [];
  for (const kind of ["min", "poss"] as const)
    for (const k of K_OPP) {
      const f = oppMean(kind, k);
      const e = mseOf(trainRows, s, f);
      line.push(`${kind}/${k} ${e.toFixed(3)}`);
      if (e < best.e) best = { e, kind, k, f };
    }
  if (s === "reb")
    for (const k of K_OPP) {
      const f = missMean(k);
      const e = mseOf(trainRows, s, f);
      line.push(`misses/${k} ${e.toFixed(3)}`);
      if (e < best.e) best = { e, kind: "misses", k, f };
    }
  console.log(`  ${s}: ${line.join(", ")}`);
  console.log(`  ${s} best: ${best.kind} k ${best.k}`);
  if (best.kind !== "off") oppPick[s] = best;
}
console.log(`  test with the train pick:`);
for (const s of NBA_STATS) if (oppPick[s]) console.log(`  ${s} (${oppPick[s]!.kind}, k ${oppPick[s]!.k}): ${fmt(metrics(testRows, s, oppPick[s]!.f))}`);

// 2. Recent form: rateHalfLife x k per stat (stats are independent in projectRates).
console.log(`\n2. RECENT FORM (train MSE by half-life, k refit)`);
const HL = [0, 5, 10, 15, 20, 30, 50];
const KS = [25, 50, 100, 200, 400, 800, 1600];
const formBest = Object.fromEntries(NBA_STATS.map((s) => [s, { e: Infinity, hl: 0, k: BASE.k[s] }])) as { [s in NbaStat]: { e: number; hl: number; k: number } };
const byHl: { [s: string]: string[] } = {};
for (const hl of HL) {
  const hlBest = Object.fromEntries(NBA_STATS.map((s) => [s, Infinity])) as { [s in NbaStat]: number };
  for (const k of KS) {
    const p: NbaParams = { ...BASE, k: { pts: k, reb: k, ast: k, threes: k }, rateHalfLife: hl ? { pts: hl, reb: hl, ast: hl, threes: hl } : undefined };
    const rows = project(train, p);
    for (const s of NBA_STATS) {
      const e = mseOf(rows, s, plain);
      hlBest[s] = Math.min(hlBest[s], e);
      if (e < formBest[s].e) formBest[s] = { e, hl, k };
    }
  }
  for (const s of NBA_STATS) (byHl[s] ??= []).push(`${hl || "off"} ${hlBest[s].toFixed(3)}`);
}
for (const s of NBA_STATS) console.log(`  ${s}: ${byHl[s].join(", ")}; best hl ${formBest[s].hl || "off"} k ${formBest[s].k}`);
const formP: NbaParams = {
  ...BASE,
  k: Object.fromEntries(NBA_STATS.map((s) => [s, formBest[s].hl ? formBest[s].k : BASE.k[s]])) as NbaParams["k"],
  rateHalfLife: Object.fromEntries(NBA_STATS.filter((s) => formBest[s].hl).map((s) => [s, formBest[s].hl])),
};
const formTest = project(test, formP);
console.log(`  test with the train pick:`);
for (const s of NBA_STATS) console.log(`  ${s}: ${fmt(metrics(formTest, s, plain))}`);

// 3. Threes as attempts x make rate.
console.log(`\n3. THREES AS ATTEMPTS x MAKE RATE`);
const pos3 = (p: Pos) => ({ aRate: lg3[p].a / lg3[p].min, pct: lg3[p].m / lg3[p].a });
const threesSplit = (k3a: number, kPct: number, kPctPrior: number, hl?: number): MeanFn => (r) => {
  const pl = r.pl;
  const pp = pl.prior?.pos ?? pl.pos;
  const L = pos3(pp);
  const pa = pl.prior ? prior3a[pl.id] ?? 0 : 0;
  const priorA = pl.prior && pl.prior.min > 0 ? (pa + BASE.kPrior * L.aRate) / (pl.prior.min + BASE.kPrior) : L.aRate;
  const priorPct = pl.prior ? (pl.prior.threes + kPctPrior * L.pct) / (pa + kPctPrior) : L.pct;
  const att = r.c.threesA.get(pl.id) ?? [];
  const w = recencyWeights(pl.games.length, hl);
  const n = pl.games.reduce((a, x, i) => a + w[i] * x.min, 0);
  const ca = att.reduce((a, x, i) => a + w[i] * x, 0);
  const cm = pl.games.reduce((a, x) => a + x.threes, 0);
  const caAll = att.reduce((a, x) => a + x, 0);
  const aRate = (ca + k3a * priorA) / (n + k3a);
  const pct = (cm + kPct * priorPct) / (caAll + kPct);
  return r.min * aRate * pct * r.pf;
};
let b3 = { e: mseOf(trainRows, "threes", plain), k3a: 0, kPct: 0, kPctPrior: 0, f: plain as MeanFn };
console.log(`  makes per minute (today) train MSE ${b3.e.toFixed(4)}`);
for (const k3a of [25, 50, 100, 200, 400, 800])
  for (const kPct of [50, 100, 200, 400, 800, 1600])
    for (const kPctPrior of [50, 100, 200, 400, 800]) {
      const f = threesSplit(k3a, kPct, kPctPrior);
      const e = mseOf(trainRows, "threes", f);
      if (e < b3.e) b3 = { e, k3a, kPct, kPctPrior, f };
    }
console.log(`  best split: k3a ${b3.k3a} min, kPct ${b3.kPct} attempts, kPctPrior ${b3.kPctPrior} attempts; train MSE ${b3.e.toFixed(4)}`);
if (b3.k3a) console.log(`  test: ${fmt(metrics(testRows, "threes", b3.f))}`);

// Everything picked, together, on test.
console.log(`\nCOMBINED (form params + opponent factor), test:`);
const combo = project(test, formP);
const comboTrain = project(train, formP);
for (const s of NBA_STATS) {
  const pick = oppPick[s];
  if (!pick) {
    console.log(`  ${s}: ${fmt(metrics(combo, s, plain))}`);
    continue;
  }
  // Refit k for the opponent factor on top of form.
  let bk = { e: Infinity, k: pick.k };
  for (const k of K_OPP) {
    const f = pick.kind === "misses" ? missMean(k) : oppMean(pick.kind as "min" | "poss", k);
    const e = mseOf(comboTrain, s, f);
    if (e < bk.e) bk = { e, k };
  }
  const f = pick.kind === "misses" ? missMean(bk.k) : oppMean(pick.kind as "min" | "poss", bk.k);
  console.log(`  ${s} (opp ${pick.kind} k ${bk.k}): ${fmt(metrics(combo, s, f))}`);
}

// Checks: how much of "recent form" is just refitting k, and the threes split on top of everything.
console.log(`\nCHECK: k refit alone (no half-life), test:`);
{
  const kOff = Object.fromEntries(NBA_STATS.map((s) => [s, BASE.k[s]])) as NbaParams["k"];
  for (const s of NBA_STATS) {
    let b = { e: Infinity, k: 0 };
    for (const k of KS) {
      const e = mseOf(project(train, { ...BASE, k: { ...BASE.k, [s]: k } }), s, plain);
      if (e < b.e) b = { e, k };
    }
    kOff[s] = b.k;
  }
  const rows = project(test, { ...BASE, k: kOff });
  for (const s of NBA_STATS) console.log(`  ${s} (k ${kOff[s]}): ${fmt(metrics(rows, s, plain))}`);
}
console.log(`\nCHECK: threes split with form and opponent factor, test:`);
{
  const hl = formP.rateHalfLife?.threes;
  const kOpp = 80;
  let b = { e: Infinity, k3a: 0, kPct: 0, kPctPrior: 0 };
  for (const k3a of [100, 200, 400, 800])
    for (const kPct of [100, 200, 400, 800])
      for (const kPctPrior of [50, 100, 200, 400]) {
        const f = threesSplit(k3a, kPct, kPctPrior, hl);
        const e = mseOf(comboTrain, "threes", (r, s) => f(r, s) * oppFactor(r.c.opp[team(r)].min, r.c.league.min, posOfRow(r), "threes", kOpp));
        if (e < b.e) b = { e, k3a, kPct, kPctPrior };
      }
  const f = threesSplit(b.k3a, b.kPct, b.kPctPrior, hl);
  console.log(`  split k3a ${b.k3a}, kPct ${b.kPct}, kPctPrior ${b.kPctPrior}, train MSE ${b.e.toFixed(4)} vs makes ${mseOf(comboTrain, "threes", oppMean("min", kOpp)).toFixed(4)}`);
  console.log(`  threes: ${fmt(metrics(combo, "threes", (r, s) => f(r, s) * oppFactor(r.c.opp[team(r)].min, r.c.league.min, posOfRow(r), "threes", kOpp)))}`);
}

// End to end: params.json as saved, through projectGame with each team's allowed table.
{
  const SAVED: NbaParams = JSON.parse(readFileSync("src/lib/models/nba/params.json", "utf8"));
  if (SAVED.kOpp) {
    const withAllowed = (cs: Case[]): Case[] =>
      cs.map((c) => {
        const ts = Object.keys(c.teams);
        return { ...c, teams: Object.fromEntries(ts.map((t) => [t, { ...c.teams[t], allowed: c.opp[ts.find((x) => x !== t)!].min }])) };
      });
    const rows: Row[] = [];
    for (const c of withAllowed(test)) {
      const want = new Map(c.judged.map((j) => [j.id, j]));
      for (const pr of projectGame(c.players, c.teams, c.spread, prior.base, SAVED, c.absent, c.league.min)) {
        const j = want.get(pr.id);
        if (!j) continue;
        const a = c.actual.get(pr.id)!;
        rows.push({ c, pl: c.players.find((x) => x.id === pr.id)!, naive: j.naive, min: pr.min, pf: 1, mean: pr.mean, y: { pts: a.pts, reb: a.reb, ast: a.ast, threes: a.threes } });
      }
    }
    console.log(`\nSAVED params.json through projectGame, test:`);
    for (const s of NBA_STATS) console.log(`  ${s}: ${fmt(metrics(rows, s, plain))}`);
  }
}
