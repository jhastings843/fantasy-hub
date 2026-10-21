// College football: can a rating model beat the OPENING line, and does its
// disagreement with the opener predict where the line goes by the close?
// (NFL history only has closers, so there this can only be tested forward.)
//
// Data (free, sportsdataverse/cfbfastR-data): spreads by book with opening
// and closing numbers (betting/csv/cfb_line_odds.csv.gz), and schedules with
// scores and CollegeFootballData's pregame Elo (schedules/csv). Cached in
// .cache/cfb/. Lines: per game, the median close across books, and the median
// opener across books that list one. Seasons 2014-2025.
//
// Features (leak-free, a day's features before its results; spread.ts Ratings):
//   gap   results-only rating minus the line
//   move  the line minus the market's own rating from past closes
//   cover last cover margin, home minus away
//   elo   CFBD's pregame Elo difference as points (/25 + home edge) minus the line
// Walk forward: ridge per season on all earlier seasons, lambda on 2017-2018,
// test 2019 on. Three targets:
//   close  residual vs the closing line (bet at the close)
//   open   residual vs the opener (bet at the opener)
//   clv    the line's move from open to close (does our side get better numbers?)
//
//   npx tsx --tsconfig scripts/tsconfig.json scripts/fit-cfb-spread.mts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { parseCsv } from "../src/lib/models/nfl/data";
import { Ratings, fitRidge, type RatingParams, type SpreadGame } from "../src/lib/models/nfl/spread";

const BASE = "https://raw.githubusercontent.com/sportsdataverse/cfbfastR-data/main";
const SEASONS = Array.from({ length: 12 }, (_, i) => 2014 + i);
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

// Schedules.
interface Sched {
  id: string;
  season: number;
  date: string;
  home: string;
  away: string;
  hp: number | null;
  ap: number | null;
  neutral: boolean;
  helo: number | null;
  aelo: number | null;
  fbs: boolean;
}
const sched: Sched[] = [];
for (const s of SEASONS) {
  const t = (await cached(`.cache/cfb/sched-${s}.csv`, `${BASE}/schedules/csv/cfb_schedules_${s}.csv`)).toString("utf8");
  for (const r of rows(t)) {
    const num = (x: string) => (x === "" || x === "NA" ? null : Number(x));
    sched.push({
      id: String(Number(r.game_id)),
      season: Number(r.season),
      date: (r.start_date ?? "").slice(0, 10),
      home: r.home_team,
      away: r.away_team,
      hp: num(r.home_points),
      ap: num(r.away_points),
      neutral: r.neutral_site === "TRUE" || r.neutral_site === "True" || r.neutral_site === "true",
      helo: num(r.home_pregame_elo),
      aelo: num(r.away_pregame_elo),
      fbs: r.home_division === "fbs" && r.away_division === "fbs",
    });
  }
}
const byId = new Map(sched.map((g) => [g.id, g]));

// Lines: home spread (negative = home favored), median across books.
const linesText = gunzipSync(await cached(".cache/cfb/lines.csv.gz", `${BASE}/betting/csv/cfb_line_odds.csv.gz`)).toString("utf8");
const perGame = new Map<string, { close: number[]; open: number[] }>();
const norm = (x: string) => x.toLowerCase().replace(/[^a-z]/g, "");
for (const r of rows(linesText)) {
  if (r.market_type !== "spread") continue;
  const g = byId.get(String(Number(r.game_id)));
  if (!g || r.lines === "") continue;
  const [awayName, homeName] = (r.game_desc ?? "").split("@");
  const a = norm(r.abbr);
  // The row is the home side when its label matches the home team (name in the schedule or in the game description).
  const isHome = a === norm(g.home) || a === norm(homeName ?? "") || (a !== norm(g.away) && a !== norm(awayName ?? "") && norm(g.home).startsWith(a));
  const isAway = a === norm(g.away) || a === norm(awayName ?? "") || (!isHome && norm(g.away).startsWith(a));
  if (isHome === isAway) continue;
  const sign = isHome ? 1 : -1;
  const e = perGame.get(g.id) ?? { close: [], open: [] };
  e.close.push(sign * Number(r.lines));
  if (r.opening_lines !== "") e.open.push(sign * Number(r.opening_lines));
  perGame.set(g.id, e);
}
const med = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
// Each book lists both sides: halve the duplicates by taking the median (sides agree after the sign flip).
const lineOf = new Map<string, { close: number; open: number | null }>();
for (const [id, e] of perGame) lineOf.set(id, { close: med(e.close), open: e.open.length ? med(e.open) : null });

