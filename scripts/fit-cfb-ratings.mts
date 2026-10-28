// Fits and tests our college model (src/lib/models/cfb/model.ts): the margin
// rating, the points ratings and the win-chance sigma.
//
// Data: the same free sportsdataverse/cfbfastR-data files as
// scripts/fit-cfb-spread.mts (schedules with scores, lines by book with
// openers), cached in .cache/cfb/. Ratings learn from every game with an FBS
// team (the live model reads ESPN's FBS scoreboard, which has the same games).
// Walk forward, a whole day projected before any of its results.
// Constants fit on 2016-2023 (2014-2015 warm the ratings up), judged on
// 2024-2025, which the fit never saw.
//
// Reported honestly on the test seasons: margin error against the closing
// line's, against-the-spread records betting our side (and fading it) at the
// opener and at the close by edge size, how far the line moved our way from
// open to close, and the same for totals. Writes src/lib/models/cfb/params.json.
//
//   npx tsx --tsconfig scripts/tsconfig.json scripts/fit-cfb-ratings.mts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { parseCsv } from "../src/lib/models/nfl/data";
import { CfbModel, phi, type CfbParams, type CfbResult } from "../src/lib/models/cfb/model";

const BASE = "https://raw.githubusercontent.com/sportsdataverse/cfbfastR-data/main";
const SEASONS = Array.from({ length: 12 }, (_, i) => 2014 + i);
const TRAIN: [number, number] = [2016, 2023];
const TEST: [number, number] = [2024, 2025];
mkdirSync(".cache/cfb", { recursive: true });
async function cached(path: string, url: string): Promise<Buffer> {
  if (!existsSync(path)) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    writeFileSync(path, Buffer.from(await r.arrayBuffer()));
  }
  return readFileSync(path);
}
const rows = (text: string) => {
  const [head, ...body] = parseCsv(text);
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.replace(/"/g, ""), (r[i] ?? "").replace(/"/g, "")])) as Record<string, string>);
};
const log: string[] = [];
const say = (s: string) => {
  console.log(s);
  log.push(s);
};

// Schedules: every game with a score and at least one FBS team.
const results: CfbResult[] = [];
const names = new Map<string, { home: string; away: string }>();
for (const s of SEASONS) {
  const t = (await cached(`.cache/cfb/sched-${s}.csv`, `${BASE}/schedules/csv/cfb_schedules_${s}.csv`)).toString("utf8");
  for (const r of rows(t)) {
    const hp = r.home_points === "" || r.home_points === "NA" ? null : Number(r.home_points);
    const ap = r.away_points === "" || r.away_points === "NA" ? null : Number(r.away_points);
    if (hp === null || ap === null || !Number.isFinite(hp) || !Number.isFinite(ap)) continue;
    if (r.home_division !== "fbs" && r.away_division !== "fbs") continue;
    const id = String(Number(r.game_id));
    names.set(id, { home: r.home_team, away: r.away_team });
    results.push({
      id,
      season: Number(r.season),
      date: (r.start_date ?? "").slice(0, 10),
      home: r.home_team,
      away: r.away_team,
      homeScore: hp,
      awayScore: ap,
      neutral: /^true$/i.test(r.neutral_site),
    });
  }
}
results.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

// Lines per game: median across books of the home spread (open and close) and the total.
const linesText = gunzipSync(await cached(".cache/cfb/lines.csv.gz", `${BASE}/betting/csv/cfb_line_odds.csv.gz`)).toString("utf8");
const norm = (x: string) => x.toLowerCase().replace(/[^a-z]/g, "");
const acc = new Map<string, { close: number[]; open: number[]; tClose: number[]; tOpen: number[] }>();
for (const r of rows(linesText)) {
  const id = String(Number(r.game_id));
  const g = names.get(id);
  if (!g || r.lines === "") continue;
  const e = acc.get(id) ?? { close: [], open: [], tClose: [], tOpen: [] };
  if (r.market_type === "total") {
    e.tClose.push(Number(r.lines));
    if (r.opening_lines !== "") e.tOpen.push(Number(r.opening_lines));
  } else if (r.market_type === "spread") {
    const [awayName, homeName] = (r.game_desc ?? "").split("@");
    const a = norm(r.abbr);
    const isHome = a === norm(g.home) || a === norm(homeName ?? "") || (a !== norm(g.away) && a !== norm(awayName ?? "") && norm(g.home).startsWith(a));
    const isAway = a === norm(g.away) || a === norm(awayName ?? "") || (!isHome && norm(g.away).startsWith(a));
    if (isHome === isAway) continue;
    const sign = isHome ? 1 : -1;
    e.close.push(sign * Number(r.lines));
    if (r.opening_lines !== "") e.open.push(sign * Number(r.opening_lines));
  } else continue;
  acc.set(id, e);
}
const med = (xs: number[]) => {
  const v = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
};
/** Home spread (negative = home favored) and total, open and close. */
const lineOf = new Map<string, { close: number | null; open: number | null; tClose: number | null; tOpen: number | null }>();
for (const [id, e] of acc) lineOf.set(id, { close: med(e.close), open: med(e.open), tClose: med(e.tClose), tOpen: med(e.tOpen) });

