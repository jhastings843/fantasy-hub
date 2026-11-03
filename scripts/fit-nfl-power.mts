// Walk-forward fit and test of our play-by-play NFL line (src/lib/models/nfl/power.ts).
//
// 1. Read nflverse play by play (.cache/nfl/pbp/play_by_play_{season}.csv.gz)
//    into team-games, once, for three garbage-time cuts; cached at
//    .cache/nfl/power-agg.json (--fresh to rebuild).
// 2. Shrinkage (prior plays), carry and garbage-time cut picked on
//    validation: margin constants fit on 2007-2015, scored on 2016-2019.
// 3. Test, 2020-2026: for each season S the margin constants are fit on
//    2007..S-1 only and applied to S. Scored against the actual margin
//    (squared error, next to the closing line's), against the spread at the
//    close (nflverse spread_line) when our line is 1, 2 or 3+ points off it,
//    and, 2026 only (the one season ESPN still keeps DraftKings' opener for),
//    closing-line value from the open: did the line move toward our side.
// 4. Final constants on every game to date, plus 2025's final ratings (next
//    season's starting point), written to src/lib/models/nfl/power-params.json.
//
//   npx tsx --tsconfig scripts/tsconfig.json scripts/fit-nfl-power.mts [--fresh]
import { createReadStream, existsSync, readFileSync, writeFileSync } from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { parseCsv } from "../src/lib/models/nfl/data";
import { rateAll, solve, toSpreadGame, type SpreadGame } from "../src/lib/models/nfl/spread";
import SPREAD from "../src/lib/models/nfl/spread-params.json";
import { PlayAgg, edges, modernTeam, packRatings, powerMargin, ratingsByDay, splitCsvLine, type PowerInputs, type PowerParams, type Rating, type TeamGame } from "../src/lib/models/nfl/power";
import { clvPoints, parseSummary } from "../src/lib/picks/closing";

const t0 = Date.now();
const log: string[] = [];
const say = (s: string) => {
  console.log(s);
  log.push(s);
};
const WPS = [0, 0.05, 0.1];
const AGG = ".cache/nfl/power-agg.json";

// 1. Team-games per garbage-time cut.
let agg: { [wp: string]: TeamGame[] };
if (existsSync(AGG) && !process.argv.includes("--fresh")) agg = JSON.parse(readFileSync(AGG, "utf8"));
else {
  const aggs = WPS.map((w) => new PlayAgg(w));
  for (let season = 2006; season <= 2026; season++) {
    const file = `.cache/nfl/pbp/play_by_play_${season}.csv.gz`;
    if (!existsSync(file)) continue;
    const rl = createInterface({
      input: createReadStream(file).pipe(createGunzip()),
      crlfDelay: Infinity,
    });
    let first = true;
    for await (const line of rl) {
      const f = splitCsvLine(line);
      if (first) {
        aggs.forEach((a) => a.header(f));
        first = false;
      } else aggs.forEach((a) => a.row(f));
    }
    console.log(`read ${season}`);
  }
  agg = Object.fromEntries(WPS.map((w, i) => [String(w), aggs[i].teamGames()]));
  writeFileSync(AGG, JSON.stringify(agg));
}
for (const w of WPS) say(`wp cut ${w}: ${agg[String(w)].length} team-games, ${agg[String(w)].reduce((a, g) => a + g.passN + g.rushN, 0)} plays`);
const lastPbpDay = agg["0"].reduce((a, g) => (g.gameday > a ? g.gameday : a), "");
say(`play by play through ${lastPbpDay}`);

// Games, team codes made current so ratings and QB history carry across moves.
const [head, ...body] = parseCsv(readFileSync(".cache/nfl/games.csv", "utf8"));
const raw = body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
const espnId = new Map(raw.map((r) => [r.game_id, r.espn]));
const games = raw
  .map((r) => toSpreadGame(r))
  .filter((g): g is SpreadGame => g !== null)
  .map((g) => ({ ...g, home: modernTeam(g.home), away: modernTeam(g.away) }));
// Rest and QB change exactly as spread.ts computes them (only games with a line and a score come back).
const ctx = new Map(rateAll(games, SPREAD.rating).map((r) => [r.game.id, r]));

interface Row {
  g: SpreadGame;
  x: PowerInputs;
  y: number;
  close: number;
}

const shift = (day: string, d: number) => new Date(Date.parse(`${day}T12:00:00Z`) - d * 86_400_000).toISOString().slice(0, 10);

