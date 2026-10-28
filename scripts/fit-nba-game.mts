// Walk-forward fit and test of the NBA game model (src/lib/models/nba/game.ts).
//
// Seasons: 2023-24 warms the team ratings (results only), 2024-25 trains
// (ESPN BET open/close), 2025-26 tests (DraftKings open/close, ESPN BET where
// DK is missing). Every game's features use only games before its Eastern
// date. Who played stands in for the pregame injury report, as in the props fit.
//
// 1. Rating constants: margin and total squared error on 2024-25 results (no lines).
// 2. Ridge weights on the residual (actual minus market), lambda chosen on a
//    2024-25 time split, refit on all of 2024-25, judged on 2025-26 at the close.
// 3. The open: do our leans at the opening number get line move (CLV) by the close?
//
//   npx tsx --tsconfig scripts/tsconfig.json scripts/fit-nba-game.mts
// Needs .cache/nba/2023-2025 (nba-history.mts) and .cache/nba-lines/2024-2025 (nba-lines-history.mts).
//   ... scripts/fit-nba-game.mts --refit [--dry]   weekly refit (scripts/refit/common.mts):
//   S = latest season with 300+ games; S-2 warms, S-1 plus S before its last
//   28 days trains, those 28 days test; projections from the live nba-props
//   settings. Stores the refit only if the per-game residual error (spread
//   over 13.5^2 plus total over 19^2, against the close) beats live by 2+ SE.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import DEFAULTS from "../src/lib/models/nba/game-params.json";
import { REFIT, latestSeason, liveParams, paired, submit, windowStart } from "./refit/common.mjs";
import type { NbaGame } from "../src/lib/models/nba/box";
import { summarize, RunningSeason, type SeasonSummary } from "../src/lib/models/nba/history";
import { projectGame, type NbaParams, type PlayerInput } from "../src/lib/models/nba/props";
import type { OpenClose } from "../src/lib/models/nba/game-lines";
import { fitRidge } from "../src/lib/models/nfl/spread";
import {
  GameRatings,
  SPREAD_FEATURES,
  TOTAL_FEATURES,
  etDay,
  type GameParams,
  type GameRatingParams,
  type SpreadX,
  type TotalX,
} from "../src/lib/models/nba/game";
import PROPS from "../src/lib/models/nba/params.json";

const PP = REFIT ? await liveParams("nba-props", PROPS as NbaParams) : (PROPS as NbaParams);
const load = (s: number): NbaGame[] =>
  readdirSync(`.cache/nba/${s}`)
    .map((f) => JSON.parse(readFileSync(`.cache/nba/${s}/${f}`, "utf8")) as NbaGame)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
const lines = (s: number, id: string): OpenClose | null => (existsSync(`.cache/nba-lines/${s}/${id}.json`) ? JSON.parse(readFileSync(`.cache/nba-lines/${s}/${id}.json`, "utf8")) : null);

const S = REFIT ? latestSeason(Object.fromEntries(readdirSync(".cache/nba").map((d) => [Number(d), readdirSync(`.cache/nba/${d}`).length])), 300) : 2025;
const SEASONS = [S - 2, S - 1, S];
const games = Object.fromEntries(SEASONS.map((s) => [s, load(s)])) as { [s: number]: NbaGame[] };
const log: string[] = [];
const say = (s: string) => {
  console.log(s);
  log.push(s);
};

// Availability: each side's projected points with tonight's players minus with its full recent rotation.
const avail = new Map<string, { home: number; away: number }>();
for (const s of [S - 1, S]) {
  const prior: SeasonSummary = summarize(games[s - 1]);
  const run = new RunningSeason();
  for (const g of games[s]) {
    const players = g.players.map((l) => run.player(l.id, l.team, l.pos, prior));
    const teams = Object.fromEntries([g.home, g.away].map((t) => [t, run.team(t, prior)]));
    const played = new Set(g.players.map((l) => l.id));
    const absent: PlayerInput[] = [g.home, g.away].flatMap((t) => run.rotation(t).filter((id) => !played.has(id)).map((id) => run.player(id, t, "", prior)));
    const sum = (ps: { team: string; mean: { pts: number } }[], t: string) => ps.filter((x) => x.team === t).reduce((a, x) => a + x.mean.pts, 0);
    const now = projectGame(players, teams, g.spread, prior.base, PP, absent);
    const full = projectGame([...players, ...absent], teams, g.spread, prior.base, PP, []);
    avail.set(g.id, { home: sum(now, g.home) - sum(full, g.home), away: sum(now, g.away) - sum(full, g.away) });
    run.add(g);
  }
}

interface Row {
  season: number;
  id: string;
  date: string;
  margin: number;
  pts: number;
  l: OpenClose;
  /** Features against the close and against the open. */
  close: { spread: SpreadX; total: TotalX };
  open: { spread: SpreadX; total: TotalX } | null;
  rating: { margin: number; total: number };
}

