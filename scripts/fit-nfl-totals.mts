// Walk-forward fit and test of our NFL totals model (src/lib/models/nfl/totals.ts).
//
// 1. Points ratings (offense, defense, home edge, rate, cap, carry) fit on
//    2006-2023 by squared error of the projected total against real points;
//    1999-2005 only warms the ratings. A whole day is projected before any of
//    its results go in.
// 2. Sigma for the win chance: the spread of real margins around our spread
//    model's margin (the closing line moved by its predicted residual), same
//    seasons.
// 3. Test 2024 on: RMSE against nflverse's total_line (a late, near-closing
//    number); over/under on our side of that line, every game and at 3+ and
//    5+ points off; Brier of the win chance. nflverse keeps no opening total,
//    so the open and the line move toward our side can't be tested here; the
//    live tracker grades those forward (picks learning "t-ours").
//
//   npx tsx --tsconfig scripts/tsconfig.json scripts/fit-nfl-totals.mts
// --refit (weekly job, scripts/refit/common.mts): test = the last 4 NFL weeks
// with a total and a score, train = every game before them; stored only if
// the squared total error per test game beats the live settings by 2+ SE.
// Writes no JSON. Add --dry to score without storing.
// Needs .cache/nfl/games.csv (nflverse nfldata games.csv).
import { readFileSync, writeFileSync } from "node:fs";
import TOTALS_DEFAULTS from "../src/lib/models/nfl/totals-params.json";
import SPREAD from "../src/lib/models/nfl/spread-params.json";
import { REFIT, liveParams, paired, submit } from "./refit/common.mjs";
import { parseCsv } from "../src/lib/models/nfl/data";
import { phi, PointsRatings } from "../src/lib/models/cfb/model";
import { rateAll, residual, toSpreadGame, type SpreadGame, type SpreadParams } from "../src/lib/models/nfl/spread";
import { nflResult, type NflTotalsParams } from "../src/lib/models/nfl/totals";

type G = SpreadGame & { total: number | null };
const [head, ...body] = parseCsv(readFileSync(".cache/nfl/games.csv", "utf8"));
const games: G[] = body
  .map((r) => {
    const o = Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""]));
    const g = toSpreadGame(o);
    return g ? { ...g, total: o.total_line === "" ? null : Number(o.total_line) } : null;
  })
  .filter((g): g is G => g !== null)
  .sort((a, b) => a.gameday.localeCompare(b.gameday) || a.id.localeCompare(b.id));
const done = (g: G) => g.homeScore !== null && g.awayScore !== null;
const pts = (g: G) => g.homeScore! + g.awayScore!;

const log: string[] = [];
const say = (s: string) => {
  console.log(s);
  log.push(s);
};

/** Each game's projected total as of kickoff (a day at a time), for games passing `keep`. */
function project(p: NflTotalsParams, keep: (g: G) => boolean, upTo = Infinity): Map<string, number> {
  const r = new PointsRatings(p.points, p.start);
  const out = new Map<string, number>();
  for (let i = 0; i < games.length; ) {
    let j = i;
    while (j < games.length && games[j].gameday === games[i].gameday) j++;
    if (Date.parse(games[i].gameday) >= upTo) break;
    const day = games.slice(i, j);
    for (const g of day)
      if (keep(g)) {
        const e = r.expect(g.season, g.home, g.away, g.neutral);
        out.set(g.id, e.home + e.away);
      }
    for (const g of day) if (done(g)) r.add(nflResult(g));
    i = j;
  }
  return out;
}

const sqErr = (p: NflTotalsParams, test: (g: G) => boolean) => {
  const m = project(p, (g) => test(g) && done(g));
  return games.filter((g) => m.has(g.id)).map((g) => (m.get(g.id)! - pts(g)) ** 2);
};
const mean = (xs: number[]) => xs.reduce((a, x) => a + x, 0) / xs.length;

/** Grid search of the points constants by squared total error on `train`. */
function fit(train: (g: G) => boolean, start: NflTotalsParams): NflTotalsParams {
  let best = { e: Infinity, p: start };
  for (const hfa of [0, 1, 2, 3])
    for (const k of [0.05, 0.1, 0.15, 0.2, 0.3])
      for (const cap of [14, 21, 28])
        for (const carry of [0.3, 0.5, 0.7, 0.9]) {
          const p = { ...start, points: { hfa, k, cap, carry } };
          const e = mean(sqErr(p, train));
          if (e < best.e) best = { e, p };
        }
  return best.p;
}

/** Sigma: spread of real margins around our spread model's margin (line plus predicted residual). */
function sigmaOn(keep: (g: SpreadGame) => boolean, sp: SpreadParams): number {
  const errs = rateAll(games, sp.rating)
    .filter((r) => keep(r.game))
    .map((r) => r.game.homeScore! - r.game.awayScore! - (r.game.line! + residual(r.x, sp)));
  return Math.round(Math.sqrt(mean(errs.map((e) => e * e))) * 10) / 10;
}

