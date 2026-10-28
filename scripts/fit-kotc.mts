// Walk-forward fit and test of King of the Court (src/lib/models/nba/kotc.ts).
//
// Season 2025-26, night by night: every game of a night is projected by our
// props model from games before that NIGHT only (the night's games are added
// after all of them are projected), with 2024-25 as the prior. Who played
// stands in for the injury report, as in fit-nba-props.mts.
// Train: nights before 2026-01-15. Test: the rest, untouched by the fit.
//
// 1. Box-score noise: phi and sdMin by maximum likelihood on each player's
//    PRA around his projection, Var = phi x mean + (sdMin x mean)^2.
// 2. Shared shocks (game pace, blowouts, overtime): grid on the train
//    nights' log loss of the actual king.
// Then the test nights: log loss against two baselines (independent players,
// and a softmax on projected PRA fit on train), how often the favorite won,
// and calibration of the chances.
//
//   npx tsx --tsconfig scripts/tsconfig.json scripts/fit-kotc.mts
//   ... scripts/fit-kotc.mts --refit [--dry]   weekly refit (scripts/refit/common.mts):
//   latest season with 300+ games, test = nights in its last 28 days, props
//   projections from the live nba-props settings; refits the noise and shared
//   shocks on the rest (crowd fit untouched) and stores them only if the
//   per-night king log loss beats the live settings by 2+ SE.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import DEFAULTS from "../src/lib/models/nba/kotc-params.json";
import { REFIT, latestSeason, liveParams, paired, submit, windowStart } from "./refit/common.mjs";
import type { NbaGame } from "../src/lib/models/nba/box";
import { summarize, RunningSeason } from "../src/lib/models/nba/history";
import { projectGame, type NbaParams } from "../src/lib/models/nba/props";
import { etDate } from "../src/lib/props/parse";
import { kingLogLoss, kingsOf, simulateSlate, type KotcGame, type KotcParams, type KotcPlayer } from "../src/lib/models/nba/kotc";

const NP_JSON = JSON.parse(readFileSync("src/lib/models/nba/params.json", "utf8")) as NbaParams;
const NP = REFIT ? await liveParams("nba-props", NP_JSON) : NP_JSON;
const load = (s: number): NbaGame[] =>
  readdirSync(`.cache/nba/${s}`)
    .map((f) => JSON.parse(readFileSync(`.cache/nba/${s}/${f}`, "utf8")) as NbaGame)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

const SEASON = REFIT ? latestSeason(Object.fromEntries(readdirSync(".cache/nba").map((d) => [Number(d), readdirSync(`.cache/nba/${d}`).length])), 300) : 2025;
const prior = summarize(load(SEASON - 1));
const season = load(SEASON);
const SPLIT = REFIT ? windowStart(season.map((g) => etDate(new Date(g.date))), 28) : "2026-01-15";
const MIN_MIN = 8;

interface Night {
  date: string;
  games: KotcGame[];
  players: KotcPlayer[];
  actual: Map<string, number>;
}

const run = new RunningSeason();
const nights: Night[] = [];
const byDate = new Map<string, NbaGame[]>();
// Cached dates are tip times (UTC); a night is the Eastern date.
const nightOf = (g: NbaGame) => etDate(new Date(g.date));
const names = new Map<string, string>();
for (const g of season) {
  byDate.set(nightOf(g), [...(byDate.get(nightOf(g)) ?? []), g]);
  for (const l of g.players) names.set(l.id, l.name);
}
for (const [date, gs] of byDate) {
  const night: Night = { date, games: [], players: [], actual: new Map() };
  for (const g of gs) {
    const players = g.players.map((l) => run.player(l.id, l.team, l.pos, prior));
    const teams = Object.fromEntries([g.home, g.away].map((t) => [t, run.team(t, prior)]));
    const played = new Set(g.players.map((l) => l.id));
    const absent = [g.home, g.away].flatMap((t) => run.rotation(t).filter((id) => !played.has(id)).map((id) => run.player(id, t, "", prior)));
    const informed = new Set(players.filter((x) => x.games.length >= 2 || (x.prior?.games ?? 0) >= 10).map((x) => x.id));
    const starters = new Set(g.players.filter((l) => l.starter).map((l) => l.id));
    night.games.push({ id: g.id, home: g.home, away: g.away, homeSpread: g.spread });
    for (const pr of projectGame(players, teams, g.spread, prior.base, NP, absent)) {
      if (!informed.has(pr.id) || pr.min < MIN_MIN) continue;
      night.players.push({ id: pr.id, name: names.get(pr.id) ?? pr.id, team: pr.team, game: g.id, min: pr.min, pra: pr.mean.pts + pr.mean.reb + pr.mean.ast, starter: starters.has(pr.id) });
    }
    for (const l of g.players) night.actual.set(l.id, l.pts + l.reb + l.ast);
  }
  // Nights of 3+ games only: the promo runs on full slates.
  if (night.games.length >= 3) nights.push(night);
  for (const g of gs) run.add(g);
}
const train = nights.filter((n) => n.date < SPLIT);
const test = nights.filter((n) => n.date >= SPLIT);
const log: string[] = [];
const say = (s: string) => {
  console.log(s);
  log.push(s);
};
say(`nights: train ${train.length}, test ${test.length}`);