interface Row {
  g: CfbResult;
  margin: number;
  total: number;
}
/** Every game's pregame projection, day by day. */
function walk(p: CfbParams): Row[] {
  const m = new CfbModel(p);
  const out: Row[] = [];
  for (let i = 0; i < results.length; ) {
    let j = i;
    while (j < results.length && results[j].date === results[i].date) j++;
    const day = results.slice(i, j);
    for (const g of day) {
      const pr = m.project(g);
      out.push({ g, margin: pr.margin, total: pr.total });
    }
    for (const g of day) m.add(g);
    i = j;
  }
  return out;
}
const inRange = (s: number, [a, b]: [number, number]) => s >= a && s <= b;
const mse = (xs: number[]) => xs.reduce((a, x) => a + x * x, 0) / xs.length;

let P: CfbParams = {
  rating: { hfa: 3, kPerf: 0.15, cap: 35, carryPerf: 0.7, hfaMkt: 3, kMkt: 0.5, carryMkt: 0.7 },
  points: { hfa: 3, k: 0.15, cap: 35, carry: 0.7 },
  sigma: 16,
};

// 1. Margin rating: home edge, learning rate, cap, carry. Margin MSE on train.
{
  let b = { e: Infinity, p: P.rating };
  for (const hfa of [2, 2.5, 3, 3.5])
    for (const kPerf of [0.12, 0.16, 0.2, 0.25, 0.3, 0.35, 0.45])
      for (const cap of [28, 35, 42, 50, 60])
        for (const carryPerf of [0.6, 0.7, 0.8, 0.9, 0.95, 1]) {
          const rating = { ...P.rating, hfa, kPerf, cap, carryPerf };
          const rs = walk({ ...P, rating }).filter((r) => inRange(r.g.season, TRAIN));
          const e = mse(rs.map((r) => r.g.homeScore - r.g.awayScore - r.margin));
          if (e < b.e) b = { e, p: rating };
        }
  P = { ...P, rating: b.p };
  say(`margin rating (fit ${TRAIN.join("-")}): home edge ${P.rating.hfa}, k ${P.rating.kPerf}, cap ${P.rating.cap}, carry ${P.rating.carryPerf}; train margin RMSE ${Math.sqrt(b.e).toFixed(2)}`);
}

// 2. Points ratings: home edge, learning rate, cap, carry. Total MSE on train.
{
  let b = { e: Infinity, p: P.points };
  for (const hfa of [0, 1, 2, 3, 4])
    for (const k of [0.06, 0.1, 0.15, 0.2, 0.3])
      for (const cap of [21, 28, 35])
        for (const carry of [0.5, 0.6, 0.7, 0.8, 0.9]) {
          const points = { hfa, k, cap, carry };
          const rs = walk({ ...P, points }).filter((r) => inRange(r.g.season, TRAIN));
          const e = mse(rs.map((r) => r.g.homeScore + r.g.awayScore - r.total));
          if (e < b.e) b = { e, p: points };
        }
  P = { ...P, points: b.p };
  say(`points ratings (fit ${TRAIN.join("-")}): home edge ${P.points.hfa}, k ${P.points.k}, cap ${P.points.cap}, carry ${P.points.carry}; train total RMSE ${Math.sqrt(b.e).toFixed(2)}`);
}

// 3. Win-chance sigma by log loss on train.
const all = walk(P);
{
  const train = all.filter((r) => inRange(r.g.season, TRAIN) && r.g.homeScore !== r.g.awayScore);
  let b = { l: Infinity, s: 16 };
  for (let s = 10; s <= 24.01; s += 0.5) {
    const l = train.reduce((a, r) => {
      const p = Math.min(Math.max(phi(r.margin / s), 1e-6), 1 - 1e-6);
      return a - (r.g.homeScore > r.g.awayScore ? Math.log(p) : Math.log(1 - p));
    }, 0);
    if (l < b.l) b = { l, s: Math.round(s * 10) / 10 };
  }
  P = { ...P, sigma: b.s };
  say(`win chance sigma ${P.sigma} (log loss on train)`);
}

// ---------------------------------------------------------------- test
const test = all.filter((r) => inRange(r.g.season, TEST));
say(`\nTEST ${TEST.join("-")}: ${test.length} games with an FBS team`);
const withClose = test.filter((r) => lineOf.get(r.g.id)?.close != null);
const ours = withClose.map((r) => r.g.homeScore - r.g.awayScore - r.margin);
const mkt = withClose.map((r) => r.g.homeScore - r.g.awayScore + lineOf.get(r.g.id)!.close!);
say(`margin RMSE, ${withClose.length} games with a closing line: ours ${Math.sqrt(mse(ours)).toFixed(2)}, closing line ${Math.sqrt(mse(mkt)).toFixed(2)}`);
{
  const wins = test.filter((r) => r.g.homeScore !== r.g.awayScore);
  const brier = wins.reduce((a, r) => a + (phi(r.margin / P.sigma) - (r.g.homeScore > r.g.awayScore ? 1 : 0)) ** 2, 0) / wins.length;
  const right = wins.filter((r) => (r.margin > 0) === r.g.homeScore > r.g.awayScore).length;
  say(`straight up: our favorite won ${right}/${wins.length} (${((100 * right) / wins.length).toFixed(1)}%), win chance Brier ${brier.toFixed(4)}`);
}