if (REFIT) {
  const wk = (g: G) => g.season * 100 + (g.type === "POST" ? 30 : 0) + g.week;
  const weeks = [...new Set(games.filter((g) => done(g) && g.total !== null).map(wk))].sort((a, b) => a - b);
  const testWeeks = weeks.slice(-4);
  const isTest = (g: G) => testWeeks.includes(wk(g)) && done(g) && g.total !== null;
  const testSeason = Math.floor(testWeeks[0] / 100);
  const L = await liveParams("nfl-totals", TOTALS_DEFAULTS as NflTotalsParams);
  const refit0 = fit((g) => wk(g) < testWeeks[0] && g.season >= testSeason - 12 && done(g), L);
  const refit = { ...refit0, sigma: sigmaOn((g) => wk(g as G) < testWeeks[0] && g.season >= testSeason - 12 && g.line !== null && g.homeScore !== null, SPREAD as SpreadParams) };
  say(`refit: ${JSON.stringify(refit)}`);
  const ev = paired(sqErr(L, isTest), sqErr(refit, isTest), `squared total error per game, weeks ${testWeeks.join(",")}`);
  await submit("nfl-totals", TOTALS_DEFAULTS as NflTotalsParams, refit, ev);
  process.exit(0);
}

const train = (g: G) => g.season >= 2006 && g.season <= 2023 && done(g);
const test = (g: G) => g.season >= 2024 && done(g);
say(`games ${games.length}; train ${games.filter(train).length} (2006-2023), test ${games.filter(test).length} (2024 on)`);

// The starting league average: points per team per game across 1999-2005.
const warm = games.filter((g) => g.season <= 2005 && done(g));
const start = Math.round((mean(warm.map(pts)) / 2) * 10) / 10;
let P: NflTotalsParams = fit(train, { points: { hfa: 2, k: 0.1, cap: 21, carry: 0.5 }, start, sigma: 13 });
P = { ...P, sigma: sigmaOn((g) => g.season >= 2006 && g.season <= 2023 && g.line !== null && g.homeScore !== null, SPREAD as SpreadParams) };
say(`fit: start ${P.start}, home edge ${P.points.hfa}, k ${P.points.k}, cap ${P.points.cap}, carry ${P.points.carry}; sigma ${P.sigma}`);
say(`train RMSE ${Math.sqrt(mean(sqErr(P, train))).toFixed(2)}`);

// Test.
const m = project(P, (g) => test(g));
const rows = games.filter((g) => test(g) && m.has(g.id) && g.total !== null).map((g) => ({ g, ours: m.get(g.id)!, line: g.total!, pts: pts(g) }));
const rmse = (f: (r: (typeof rows)[number]) => number) => Math.sqrt(mean(rows.map((r) => (f(r) - r.pts) ** 2))).toFixed(2);
say(`\nTEST 2024 on, ${rows.length} games with a total_line`);
say(`RMSE: ours ${rmse((r) => r.ours)} vs total_line ${rmse((r) => r.line)}; blend half and half ${rmse((r) => (r.ours + r.line) / 2)}`);
say(`average: ours ${mean(rows.map((r) => r.ours)).toFixed(1)}, line ${mean(rows.map((r) => r.line)).toFixed(1)}, real ${mean(rows.map((r) => r.pts)).toFixed(1)}`);
for (const edge of [0, 3, 5]) {
  let w = 0, l = 0, pu = 0;
  for (const r of rows) {
    if (Math.abs(r.ours - r.line) < edge || r.ours === r.line) continue;
    const over = r.ours > r.line;
    const v = over ? r.pts - r.line : r.line - r.pts;
    if (v > 0) w++;
    else if (v < 0) l++;
    else pu++;
  }
  const n = w + l;
  const z = n ? ((w / n - 0.5238) / Math.sqrt((0.5238 * 0.4762) / n)).toFixed(2) : "0";
  say(`our side of total_line${edge ? `, ${edge}+ off` : ""}: ${w}-${l}${pu ? `-${pu}` : ""}, ${n ? ((100 * w) / n).toFixed(1) : "0"}%, units at -110 ${(w * (100 / 110) - l).toFixed(1)}, z vs 52.4% ${z}`);
}
{
  const over = rows.filter((r) => r.ours > r.line);
  say(`overs ${over.length}, unders ${rows.length - over.length}`);
}
// Win chance, test seasons: our spread model's margin through phi(margin / sigma).
{
  const rated = rateAll(games, (SPREAD as SpreadParams).rating).filter((r) => r.game.season >= 2024 && r.game.homeScore !== null && r.game.line !== null && r.game.homeScore !== r.game.awayScore);
  let brier = 0, right = 0;
  for (const r of rated) {
    const pHome = phi((r.game.line! + residual(r.x, SPREAD as SpreadParams)) / P.sigma);
    const y = r.game.homeScore! > r.game.awayScore! ? 1 : 0;
    brier += (pHome - y) ** 2;
    if ((pHome > 0.5 ? 1 : 0) === y) right++;
  }
  say(`win chance (spread model margin, sigma ${P.sigma}): ${rated.length} games, favorite won ${((100 * right) / rated.length).toFixed(1)}%, Brier ${(brier / rated.length).toFixed(4)}`);
}
say("Opening totals: not in nflverse, so the open and the line move toward our side are graded forward only.");

writeFileSync("src/lib/models/nfl/totals-params.json", JSON.stringify(P, null, 2) + "\n");
writeFileSync(".cache/fit-nfl-totals.txt", log.join("\n") + "\n");
console.log("\nwrote src/lib/models/nfl/totals-params.json");