// 1. Noise by maximum likelihood (normal on PRA around the projection).
const resid = train.flatMap((n) => n.players.map((x) => ({ mu: x.pra, y: n.actual.get(x.id) ?? 0 })));
let best1 = { l: -Infinity, phi: 0, sdMin: 0 };
for (const phi of [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5])
  for (const sdMin of [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3]) {
    let l = 0;
    for (const r of resid) {
      const v = phi * Math.max(r.mu, 0.5) + (sdMin * r.mu) ** 2;
      l += -0.5 * Math.log(2 * Math.PI * v) - (r.y - r.mu) ** 2 / (2 * v);
    }
    if (l > best1.l) best1 = { l, phi, sdMin };
  }
say(`noise: phi ${best1.phi}, sdMin ${best1.sdMin} (ML on ${resid.length} train player-games)`);

let P: KotcParams = { sims: 3000, sdMargin: 12, blowAt: 15, blow: 0.012, blowMax: 0.25, otBand: 1, ot: 0.09, sdGame: 0.05, sdMin: best1.sdMin, phi: best1.phi };

const score = (ns: Night[], p: KotcParams) => {
  let ll = 0;
  for (const n of ns) {
    const b = simulateSlate(n.games, n.players, p, 7);
    const k = kingsOf(n.players.map((x) => ({ id: x.id, pra: n.actual.get(x.id) ?? 0 })));
    ll += kingLogLoss(b.rows, k.ids);
  }
  return ll / ns.length;
};

// 2. Shared shocks. The ML noise above already holds the shared part on
// average, so the grid also lets the per-player noise shrink as shared noise grows.
{
  let best = { l: Infinity, p: P };
  for (const sdGame of [0, 0.04, 0.08])
    for (const blowAt of [12, 16, 99])
      for (const ot of [0, 0.09])
        for (const shrink of [1, 0.85]) {
          const p = { ...P, sdGame, blowAt, ot, otBand: ot ? 1 : 0, phi: best1.phi * shrink, sdMin: best1.sdMin * shrink };
          const l = score(train, p);
          if (l < best.l) best = { l, p };
        }
  P = best.p;
  say(`shared: sdGame ${P.sdGame}, blowAt ${P.blowAt}, ot ${P.ot}, phi ${P.phi}, sdMin ${P.sdMin}; train king log loss ${best.l.toFixed(3)}`);
}

if (REFIT) {
  const live = await liveParams("nba-kotc", DEFAULTS as KotcParams);
  const perNight = (p: KotcParams) =>
    test.map((n) => {
      const b = simulateSlate(n.games, n.players, { ...p, sims: 5000 }, 7);
      return kingLogLoss(b.rows, kingsOf(n.players.map((x) => ({ id: x.id, pra: n.actual.get(x.id) ?? 0 }))).ids);
    });
  const refit: KotcParams = { ...live, ...P, sims: live.sims };
  delete (refit as Partial<KotcParams>).crowd;
  await submit("nba-kotc", DEFAULTS as KotcParams, refit, paired(perNight(live), perNight({ ...live, ...refit }), `king log loss per night, ${SEASON} from ${SPLIT}`));
  process.exit(0);
}

// Baselines on train: independent players (no shared shocks), and softmax on projected PRA.
const indep: KotcParams = { ...P, sdGame: 0, blowAt: 99, ot: 0, otBand: 0 };
let soft = { l: Infinity, t: 1 };
const softLL = (ns: Night[], t: number) =>
  ns.reduce((a, n) => {
    const z = n.players.map((x) => Math.exp(x.pra / t));
    const s = z.reduce((x, y) => x + y, 0);
    const k = kingsOf(n.players.map((x) => ({ id: x.id, pra: n.actual.get(x.id) ?? 0 })));
    const got = n.players.reduce((acc, x, i) => acc + (k.ids.includes(x.id) ? z[i] / s : 0), 0);
    return a - Math.log(Math.max(1e-4, got));
  }, 0) / ns.length;
for (const t of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8]) {
  const l = softLL(train, t);
  if (l < soft.l) soft = { l, t };
}