/** Walk every season in order; rows for games with lines. Each Eastern day's features before its results. */
function build(p: GameRatingParams): { rows: Row[]; err: { m: number; t: number; n: number }; ratings: GameRatings } {
  const r = new GameRatings(p);
  const rows: Row[] = [];
  let em = 0;
  let et = 0;
  let n = 0;
  for (const s of SEASONS) {
    r.newSeason(String(s));
    const gs = games[s];
    for (let i = 0; i < gs.length; ) {
      const day = etDay(gs[i].date);
      let j = i;
      while (j < gs.length && etDay(gs[j].date) === day) j++;
      const today = gs.slice(i, j);
      const ls = today.map((g) => (s === S - 2 ? null : lines(s, g.id)));
      today.forEach((g, k) => {
        const margin = g.score[g.home] - g.score[g.away];
        const pts = g.score[g.home] + g.score[g.away];
        const e = r.expect(g.home, g.away);
        if (s === S - 1) {
          em += (e.margin - margin) ** 2;
          et += (e.total - pts) ** 2;
          n++;
        }
        const l = ls[k];
        if (!l || l.close.spread === null || l.close.total === null) return;
        const av = avail.get(g.id) ?? { home: 0, away: 0 };
        const fc = r.features(g, l.close.spread, l.close.total, l.open, av);
        const fo = l.open.spread !== null && l.open.total !== null ? r.features(g, l.open.spread, l.open.total, l.open, av) : null;
        rows.push({ season: s, id: g.id, date: g.date, margin, pts, l, close: { spread: fc.spread, total: fc.total }, open: fo ? { spread: fo.spread, total: fo.total } : null, rating: fc.rating });
      });
      today.forEach((g, k) => r.add(g, ls[k]?.close.spread ?? null));
      i = j;
    }
  }
  return { rows, err: { m: em / n, t: et / n, n }, ratings: r };
}

// 1. Rating constants on 2024-25 results.
let RP: GameRatingParams = { ppp0: 114, pace0: 99, hfa: 2.5, k: 0.05, kPace: 0.05, carry: 0.6 };
{
  let best = { e: Infinity, p: RP };
  for (const hfa of [1, 2, 3, 4])
    for (const k of [0.02, 0.03, 0.05, 0.07, 0.1])
      for (const kPace of [0.02, 0.05, 0.1])
        for (const carry of [0.3, 0.5, 0.7, 0.9]) {
          const p = { ...RP, hfa, k, kPace, carry };
          const { err } = build(p);
          // Margin and total weigh the same (each over its own scale, about 13.5 and 19 pts).
          const e = err.m / 13.5 ** 2 + err.t / 19 ** 2;
          if (e < best.e) best = { e, p };
        }
  RP = best.p;
  const { err } = build(RP);
  say(`ratings: hfa ${RP.hfa}/100 poss, k ${RP.k}, kPace ${RP.kPace}, carry ${RP.carry}; ${S - 1} results RMSE margin ${Math.sqrt(err.m).toFixed(2)}, total ${Math.sqrt(err.t).toFixed(2)} (${err.n} games)`);
}

const { rows, ratings: END } = build(RP);
// Refit: the held-out window is the latest season's last 28 days; everything before it trains.
const SPLIT = REFIT ? windowStart(games[S].map((g) => g.date), 28) : "9";
const train = rows.filter((r) => r.season === S - 1 || (REFIT && r.season === S && r.date < SPLIT));
const test = rows.filter((r) => r.season === S && (!REFIT || r.date >= SPLIT));
say(`rows with lines: train ${train.length}, test ${test.length} (season ${S}${REFIT ? ` from ${SPLIT}` : ""})`);

type Market = "spread" | "total";
const KEYS = { spread: SPREAD_FEATURES, total: TOTAL_FEATURES } as const;
const lineOf = (r: Row, m: Market, at: "close" | "open") => (m === "spread" ? -(r.l[at].spread as number) : (r.l[at].total as number));
const actual = (r: Row, m: Market) => (m === "spread" ? r.margin : r.pts);
const xOf = (r: Row, m: Market, at: "close" | "open") => (r[at] as { spread: SpreadX; total: TotalX })[m] as Record<string, number>;
const fit = (rs: Row[], m: Market, lambda: number) =>
  fitRidge(
    rs.map((r) => ({ x: xOf(r, m, "close"), y: actual(r, m) - lineOf(r, m, "close") })),
    lambda,
    KEYS[m] as readonly string[],
  );
const pred = (w: { w: Record<string, number>; b: number }, x: Record<string, number>) => w.b + Object.keys(w.w).reduce((a, k) => a + w.w[k] * x[k], 0);