const games: (SpreadGame & { open: number | null; eloDiff: number | null })[] = sched
  .filter((g) => g.hp !== null && g.ap !== null && lineOf.has(g.id))
  .map((g) => ({
    id: g.id,
    season: g.season,
    week: 0,
    type: "REG",
    gameday: g.date,
    home: g.home,
    away: g.away,
    homeScore: g.hp,
    awayScore: g.ap,
    line: -lineOf.get(g.id)!.close, // expected home margin
    homeRest: 7,
    awayRest: 7,
    homeQb: "",
    awayQb: "",
    neutral: g.neutral,
    open: lineOf.get(g.id)!.open === null ? null : -lineOf.get(g.id)!.open!,
    eloDiff: g.helo !== null && g.aelo !== null ? g.helo - g.aelo : null,
  }));
say(`games with a score and a line: ${games.length}; with an opener ${games.filter((g) => g.open !== null).length}`);
for (const s of SEASONS) say(`  ${s}: ${games.filter((g) => g.season === s).length} games, ${games.filter((g) => g.season === s && g.open !== null).length} with an opener`);

// Rating constants on 2014-2016 (margin error and next-line error).
const KEYS = ["gap", "move", "cover", "elo"] as const;
type X = Record<(typeof KEYS)[number], number>;
interface Row {
  g: (typeof games)[number];
  atClose: X;
  atOpen: X | null;
}
function build(p: RatingParams, eloScale: number, eloHfa: number): Row[] {
  const r = new Ratings(p);
  const out: Row[] = [];
  const sorted = [...games].sort((a, b) => a.gameday.localeCompare(b.gameday) || a.id.localeCompare(b.id));
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j < sorted.length && sorted[j].gameday === sorted[i].gameday) j++;
    const day = sorted.slice(i, j);
    for (const g of day) {
      const x = (line: number): X => {
        const f = r.features(g, line);
        const elo = g.eloDiff === null ? 0 : g.eloDiff / eloScale + (g.neutral ? 0 : eloHfa) - line;
        return { gap: f.gap, move: f.move, cover: f.cover, elo };
      };
      out.push({ g, atClose: x(g.line!), atOpen: g.open === null ? null : x(g.open) });
    }
    for (const g of day) r.add(g);
    i = j;
  }
  return out;
}
let RP: RatingParams = { hfa: 2.5, kPerf: 0.1, cap: 28, carryPerf: 0.6, hfaMkt: 2.5, kMkt: 0.4, carryMkt: 0.6 };
{
  const fitRows = (p: RatingParams) => build(p, 25, 2.5).filter((x) => x.g.season >= 2015 && x.g.season <= 2016);
  let b = { e: Infinity, p: RP };
  for (const hfa of [2, 2.5, 3, 3.5]) for (const kPerf of [0.06, 0.1, 0.14, 0.2]) for (const cap of [21, 28, 35]) for (const carryPerf of [0.4, 0.6, 0.8]) {
    const p = { ...RP, hfa, kPerf, cap, carryPerf };
    const rs = fitRows(p);
    const e = rs.reduce((a, x) => a + (x.atClose.gap + x.g.line! - (x.g.homeScore! - x.g.awayScore!)) ** 2, 0) / rs.length;
    if (e < b.e) b = { e, p };
  }
  RP = b.p;
  let m = { e: Infinity, p: RP };
  for (const hfaMkt of [2, 2.5, 3, 3.5]) for (const kMkt of [0.2, 0.4, 0.6]) for (const carryMkt of [0.4, 0.6, 0.8]) {
    const p = { ...RP, hfaMkt, kMkt, carryMkt };
    const rs = fitRows(p);
    const e = rs.reduce((a, x) => a + x.atClose.move ** 2, 0) / rs.length;
    if (e < m.e) m = { e, p };
  }
  RP = m.p;
  say(`ratings (fit 2015-2016): results hfa ${RP.hfa} k ${RP.kPerf} cap ${RP.cap} carry ${RP.carryPerf}; market hfa ${RP.hfaMkt} k ${RP.kMkt} carry ${RP.carryMkt}; margin RMSE ${Math.sqrt(b.e).toFixed(2)}`);
}
const all = build(RP, 25, 2.5).filter((x) => x.g.season >= 2015);