// Test.
P = { ...P, sims: 20000 };
say(`\nTEST (nights from ${SPLIT}, ${test.length} nights)`);
const uniform = test.reduce((a, n) => a + Math.log(n.players.length), 0) / test.length;
say(`king log loss: ours ${score(test, { ...P, sims: 5000 }).toFixed(3)}, independent players ${score(test, { ...indep, sims: 5000 }).toFixed(3)}, softmax on projected PRA (t ${soft.t}) ${softLL(test, soft.t).toFixed(3)}, everyone equal ${uniform.toFixed(3)}`);
const cal: { p: number; y: number }[] = [];
let favWon = 0;
let favP = 0;
let kingRank = 0;
const winPra: number[] = [];
const medPred: number[] = [];
for (const n of test) {
  const b = simulateSlate(n.games, n.players, { ...P, sims: 5000 }, 7);
  const k = kingsOf(n.players.map((x) => ({ id: x.id, pra: n.actual.get(x.id) ?? 0 })));
  favP += b.rows[0].p;
  if (k.ids.includes(b.rows[0].id)) favWon += 1 / k.ids.length;
  kingRank += Math.min(...k.ids.map((id) => b.rows.findIndex((r) => r.id === id) + 1).filter((x) => x > 0), b.rows.length);
  winPra.push(k.pra);
  medPred.push(b.winning.p50);
  for (const r of b.rows) cal.push({ p: r.p, y: k.ids.includes(r.id) ? 1 / k.ids.length : 0 });
}
say(`our favorite: won ${favWon.toFixed(1)} of ${test.length} nights (${((100 * favWon) / test.length).toFixed(1)}%), we gave him ${((100 * favP) / test.length).toFixed(1)}% on average`);
say(`the actual king's rank on our board: average ${(kingRank / test.length).toFixed(1)}`);
say(`winning PRA: actual average ${(winPra.reduce((a, x) => a + x, 0) / winPra.length).toFixed(1)}, our median average ${(medPred.reduce((a, x) => a + x, 0) / medPred.length).toFixed(1)}`);
say("calibration (chance to be king, bins: predicted vs happened, n)");
for (const [lo, hi] of [[0, 0.01], [0.01, 0.03], [0.03, 0.07], [0.07, 0.15], [0.15, 0.3], [0.3, 1.01]]) {
  const b = cal.filter((c) => c.p >= lo && c.p < hi);
  if (b.length) say(`  ${(lo * 100).toFixed(0)}-${(Math.min(hi, 1) * 100).toFixed(0)}%: ${((100 * b.reduce((a, c) => a + c.p, 0)) / b.length).toFixed(2)}% vs ${((100 * b.reduce((a, c) => a + c.y, 0)) / b.length).toFixed(2)}%, n ${b.length}`);
}

// 3. The crowd. DraftKings posts what each winning backer got; pool / payout
// = how many people tagged the king. Against the chance we gave him that
// night: log(backers) = a + b log(chance), least squares. Standard nights
// without a stated pool are taken as $1M (DK's standard pool; payout x
// backers comes to $0.98M to $1.03M on rows that have both). Three Kings
// nights are left out (three pools, top-3 rules). This one is descriptive:
// it uses every matched night, test nights included, and nothing above or on
// the page claims it was tested out of sample.
{
  const csv = readFileSync("data/kotc-payouts.csv", "utf8").trim().split("\n").slice(1).map((l) => l.split(","));
  const pts: { date: string; who: string; p: number; backers: number }[] = [];
  const all = new Map(nights.map((n) => [n.date, n]));
  for (const [date, pool, variant, winners, , payout] of csv) {
    if (!payout || /three/i.test(variant)) continue;
    const n = all.get(date);
    if (!n) continue;
    const b = simulateSlate(n.games, n.players, { ...P, sims: 20000 }, 7);
    const who = winners.split(";").map((x) => x.trim());
    const p = b.rows.filter((r) => who.includes(r.name)).reduce((a, r) => a + r.p, 0);
    if (p <= 0) continue;
    pts.push({ date, who: winners, p, backers: (Number(pool) || 1_000_000) / Number(payout) });
  }
  const xs = pts.map((x) => Math.log(x.p));
  const ys = pts.map((x) => Math.log(x.backers));
  const mx = xs.reduce((a, x) => a + x, 0) / xs.length;
  const my = ys.reduce((a, y) => a + y, 0) / ys.length;
  const b = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  const a = my - b * mx;
  const r2 = 1 - ys.reduce((acc, y, i) => acc + (y - (a + b * xs[i])) ** 2, 0) / ys.reduce((acc, y) => acc + (y - my) ** 2, 0);
  say(`\ncrowd: ${pts.length} paid nights matched; backers per pool = ${Math.exp(a).toFixed(0)} x chance^${b.toFixed(2)} (R2 ${r2.toFixed(2)})`);
  for (const x of pts.sort((m, n) => m.p - n.p)) say(`  ${x.date} ${x.who}: we gave ${(100 * x.p).toFixed(1)}%, ${Math.round(x.backers)} backers`);
  P = { ...P, crowd: { a: Math.round(a * 1000) / 1000, b: Math.round(b * 1000) / 1000, n: pts.length, r2: Math.round(r2 * 100) / 100 } } as KotcParams;
}

writeFileSync("src/lib/models/nba/kotc-params.json", JSON.stringify(P, null, 2) + "\n");
writeFileSync(".cache/fit-kotc.txt", log.join("\n") + "\n");
console.log("\nwrote src/lib/models/nba/kotc-params.json");