/** `lag` days: ratings from plays more than `lag` days before kickoff only (0 = every earlier day). */
function rowsFor(n0: number, carry: number, wp: number, lag = 0): Row[] {
  const at = new Map<string, Map<string, Rating>>();
  const days = new Map<number, string[]>();
  for (const s of ratingsByDay(agg[String(wp)], n0, carry))
    if ("day" in s) {
      at.set(`${s.season}|${s.day}`, s.ratings);
      days.set(s.season, [...(days.get(s.season) ?? []), s.day]);
    }
  // Ratings "before day D" are the ones solved for the first game day on or after D.
  const asOf = (season: number, d: string) => {
    const ds = days.get(season) ?? [];
    const day = ds.find((x) => x >= d);
    return day ? at.get(`${season}|${day}`) : undefined;
  };
  const out: Row[] = [];
  for (const [, { game: g, x }] of ctx) {
    if (g.season < 2007 || g.gameday > lastPbpDay) continue;
    const r = lag ? asOf(g.season, shift(g.gameday, lag - 1)) : at.get(`${g.season}|${g.gameday}`);
    if (!r) continue;
    const e = edges(r, g.home, g.away);
    out.push({
      g,
      x: {
        pass: e.pass,
        rush: e.rush,
        rest: x.rest,
        qb: x.qb,
        neutral: g.neutral,
      },
      y: g.homeScore! - g.awayScore!,
      close: g.line!,
    });
  }
  return out.sort((a, b) => a.g.gameday.localeCompare(b.g.gameday));
}

type K = Pick<PowerParams, "hfa" | "kPass" | "kRush" | "kRest" | "kQb">;
/** Least squares of the margin on [home, pass, rush, rest, qb], no intercept beyond home field. */
function fitK(rows: Row[]): K {
  const v = (r: Row) => [r.x.neutral ? 0 : 1, r.x.pass, r.x.rush, r.x.rest, r.x.qb];
  const A = Array.from({ length: 5 }, (_, i) => Array.from({ length: 5 }, (_, j) => (i === j ? 1e-6 : 0)));
  const c = new Array(5).fill(0);
  for (const r of rows) {
    const z = v(r);
    for (let i = 0; i < 5; i++) {
      c[i] += z[i] * r.y;
      for (let j = 0; j < 5; j++) A[i][j] += z[i] * z[j];
    }
  }
  const [hfa, kPass, kRush, kRest, kQb] = solve(A, c);
  return { hfa, kPass, kRush, kRest, kQb };
}
const full = (k: K, h: { prior: number; carry: number; wp: number }): PowerParams => ({ ...h, ...k });
const mse = (rows: Row[], f: (r: Row) => number) => rows.reduce((a, r) => a + (r.y - f(r)) ** 2, 0) / rows.length;

// 2. Validation.
let best: { prior: number; carry: number; wp: number; mse: number } | null = null;
for (const wp of WPS)
  for (const prior of [200, 400, 800, 1600, 3200])
    for (const carry of [0.3, 0.5, 0.7]) {
      const rows = rowsFor(prior, carry, wp);
      const k = fitK(rows.filter((r) => r.g.season <= 2015));
      const val = rows.filter((r) => r.g.season >= 2016 && r.g.season <= 2019);
      const m = mse(val, (r) => powerMargin(r.x, full(k, { prior, carry, wp })));
      if (!best || m < best.mse) best = { prior, carry, wp, mse: m };
    }
const H = { prior: best!.prior, carry: best!.carry, wp: best!.wp };
say(`validation 2016-2019 picked prior ${H.prior} plays, carry ${H.carry}, wp cut ${H.wp} (margin MSE ${best!.mse.toFixed(2)})`);