const BE = 0.5238;
const rec = (xs: number[]) => {
  const w = xs.filter((x) => x > 0).length;
  const l = xs.filter((x) => x < 0).length;
  const n = w + l;
  const units = w * (100 / 110) - l;
  return `${w}-${l} ${n ? ((100 * w) / n).toFixed(1) : "0.0"}% (z vs 52.4% ${n ? ((w / n - BE) / Math.sqrt((BE * (1 - BE)) / n)).toFixed(2) : "0.00"}, ${units >= 0 ? "+" : ""}${units.toFixed(1)}u at -110)`;
};

// Spreads: our edge = how far our spread is from the line (points, toward our side).
for (const at of ["open", "close"] as const) {
  const rs = test.flatMap((r) => {
    const l = lineOf.get(r.g.id)?.[at];
    if (l == null) return [];
    const edge = -r.margin - l; // > 0: our spread is above the line, so we like the away side
    const cover = r.g.homeScore - r.g.awayScore + l; // home covers when > 0
    return [{ edge, cover, side: edge > 0 ? -1 : 1 }];
  });
  say(`\nSPREADS at the ${at} (${rs.length} games)`);
  for (const th of [0, 3, 7, 10]) {
    const b = rs.filter((x) => Math.abs(x.edge) >= th && x.edge !== 0);
    say(`  our side, edge ${th}+ pts (${b.length}): ${rec(b.map((x) => x.side * x.cover))}`);
    if (th >= 7) say(`  fade ours, edge ${th}+ pts: ${rec(b.map((x) => -x.side * x.cover))}`);
  }
}
// Line move from open to close, toward our side at the opener.
{
  const rs = test.flatMap((r) => {
    const L = lineOf.get(r.g.id);
    if (L?.open == null || L.close == null) return [];
    const edge = -r.margin - L.open;
    if (edge === 0) return [];
    // Our side away (edge > 0): the line moving up (home spread less negative) is toward us.
    return [{ edge, move: Math.sign(edge) * (L.close - L.open) }];
  });
  say(`\nLINE MOVE from open to close, toward our side at the opener (${rs.length} games)`);
  for (const th of [0, 3, 7]) {
    const b = rs.filter((x) => Math.abs(x.edge) >= th);
    const m = b.reduce((a, x) => a + x.move, 0) / (b.length || 1);
    const sd = Math.sqrt(b.reduce((a, x) => a + (x.move - m) ** 2, 0) / Math.max(1, b.length - 1));
    say(`  edge ${th}+ pts (${b.length}): average ${m >= 0 ? "+" : ""}${m.toFixed(2)} pts our way (t ${(m / (sd / Math.sqrt(b.length || 1))).toFixed(2)}), toward us ${((100 * b.filter((x) => x.move > 0).length) / (b.length || 1)).toFixed(1)}%, against ${((100 * b.filter((x) => x.move < 0).length) / (b.length || 1)).toFixed(1)}%`);
  }
}
// Totals.
for (const at of ["tOpen", "tClose"] as const) {
  const rs = test.flatMap((r) => {
    const t = lineOf.get(r.g.id)?.[at];
    if (t == null) return [];
    return [{ edge: r.total - t, over: r.g.homeScore + r.g.awayScore - t, t, actual: r.g.homeScore + r.g.awayScore, ours: r.total }];
  });
  say(`\nTOTALS at the ${at === "tOpen" ? "open" : "close"} (${rs.length} games): RMSE ours ${Math.sqrt(mse(rs.map((x) => x.actual - x.ours))).toFixed(2)}, line ${Math.sqrt(mse(rs.map((x) => x.actual - x.t))).toFixed(2)}`);
  for (const th of [0, 3, 7]) {
    const b = rs.filter((x) => Math.abs(x.edge) >= th && x.edge !== 0);
    say(`  our side, edge ${th}+ pts (${b.length}): ${rec(b.map((x) => Math.sign(x.edge) * x.over))}`);
  }
}

const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
writeFileSync(
  "src/lib/models/cfb/params.json",
  JSON.stringify({ rating: P.rating, points: { ...P.points, k: r4(P.points.k) }, sigma: P.sigma }, null, 2) + "\n",
);
writeFileSync(".cache/fit-cfb-ratings.txt", log.join("\n") + "\n");
console.log("\nwrote src/lib/models/cfb/params.json");