type Target = "close" | "open" | "clv";
const yOf = (r: Row, t: Target): number | null => {
  const margin = r.g.homeScore! - r.g.awayScore!;
  if (t === "close") return margin - r.g.line!;
  if (r.g.open === null) return null;
  if (t === "open") return margin - r.g.open;
  return r.g.line! - r.g.open; // close minus open in home-margin terms: + = moved toward home
};
const xOf = (r: Row, t: Target) => (t === "close" ? r.atClose : r.atOpen);
function walk(t: Target, from: number, to: number, lambda: number, keys: readonly (typeof KEYS)[number][] = KEYS) {
  const out: { r: Row; pred: number; y: number }[] = [];
  for (let s = from; s <= to; s++) {
    const train = all.filter((r) => r.g.season < s && xOf(r, t) && yOf(r, t) !== null).map((r) => ({ x: xOf(r, t)!, y: yOf(r, t)! }));
    if (train.length < 200) continue;
    const fit = fitRidge(train, lambda, keys);
    for (const r of all.filter((x) => x.g.season === s && xOf(x, t) && yOf(x, t) !== null)) {
      const x = xOf(r, t)!;
      out.push({ r, pred: fit.b + keys.reduce((a, k) => a + fit.w[k] * x[k], 0), y: yOf(r, t)! });
    }
  }
  return out;
}
const ats = (ps: { pred: number; y: number }[], th: number) => {
  let w = 0;
  let l = 0;
  for (const p of ps) {
    if (Math.abs(p.pred) < th || p.y === 0) continue;
    if (Math.sign(p.y) === Math.sign(p.pred)) w++;
    else l++;
  }
  const n = w + l;
  return `${w}-${l} ${n ? ((100 * w) / n).toFixed(1) : "0.0"}% z ${n ? ((w / n - 0.5238) / Math.sqrt((0.5238 * 0.4762) / n)).toFixed(2) : "0.00"}`;
};

for (const t of ["close", "open", "clv"] as Target[]) {
  let lambda = 100;
  let best = Infinity;
  for (const l of [10, 100, 1000, 10000]) {
    const ps = walk(t, 2017, 2018, l);
    const e = ps.reduce((a, p) => a + (p.y - p.pred) ** 2, 0) / ps.length;
    if (e < best) {
      best = e;
      lambda = l;
    }
  }
  const test = walk(t, 2019, 2025, lambda);
  const base = test.reduce((a, p) => a + p.y ** 2, 0) / test.length;
  const ours = test.reduce((a, p) => a + (p.y - p.pred) ** 2, 0) / test.length;
  say(`\n${t.toUpperCase()} (test 2019-2025, ${test.length} games, lambda ${lambda}): MSE ${base.toFixed(2)} -> ${ours.toFixed(2)} (${((100 * (base - ours)) / base).toFixed(2)}% better)`);
  if (t === "clv") {
    // Betting at the opener on our side: average points the line then moved our way.
    for (const th of [0, 0.5, 1, 2]) {
      const bets = test.filter((p) => Math.abs(p.pred) >= th && p.pred !== 0);
      const clv = bets.map((p) => Math.sign(p.pred) * p.y);
      const m = clv.reduce((a, v) => a + v, 0) / (clv.length || 1);
      const sd = Math.sqrt(clv.reduce((a, v) => a + (v - m) ** 2, 0) / Math.max(1, clv.length - 1));
      say(`  predicted move >= ${th}: ${bets.length} games, average move our way ${m.toFixed(2)} pts (t ${(m / (sd / Math.sqrt(clv.length || 1))).toFixed(2)}), moved our way ${((100 * clv.filter((v) => v > 0).length) / (clv.length || 1)).toFixed(1)}%, against ${((100 * clv.filter((v) => v < 0).length) / (clv.length || 1)).toFixed(1)}%`);
    }
  } else for (const th of [0, 1, 2, 3]) say(`  bet when |edge| >= ${th}: ${ats(test, th)}`);
  say("  each feature alone, bet its top/bottom 15%:");
  for (const k of KEYS) {
    const rs = all.filter((r) => r.g.season >= 2019 && xOf(r, t) && yOf(r, t) !== null);
    const xs = rs.map((r) => xOf(r, t)![k]).sort((a, b) => a - b);
    const lo = xs[Math.floor(xs.length * 0.15)];
    const hi = xs[xs.length - 1 - Math.floor(xs.length * 0.15)];
    const ps = rs.flatMap((r) => {
      const v = xOf(r, t)![k];
      return v >= hi && hi > 0 ? [{ pred: 1, y: yOf(r, t)! }] : v <= lo && lo < 0 ? [{ pred: -1, y: yOf(r, t)! }] : [];
    });
    if (t === "clv") {
      const m = ps.reduce((a, p) => a + p.pred * p.y, 0) / (ps.length || 1);
      say(`    ${k.padEnd(6)} ${ps.length} games, average move our way ${m.toFixed(2)} pts`);
    } else say(`    ${k.padEnd(6)} ${ats(ps, 0)}`);
  }
}
writeFileSync(".cache/fit-cfb-spread.txt", log.join("\n") + "\n");