// 3. Test, rolling by season.
const rows = rowsFor(H.prior, H.carry, H.wp);
const test: (Row & { ours: number })[] = [];
for (let S = 2020; S <= 2026; S++) {
  const k = fitK(rows.filter((r) => r.g.season >= 2007 && r.g.season < S));
  for (const r of rows.filter((r) => r.g.season === S)) test.push({ ...r, ours: powerMargin(r.x, full(k, H)) });
}
const r2 = (v: number) => v.toFixed(2);
say(`\nTEST 2020-2026 (through ${lastPbpDay}), ${test.length} games`);
say(`margin MSE: ours ${r2(mse(test, (r) => r.ours))}, closing line ${r2(mse(test, (r) => r.close))}, average of the two ${r2(mse(test, (r) => (r.ours + r.close) / 2))}`);
const corr = (() => {
  const a = test.map((r) => r.ours),
    b = test.map((r) => r.close);
  const ma = a.reduce((s, v) => s + v, 0) / a.length,
    mb = b.reduce((s, v) => s + v, 0) / b.length;
  let sab = 0,
    saa = 0,
    sbb = 0;
  for (let i = 0; i < a.length; i++) ((sab += (a[i] - ma) * (b[i] - mb)), (saa += (a[i] - ma) ** 2), (sbb += (b[i] - mb) ** 2));
  return sab / Math.sqrt(saa * sbb);
})();
say(`correlation of our margin with the close: ${corr.toFixed(3)}; mean |ours - close| ${r2(test.reduce((a, r) => a + Math.abs(r.ours - r.close), 0) / test.length)} pts`);
for (const t of [1, 2, 3])
  say(
    `  |ours - close| >= ${t}: ${test.filter((r) => Math.abs(r.ours - r.close) >= t).length} of ${test.length} (${((100 * test.filter((r) => Math.abs(r.ours - r.close) >= t).length) / test.length).toFixed(1)}%)`,
  );

/** W-L-P, win rate, units at -110, z against 52.38%. `m` is the cover margin from our side. */
function ats(ms: number[]): string {
  const w = ms.filter((m) => m > 0).length,
    l = ms.filter((m) => m < 0).length,
    p = ms.length - w - l;
  const n = w + l;
  const pct = n ? w / n : 0;
  const z = n ? (pct - 0.5238) / Math.sqrt((0.5238 * 0.4762) / n) : 0;
  return `${w}-${l}-${p} ${(100 * pct).toFixed(1)}% ${(w * (100 / 110) - l).toFixed(1)}u z ${z.toFixed(2)}`;
}
say(`\nAgainst the close (side = ours vs nflverse spread_line):`);
for (const t of [0, 1, 1.5, 2, 3]) {
  const pick = test.filter((r) => Math.abs(r.ours - r.close) >= t && r.ours !== r.close);
  say(`  edge >= ${t}: ${ats(pick.map((r) => (r.ours > r.close ? 1 : -1) * (r.y - r.close)))}`);
}
say(`by season, edge >= 2:`);
for (let S = 2020; S <= 2026; S++) {
  const pick = test.filter((r) => r.g.season === S && Math.abs(r.ours - r.close) >= 2);
  say(`  ${S}: ${ats(pick.map((r) => (r.ours > r.close ? 1 : -1) * (r.y - r.close)))}`);
}

