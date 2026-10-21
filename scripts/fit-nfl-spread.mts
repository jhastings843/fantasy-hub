// Walk-forward fit and test of our NFL spread model (src/lib/models/nfl/spread.ts).
//
// 1. Rating constants on 1999-2009 only: the results rating by margin error,
//    the market rating by how well it predicts the next line. Then frozen.
// 2. Residual weights: for each season S from 2010, ridge on every season
//    2002..S-1 (ratings warmed up), applied to S. Lambda picked on 2010-2014,
//    then frozen; 2015 on is the test.
// 3. Against the line it was graded on (nflverse's closing spread_line):
//    side = sign of the predicted residual, bet when it clears a threshold.
//    Win rate, units at -110, z against the 52.38% break-even. Also each
//    feature alone, so a weak model can't hide behind a strong one.
//
//   npx tsx --tsconfig scripts/tsconfig.json scripts/fit-nfl-spread.mts
// Needs .cache/nfl/games.csv (nflverse nfldata games.csv).
import { readFileSync, writeFileSync } from "node:fs";
import { parseCsv } from "../src/lib/models/nfl/data";
import { FEATURES, Ratings, fitRidge, rateAll, residual, toSpreadGame, type Feature, type RatingParams, type Rated, type SpreadGame } from "../src/lib/models/nfl/spread";

const [head, ...body] = parseCsv(readFileSync(".cache/nfl/games.csv", "utf8"));
const games = body.map((r) => toSpreadGame(Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])))).filter((g): g is SpreadGame => g !== null);
const log: string[] = [];
const say = (s: string) => {
  console.log(s);
  log.push(s);
};
say(`games ${games.length}, with a line and a score ${games.filter((g) => g.line !== null && g.homeScore !== null).length}`);

// 1. Rating constants, 1999-2009.
let RP: RatingParams = { hfa: 2.5, kPerf: 0.1, cap: 21, carryPerf: 0.67, hfaMkt: 2.5, kMkt: 0.3, carryMkt: 0.67 };
const early = games.filter((g) => g.season <= 2009);
function errs(p: RatingParams) {
  const r = new Ratings(p);
  let perf = 0;
  let mkt = 0;
  let n = 0;
  for (const g of [...early].sort((a, b) => a.gameday.localeCompare(b.gameday))) {
    if (g.line !== null && g.homeScore !== null && g.season > 1999) {
      const x = r.features(g, g.line);
      // gap = perf - line, so perf prediction = gap + line; move = line - mkt.
      perf += (x.gap + g.line - (g.homeScore - g.awayScore!)) ** 2;
      mkt += x.move ** 2;
      n++;
    }
    r.add(g);
  }
  return { perf: Math.sqrt(perf / n), mkt: Math.sqrt(mkt / n) };
}
{
  let b = { e: Infinity, p: RP };
  for (const hfa of [1.5, 2, 2.5, 3]) for (const kPerf of [0.04, 0.06, 0.08, 0.1, 0.14]) for (const cap of [14, 21, 28]) for (const carryPerf of [0.5, 0.67, 0.8]) {
    const p = { ...RP, hfa, kPerf, cap, carryPerf };
    const e = errs(p).perf;
    if (e < b.e) b = { e, p };
  }
  RP = b.p;
  say(`results rating: hfa ${RP.hfa}, k ${RP.kPerf}, cap ${RP.cap}, carry ${RP.carryPerf}; margin RMSE ${b.e.toFixed(2)}`);
  let m = { e: Infinity, p: RP };
  for (const hfaMkt of [1.5, 2, 2.5, 3]) for (const kMkt of [0.1, 0.2, 0.3, 0.4, 0.6]) for (const carryMkt of [0.5, 0.67, 0.8, 0.9]) {
    const p = { ...RP, hfaMkt, kMkt, carryMkt };
    const e = errs(p).mkt;
    if (e < m.e) m = { e, p };
  }
  RP = m.p;
  say(`market rating: hfa ${RP.hfaMkt}, k ${RP.kMkt}, carry ${RP.carryMkt}; next-line RMSE ${m.e.toFixed(2)}`);
}