// 2. Lambda per market on a time split of 2024-25 (first 60% fits, last 40% judges).
const cut = train[Math.floor(train.length * 0.6)].date;
const params: Partial<GameParams> = { rating: RP };
const strong: { [m in Market]: number } = { spread: 0, total: 0 };
for (const m of ["spread", "total"] as Market[]) {
  const a = train.filter((r) => r.date < cut);
  const b = train.filter((r) => r.date >= cut);
  const lineMse = b.reduce((s, r) => s + (actual(r, m) - lineOf(r, m, "close")) ** 2, 0) / b.length;
  let best = { e: Infinity, lambda: 0 };
  for (const lambda of [1, 10, 100, 300, 1000, 3000, 10000, 1e5]) {
    const w = fit(a, m, lambda);
    const e = b.reduce((s, r) => s + (actual(r, m) - lineOf(r, m, "close") - pred(w, xOf(r, m, "close"))) ** 2, 0) / b.length;
    if (e < best.e) best = { e, lambda };
  }
  const w = fit(train, m, best.lambda);
  const res = train.map((r) => Math.abs(pred(w, xOf(r, m, "close")))).sort((x, y) => x - y);
  strong[m] = Math.round(res[Math.floor(res.length * 0.7)] * 100) / 100;
  (params as Record<string, unknown>)[m] = { w: Object.fromEntries(Object.entries(w.w).map(([k, v]) => [k, Math.round(v * 1e4) / 1e4])), b: Math.round(w.b * 1e4) / 1e4 };
  say(`${m}: lambda ${best.lambda} (split MSE ${best.e.toFixed(2)} vs line ${lineMse.toFixed(2)}); weights ${Object.entries(w.w).map(([k, v]) => `${k} ${v.toFixed(3)}`).join(", ")}, b ${w.b.toFixed(2)}; strong at |res| ${strong[m]}+`);
}
const GP = { ...params, strongSpread: strong.spread } as GameParams;

if (REFIT) {
  const live = await liveParams("nba-game", DEFAULTS as unknown as GameParams);
  const perGame = (gp: GameParams) => {
    const rs = build(gp.rating).rows.filter((r) => r.season === S && r.date >= SPLIT);
    const err = (r: Row, m: Market, scale: number) => {
      const w = gp[m] as { w: Record<string, number>; b: number };
      return (actual(r, m) - lineOf(r, m, "close") - pred(w, xOf(r, m, "close"))) ** 2 / scale ** 2;
    };
    return new Map(rs.map((r) => [r.id, err(r, "spread", 13.5) + err(r, "total", 19)]));
  };
  const a = perGame(live);
  const b = perGame(GP);
  const ids = [...a.keys()].filter((id) => b.has(id));
  await submit("nba-game", DEFAULTS as unknown as GameParams, GP, paired(ids.map((id) => a.get(id)!), ids.map((id) => b.get(id)!), `residual error per game at the close, ${S} from ${SPLIT}`));
  process.exit(0);
}