// CLV from the open, 2026 only: ESPN keeps DraftKings' open and close on finished games this season.
const ESPN = ".cache/nfl/espn-open-close-2026.json";
const lines: { [game: string]: { open: number | null; close: number | null } } = existsSync(ESPN) ? JSON.parse(readFileSync(ESPN, "utf8")) : {};
for (const r of test.filter((r) => r.g.season === 2026)) {
  if (lines[r.g.id] || !espnId.get(r.g.id)) continue;
  try {
    const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${espnId.get(r.g.id)}`, { signal: AbortSignal.timeout(15_000) });
    const s = res.ok ? parseSummary(await res.json()) : null;
    if (s) lines[r.g.id] = { open: s.open, close: s.close };
  } catch {
    // skip the game
  }
}
writeFileSync(ESPN, JSON.stringify(lines));
function clvReport(test: (Row & { ours: number })[], title: string) {
  const clvRows = test
    .filter((r) => r.g.season === 2026 && lines[r.g.id]?.open != null && lines[r.g.id]?.close != null)
    .map((r) => ({
      ...r,
      open: lines[r.g.id].open!,
      dkClose: lines[r.g.id].close!,
    }));
  say(`\nCLV from the open, 2026 (DraftKings via ESPN, ${clvRows.length} games; history before 2026 has no opener on file, skipped), ${title}:`);
  for (const t of [0, 1, 1.5, 2, 3]) {
    // open is a home spread; the market's expected home margin is -open.
    const pick = clvRows.filter((r) => Math.abs(r.ours + r.open) >= t && r.ours + r.open !== 0);
    const side = (r: (typeof pick)[number]) => (r.ours + r.open > 0 ? "home" : "away");
    const clv = pick.map((r) => clvPoints(side(r), r.open, r.dkClose));
    const n = clv.length;
    const mean = n ? clv.reduce((a, v) => a + v, 0) / n : 0;
    const sd = n > 1 ? Math.sqrt(clv.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1)) : 0;
    const tStat = sd ? mean / (sd / Math.sqrt(n)) : 0;
    const atsOpen = ats(pick.map((r) => (side(r) === "home" ? 1 : -1) * (r.y - -r.open)));
    say(
      `  |ours - open| >= ${t}: ${n} games, line moved our way ${clv.filter((v) => v > 0).length}, against ${clv.filter((v) => v < 0).length}, no move ${clv.filter((v) => v === 0).length}; avg CLV ${mean.toFixed(2)} pts, t ${tStat.toFixed(2)}; ATS at the open ${atsOpen}`,
    );
  }
}
clvReport(test, "ratings from every earlier day");
// The opener is often posted a week or more ahead, before the previous week's
// games. Ratings that saw those games would "predict" a move the market made
// on the same news. So again with ratings from plays 6+ and 8+ days before kickoff (8+ leaves out the previous week).
for (const lag of [6, 8]) {
  const lagged = rowsFor(H.prior, H.carry, H.wp, lag);
  const k = fitK(lagged.filter((r) => r.g.season >= 2007 && r.g.season < 2026));
  const t = lagged.filter((r) => r.g.season === 2026).map((r) => ({ ...r, ours: powerMargin(r.x, full(k, H)) }));
  clvReport(t, `ratings from plays ${lag}+ days before kickoff only`);
}
// nflverse's QB ids on a finished game are who actually started, which the
// opener may not have known (an injury the line then moved on). The strictest
// read: plays 8+ days back and the QB term off.
{
  const lagged = rowsFor(H.prior, H.carry, H.wp, 8).map((r) => ({ ...r, x: { ...r.x, qb: 0 } }));
  const k = fitK(lagged.filter((r) => r.g.season >= 2007 && r.g.season < 2026));
  clvReport(
    lagged.filter((r) => r.g.season === 2026).map((r) => ({ ...r, ours: powerMargin(r.x, full(k, H)) })),
    "plays 8+ days before kickoff, no QB term",
  );
}

// Benchmark: a line with no play by play at all, the market's own rating from
// past closing lines (spread.ts "mkt", leak-free). If it earns the same CLV,
// the opener is just old (ESPN's DraftKings "open" looks like the line first
// posted, for later weeks months ahead), and CLV from it says little.
clvReport(
  test.filter((r) => r.g.season === 2026).map((r) => ({ ...r, ours: r.close - ctx.get(r.g.id)!.x.move })),
  "BENCHMARK: market rating from past closes only, no play by play",
);
{
  const m = test.filter((r) => r.g.season === 2026 && lines[r.g.id]?.open != null && lines[r.g.id]?.close != null);
  const byWeek = new Map<number, number[]>();
  for (const r of m) byWeek.set(r.g.week, [...(byWeek.get(r.g.week) ?? []), Math.abs(lines[r.g.id].open! - lines[r.g.id].close!)]);
  say(
    `\naverage |open - close| by 2026 week: ${[...byWeek]
      .sort(([a], [b]) => a - b)
      .map(([w, v]) => `wk${w} ${(v.reduce((a, x) => a + x, 0) / v.length).toFixed(2)}`)
      .join(", ")}`,
  );
}

// 4. Final constants on everything to date; 2025's final ratings seed 2026.
const kFinal = fitK(rows);
let last2025: Map<string, Rating> | null = null;
for (const s of ratingsByDay(agg[String(H.wp)], H.prior, H.carry)) if ("final" in s && s.season === 2025) last2025 = s.final;
const P = full(kFinal, H);
say(`\nfinal constants (2007-2026, ${rows.length} games): hfa ${r2(P.hfa)}, kPass ${r2(P.kPass)}, kRush ${r2(P.kRush)}, kRest ${r2(P.kRest)}, kQb ${r2(P.kQb)}`);
const round = (v: number) => Math.round(v * 1e4) / 1e4;
writeFileSync(
  "src/lib/models/nfl/power-params.json",
  JSON.stringify(
    {
      prior: P.prior,
      carry: P.carry,
      wp: P.wp,
      hfa: round(P.hfa),
      kPass: round(P.kPass),
      kRush: round(P.kRush),
      kRest: round(P.kRest),
      kQb: round(P.kQb),
      last: { season: 2025, ratings: packRatings(last2025!) },
    },
    null,
    2,
  ) + "\n",
);
say(`runtime ${((Date.now() - t0) / 1000).toFixed(1)} s`);
writeFileSync(".cache/fit-nfl-power.txt", log.join("\n") + "\n");