const rated = rateAll(games, RP).filter((r) => r.game.season >= 2002);
const y = (r: Rated) => r.game.homeScore! - r.game.awayScore! - r.game.line!;

type Pred = { r: Rated; pred: number };
function walk(from: number, to: number, lambda: number, only?: Feature[]): Pred[] {
  const out: Pred[] = [];
  for (let s = from; s <= to; s++) {
    const train = rated.filter((r) => r.game.season < s).map((r) => ({ x: only ? zero(r.x, only) : r.x, y: y(r) }));
    const fit = fitRidge(train, lambda);
    for (const r of rated.filter((x) => x.game.season === s)) out.push({ r, pred: residual(only ? zero(r.x, only) : r.x, fit) });
  }
  return out;
}
const zero = (x: Rated["x"], keep: Feature[]) => Object.fromEntries(FEATURES.map((f) => [f, keep.includes(f) ? x[f] : 0])) as Rated["x"];

function ats(ps: Pred[], t: number) {
  let w = 0;
  let l = 0;
  let p = 0;
  for (const { r, pred } of ps) {
    if (Math.abs(pred) < t || pred === 0) continue;
    const res = y(r);
    if (res === 0) p++;
    else if (Math.sign(res) === Math.sign(pred)) w++;
    else l++;
  }
  const n = w + l;
  const units = w * (100 / 110) - l;
  const z = n ? (w / n - 0.5238) / Math.sqrt((0.5238 * 0.4762) / n) : 0;
  return { w, l, p, pct: n ? w / n : 0, units, z };
}
const fmt = (a: ReturnType<typeof ats>) => `${a.w}-${a.l}-${a.p} ${(100 * a.pct).toFixed(1)}% ${a.units >= 0 ? "+" : ""}${a.units.toFixed(1)}u z ${a.z.toFixed(2)}`;

// 2. Lambda on 2010-2014 (mean squared residual error).
let lambda = 100;
{
  let b = Infinity;
  for (const l of [1, 10, 100, 1000, 10000, 100000]) {
    const ps = walk(2010, 2014, l);
    const e = ps.reduce((a, { r, pred }) => a + (y(r) - pred) ** 2, 0) / ps.length;
    say(`  lambda ${l}: validation MSE ${e.toFixed(3)}`);
    if (e < b) {
      b = e;
      lambda = l;
    }
  }
  say(`lambda ${lambda}`);
}

// 3. Test 2015 on.
const LAST = Math.max(...rated.map((r) => r.game.season));
const test = walk(2015, LAST, lambda);
const base = test.reduce((a, { r }) => a + y(r) ** 2, 0) / test.length;
const ours = test.reduce((a, { r, pred }) => a + (y(r) - pred) ** 2, 0) / test.length;
say(`\nTEST 2015-${LAST}: ${test.length} games. Margin MSE vs the line: line alone ${base.toFixed(2)}, line + ours ${ours.toFixed(2)} (${((100 * (base - ours)) / base).toFixed(2)}% better)`);
for (const t of [0, 0.5, 1, 1.5, 2, 3]) say(`  bet when |edge| >= ${t}: ${fmt(ats(test, t))}`);
say("each feature alone (same walk forward), bet when |edge| >= 1:");
for (const f of FEATURES) say(`  ${f.padEnd(6)} ${fmt(ats(walk(2015, LAST, lambda, [f]), 1))}`);
say("by season, bet when |edge| >= 1:");
for (let s = 2015; s <= LAST; s++) say(`  ${s}: ${fmt(ats(test.filter((p) => p.r.game.season === s), 1))}`);

// Final weights: every season through the last complete one.
const fit = fitRidge(rated.filter((r) => r.game.season < LAST || r.game.type === "POST").map((r) => ({ x: r.x, y: y(r) })), lambda);
say(`\nweights (points of residual per unit): ${FEATURES.map((f) => `${f} ${fit.w[f].toFixed(3)}`).join(", ")}, intercept ${fit.b.toFixed(2)}`);
writeFileSync("src/lib/models/nfl/spread-params.json", JSON.stringify({ rating: RP, w: fit.w, b: fit.b, lambda }, null, 2) + "\n");
writeFileSync(".cache/fit-nfl-spread.txt", log.join("\n") + "\n");