// 3. Test.
const pct = (w: number, l: number) => (w + l ? `${((100 * w) / (w + l)).toFixed(1)}%` : "·");
const tstat = (xs: number[]) => {
  const n = xs.length;
  const mu = xs.reduce((a, x) => a + x, 0) / n;
  const sd = Math.sqrt(xs.reduce((a, x) => a + (x - mu) ** 2, 0) / (n - 1));
  return { mu, t: mu / (sd / Math.sqrt(n)), n };
};
function judge(label: string, rs: Row[]) {
  say(`\n${label}`);
  for (const m of ["spread", "total"] as Market[]) {
    const w = { w: (GP[m] as { w: Record<string, number> }).w, b: (GP[m] as { b: number }).b };
    const res = (r: Row, at: "close" | "open") => pred(w, xOf(r, m, at));
    const line = rs.reduce((s, r) => s + (actual(r, m) - lineOf(r, m, "close")) ** 2, 0) / rs.length;
    const ours = rs.reduce((s, r) => s + (actual(r, m) - lineOf(r, m, "close") - res(r, "close")) ** 2, 0) / rs.length;
    const rating = rs.reduce((s, r) => s + (actual(r, m) - (m === "spread" ? r.rating.margin : r.rating.total)) ** 2, 0) / rs.length;
    say(`${m}: RMSE line ${Math.sqrt(line).toFixed(3)}, ours ${Math.sqrt(ours).toFixed(3)} (${(100 * (1 - ours / line)).toFixed(2)}% better MSE), rating alone ${Math.sqrt(rating).toFixed(3)}`);
    const record = (at: "close" | "open", minRes: number, lean: (r: Row) => number) => {
      let W = 0;
      let L = 0;
      for (const r of rs) {
        if (at === "open" && !r.open) continue;
        const v = lean(r);
        if (v === 0 || Math.abs(v) < minRes) continue;
        const d = actual(r, m) - lineOf(r, m, at);
        if (d === 0) continue;
        if (Math.sign(d) === Math.sign(v)) W++;
        else L++;
      }
      return `${W}-${L} ${pct(W, L)}`;
    };
    const s = strong[m];
    const gapKey = m === "spread" ? "gap" : "gapT";
    say(`  at close: lean ${record("close", 0, (r) => res(r, "close"))}, strong ${record("close", s, (r) => res(r, "close"))}, rating gap alone ${record("close", 0, (r) => xOf(r, m, "close")[gapKey])}`);
    say(`  at open:  lean ${record("open", 0, (r) => res(r, "open"))}, strong ${record("open", s, (r) => res(r, "open"))}`);
    // CLV: points the close moved toward our lean at the open (home margin / over terms).
    // The same at the open with availability left out: who played is not always known when a line opens.
    if (m === "spread") {
      const noAv = (r: Row) => res(r, "open") - w.w.avail * r.open!.spread.avail;
      say(`  at open, no availability term: lean ${record("open", 0, noAv)}, strong ${record("open", s, noAv)}`);
      for (const [lbl, min] of [["lean", 0], ["strong", s]] as const) {
        const clv = rs.filter((r) => r.open && noAv(r) !== 0 && Math.abs(noAv(r)) >= min).map((r) => Math.sign(noAv(r)) * (lineOf(r, m, "close") - lineOf(r, m, "open")));
        const t = tstat(clv);
        say(`  open->close move toward our ${lbl}, no availability: ${t.mu >= 0 ? "+" : ""}${t.mu.toFixed(3)} pts (t ${t.t.toFixed(2)}, n ${t.n})`);
      }
      for (const f of ["gap", "rest", "b2b", "cover"] as const) {
        const rows2 = rs.filter((r) => r.open && r.open.spread[f] !== 0);
        const sgn = Math.sign(w.w[f]);
        const clv = rows2.map((r) => sgn * Math.sign(r.open!.spread[f]) * (lineOf(r, m, "close") - lineOf(r, m, "open")));
        let W = 0, L = 0;
        for (const r of rows2) {
          const d = actual(r, m) - lineOf(r, m, "open");
          if (!d) continue;
          if (Math.sign(d) === sgn * Math.sign(r.open!.spread[f])) W++;
          else L++;
        }
        const t = tstat(clv);
        say(`    ${f} alone at open: ${W}-${L} ${pct(W, L)}, move ${t.mu.toFixed(3)} (t ${t.t.toFixed(2)}, n ${t.n})`);
      }
    }
    for (const [lbl, min] of [["lean", 0], ["strong", s]] as const) {
      const clv = rs
        .filter((r) => r.open && res(r, "open") !== 0 && Math.abs(res(r, "open")) >= min)
        .map((r) => Math.sign(res(r, "open")) * (lineOf(r, m, "close") - lineOf(r, m, "open")));
      const t = tstat(clv);
      say(`  open->close move toward our ${lbl}: ${t.mu >= 0 ? "+" : ""}${t.mu.toFixed(3)} pts (t ${t.t.toFixed(2)}, n ${t.n})`);
    }
  }
}
judge("TEST 2025-26 (walk forward: weights from 2024-25 only)", test);
judge("2024-25 (in sample, for reference)", train);
// A single-feature look at availability against the open: does the market finish pricing absences after it opens?
{
  const av = test.filter((r) => r.open && Math.abs(r.open.spread.avail) >= 3);
  const clv = av.map((r) => Math.sign(r.open!.spread.avail) * (-(r.l.close.spread as number) - -(r.l.open.spread as number)));
  const t = tstat(clv);
  say(`\n2025-26, avail gap 3+ pts at the open: close moved toward the healthier side ${t.mu.toFixed(2)} pts (t ${t.t.toFixed(2)}, n ${t.n}). (Who played is known here; live, the injury report may be later than the open.)`);
}

writeFileSync("src/lib/models/nba/game-params.json", JSON.stringify(GP, null, 2) + "\n");
// Where the ratings stood after 2025-26, for the live model to carry into 2026-27.
const r4 = (m: Map<string, number>) => Object.fromEntries([...m].map(([k, v]) => [k, Math.round(v * 1e4) / 1e4]));
writeFileSync("src/lib/models/nba/game-seed.json", JSON.stringify({ season: END.season, lg: END.lg, lgPace: END.lgPace, off: r4(END.off), def: r4(END.def), pace: r4(END.pace) }, null, 2) + "\n");
writeFileSync(".cache/fit-nba-game.txt", log.join("\n") + "\n");
console.log("\nwrote src/lib/models/nba/game-params.json");
