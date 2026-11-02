// Fits and tests our college basketball model (src/lib/models/cbb/model.ts).
//
// Data from scripts/cbb-history.mts (.cache/cbb/): ESPN Division I finals for
// 2023-24, 2024-25 and 2025-26, DraftKings opening and closing lines for the
// last two, and T-Rank's line at the time of each 2025-26 game.
//
// Walk forward, a whole day projected before any of its results:
//   ratings constants   fit on 2024-25 (2023-24 warms them up)
//   blend weights       fit on 2025-26 before Jan 15
//   judged on           2025-26 from Jan 15 on, which neither fit saw
//
// Reported on the judged games: margin and total error for ours, T-Rank, the
// blend and the closing line; against-the-spread and over/under records
// betting the blend's side at the opener and at the close by edge size; and
// how far the line moved toward the blend from open to close. Writes
// src/lib/models/cbb/params.json and src/lib/models/cbb/backtest.json (the
// Research tab reads it) and research/fit-cbb.txt.
//
//   npx tsx --tsconfig scripts/tsconfig.json scripts/fit-cbb.mts
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { CbbRatings, phi, type CbbFinal, type CbbParams, type RatingParams } from "../src/lib/models/cbb/model";
import { matchTorvik, type TorvikGame } from "../src/lib/models/cbb/torvik";

const DIR = ".cache/cbb";
const games = JSON.parse(readFileSync(`${DIR}/games.json`, "utf8")) as CbbFinal[];
const names = JSON.parse(readFileSync(`${DIR}/names.json`, "utf8")) as { [id: string]: string };
const log: string[] = [];
const say = (s: string) => {
  console.log(s);
  log.push(s);
};
const ET = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });
const etDate = (iso: string) => ET.format(new Date(iso));
const mean = (xs: number[]) => xs.reduce((a, x) => a + x, 0) / (xs.length || 1);
const rmse = (xs: number[]) => Math.sqrt(mean(xs.map((x) => x * x)));
const sd = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};
const r2 = (x: number) => Math.round(x * 100) / 100;
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const SPLIT = "2026-01-15";

say(`finals: ${games.length} (${[2023, 2024, 2025].map((s) => `${s}-${String(s + 1).slice(2)} ${games.filter((g) => g.season === s).length}`).join(", ")})`);

// ---- T-Rank's line at the time, matched to ESPN games by date and teams.
const trank = new Map<string, { margin: number; total: number }>();
for (const season of [2025, 2026]) {
  const f = `${DIR}/torvik-${season}-games.json`;
  if (!existsSync(f)) continue;
  const sked = JSON.parse(readFileSync(f, "utf8")) as TorvikGame[];
  const { map, unmatched } = matchTorvik([...new Set(sked.flatMap((g) => [g.home, g.away]))], names);
  const byKey = new Map<string, CbbFinal>();
  for (const g of games) byKey.set(`${etDate(g.tip)}|${g.home}|${g.away}`, g);
  let hit = 0;
  for (const t of sked) {
    const h = map.get(t.home);
    const a = map.get(t.away);
    if (!h || !a) continue;
    // Torvik and ESPN can disagree on the date by one (late tips) and, at neutral sites, on who is home.
    for (const d of [t.date, new Date(Date.parse(t.date) + 86_400_000).toISOString().slice(0, 10), new Date(Date.parse(t.date) - 86_400_000).toISOString().slice(0, 10)]) {
      const g = byKey.get(`${d}|${h}|${a}`);
      const r = byKey.get(`${d}|${a}|${h}`);
      if (g) {
        trank.set(g.id, { margin: t.pred.home - t.pred.away, total: t.pred.home + t.pred.away });
        hit++;
        break;
      }
      if (r) {
        trank.set(r.id, { margin: t.pred.away - t.pred.home, total: t.pred.home + t.pred.away });
        hit++;
        break;
      }
    }
  }
  say(`torvik ${season}: ${sked.length} games, ${hit} matched to ESPN; ${unmatched.length} Torvik names unmatched (mostly non-D1): ${unmatched.slice(0, 40).join(", ")}`);
}

// ---- Walk forward: each game's projection from the ratings before its date.
interface Row {
  g: CbbFinal;
  ours: { margin: number; total: number };
  n: { home: number; away: number };
}
function walk(p: RatingParams, upto = "9999"): Row[] {
  const r = new CbbRatings(p);
  const sorted = [...games].sort((a, b) => a.tip.localeCompare(b.tip) || a.id.localeCompare(b.id));
  const out: Row[] = [];
  let i = 0;
  while (i < sorted.length) {
    const day = etDate(sorted[i].tip);
    let j = i;
    while (j < sorted.length && etDate(sorted[j].tip) === day) j++;
    if (day > upto) break;
    for (const g of sorted.slice(i, j)) {
      r.newSeason(g.season);
      out.push({ g, ours: r.project(g.home, g.away, g.neutral), n: { home: r.games.get(g.home) ?? 0, away: r.games.get(g.away) ?? 0 } });
    }
    for (const g of sorted.slice(i, j)) r.add(g);
    i = j;
  }
  return out;
}
const margin = (g: CbbFinal) => g.homeScore - g.awayScore;
const total = (g: CbbFinal) => g.homeScore + g.awayScore;
const lossOf = (rows: Row[]) => {
  const tr = rows.filter((x) => x.g.season === 2024);
  return { m: rmse(tr.map((x) => margin(x.g) - x.ours.margin)), t: rmse(tr.map((x) => total(x.g) - x.ours.total)) };
};

// ---- Ratings constants: coordinate search on 2024-25.
let best: RatingParams = { hfa: 3, hfaTotal: 0, k0: 0.5, kMin: 0.15, halfGames: 6, cap: 25, carry: 0.6, avg0: 72 };
const score = (p: RatingParams) => {
  const l = lossOf(walk(p, "2025-04-15"));
  return l.m * l.m + l.t * l.t * 0.5;
};
let bestScore = score(best);
const GRID: { [k in keyof RatingParams]?: number[] } = {
  hfa: [2.5, 3, 3.5, 4, 4.5, 5, 5.5],
  hfaTotal: [0, 1, 2, 3, 4, 5],
  k0: [0.4, 0.55, 0.7, 0.85, 1],
  kMin: [0.02, 0.03, 0.045, 0.06, 0.08, 0.1],
  halfGames: [3, 4, 6, 8, 12],
  cap: [25, 35, 45, 60, 80],
  carry: [0.7, 0.8, 0.9, 0.95, 1],
};
for (let pass = 0; pass < 3; pass++) {
  for (const [k, vals] of Object.entries(GRID) as [keyof RatingParams, number[]][]) {
    for (const v of vals) {
      const p = { ...best, [k]: v };
      const sc = score(p);
      if (sc < bestScore - 1e-6) {
        best = p;
        bestScore = sc;
      }
    }
  }
  say(`pass ${pass + 1}: ${JSON.stringify(best)} loss ${r3(bestScore)}`);
}

// ---- Everything walked with the chosen constants.
const all = walk(best);
const train = lossOf(all);
say(`2024-25 (fit): our margin RMSE ${r2(train.m)}, total RMSE ${r2(train.t)}`);

const s26 = all.filter((x) => x.g.season === 2025);
const withT = s26.filter((x) => trank.has(x.g.id));
const blendFit = withT.filter((x) => etDate(x.g.tip) < SPLIT);
const judged = withT.filter((x) => etDate(x.g.tip) >= SPLIT);
say(`2025-26: ${s26.length} finals, ${withT.length} with T-Rank's line; blend fit on ${blendFit.length} before ${SPLIT}, judged on ${judged.length} after`);

// Blend weight by grid on the fit half: w on ours, 1-w on T-Rank.
const bestW = (f: (x: Row) => number, a: (x: Row) => number, b: (x: Row) => number) => {
  let bw = 0;
  let be = Infinity;
  for (let w = 0; w <= 1.0001; w += 0.05) {
    const e = rmse(blendFit.map((x) => f(x) - (w * a(x) + (1 - w) * b(x))));
    if (e < be) {
      be = e;
      bw = w;
    }
  }
  return Math.round(bw * 100) / 100;
};
const wm = bestW((x) => margin(x.g), (x) => x.ours.margin, (x) => trank.get(x.g.id)!.margin);
const wt = bestW((x) => total(x.g), (x) => x.ours.total, (x) => trank.get(x.g.id)!.total);
const biasT = r2(mean(blendFit.map((x) => total(x.g) - (wt * x.ours.total + (1 - wt) * trank.get(x.g.id)!.total))));
say(`blend: margin ${wm} ours / ${r2(1 - wm)} T-Rank; total ${wt} ours / ${r2(1 - wt)} T-Rank, bias ${biasT}`);
const bm = (x: Row) => wm * x.ours.margin + (1 - wm) * trank.get(x.g.id)!.margin;
const bt = (x: Row) => wt * x.ours.total + (1 - wt) * trank.get(x.g.id)!.total + biasT;

// T-Rank's own home edge: its line already has one; ours is fit above.
// Sigmas from the blend's fit half too, so the judged games' win chances never saw their own results.
const sigma = r2(sd(blendFit.map((x) => margin(x.g) - bm(x))));
const sigmaTotal = r2(sd(blendFit.map((x) => total(x.g) - bt(x))));

// ---- Accuracy on the judged games.
const priced = judged.filter((x) => x.g.line?.close.spread !== null && x.g.line?.close.spread !== undefined);
const acc = {
  games: judged.length,
  priced: priced.length,
  margin: {
    ours: r2(rmse(judged.map((x) => margin(x.g) - x.ours.margin))),
    trank: r2(rmse(judged.map((x) => margin(x.g) - trank.get(x.g.id)!.margin))),
    blend: r2(rmse(judged.map((x) => margin(x.g) - bm(x)))),
    blendPriced: r2(rmse(priced.map((x) => margin(x.g) - bm(x)))),
    close: r2(rmse(priced.map((x) => margin(x.g) + x.g.line!.close.spread!))),
  },
  total: {
    ours: r2(rmse(judged.map((x) => total(x.g) - x.ours.total))),
    trank: r2(rmse(judged.map((x) => total(x.g) - trank.get(x.g.id)!.total))),
    blend: r2(rmse(judged.map((x) => total(x.g) - bt(x)))),
    blendPriced: r2(rmse(priced.filter((x) => x.g.line!.close.total !== null).map((x) => total(x.g) - bt(x)))),
    close: r2(rmse(priced.filter((x) => x.g.line!.close.total !== null).map((x) => total(x.g) - x.g.line!.close.total!))),
  },
};
say(`judged margin RMSE: ours ${acc.margin.ours}, T-Rank ${acc.margin.trank}, blend ${acc.margin.blend} (priced ${acc.margin.blendPriced}) vs closing line ${acc.margin.close}`);
say(`judged total RMSE: ours ${acc.total.ours}, T-Rank ${acc.total.trank}, blend ${acc.total.blend} (priced ${acc.total.blendPriced}) vs closing total ${acc.total.close}`);

// Straight up: the blend's winner, and its calibration.
const su = judged.map((x) => ({ p: phi(bm(x) / sigma), won: margin(x.g) > 0 ? 1 : 0 }));
const suHit = su.filter((x) => (x.p > 0.5) === (x.won === 1)).length;
const brier = mean(su.map((x) => (x.p - x.won) ** 2));
const bins = [0.5, 0.6, 0.7, 0.8, 0.9, 1.01].slice(0, -1).map((lo, i, a) => {
  const hi = [0.6, 0.7, 0.8, 0.9, 1.01][i];
  const fav = su.map((x) => (x.p >= 0.5 ? x : { p: 1 - x.p, won: 1 - x.won })).filter((x) => x.p >= lo && x.p < hi);
  void a;
  return { lo, hi: Math.min(hi, 1), games: fav.length, said: r3(mean(fav.map((x) => x.p))), won: r3(mean(fav.map((x) => x.won))) };
});
say(`straight up: ${suHit}/${su.length} (${r3(suHit / su.length)}) winners, Brier ${r3(brier)}`);
for (const b of bins) say(`  favorite ${b.lo}-${b.hi}: ${b.games} games, said ${b.said}, won ${b.won}`);

// ---- Against the line, by edge size.
type Mk = "spread" | "total";
function record(mk: Mk, at: "open" | "close", lo: number, hi = Infinity) {
  let w = 0;
  let l = 0;
  let p = 0;
  const moves: number[] = [];
  for (const x of priced) {
    const ln = x.g.line!;
    const line = mk === "spread" ? ln[at].spread : ln[at].total;
    if (line === null) continue;
    const ours = mk === "spread" ? bm(x) : bt(x);
    const edge = mk === "spread" ? ours + line : ours - line; // >0: home / over
    if (Math.abs(edge) < lo || Math.abs(edge) >= hi) continue;
    const side = Math.sign(edge);
    const res = mk === "spread" ? margin(x.g) + line : total(x.g) - line;
    const d = res * side;
    if (d > 0) w++;
    else if (d < 0) l++;
    else p++;
    const o = mk === "spread" ? ln.open.spread : ln.open.total;
    const c = mk === "spread" ? ln.close.spread : ln.close.total;
    if (at === "open" && o !== null && c !== null) moves.push(mk === "spread" ? (o - c) * side : (c - o) * side);
  }
  const n = w + l;
  const pct = n ? w / n : 0;
  const t = n ? (pct - 0.5) / Math.sqrt(0.25 / n) : 0;
  const mv = moves.length ? mean(moves) : null;
  const mvT = moves.length > 1 && mv !== null ? mv / (sd(moves) / Math.sqrt(moves.length)) : null;
  return { lo, hi: hi === Infinity ? null : hi, w, l, p, pct: r3(pct), units: r2(w * (100 / 110) - l), t: r2(t), move: mv === null ? null : r2(mv), moveT: mvT === null ? null : r2(mvT) };
}
const EDGES: [number, number][] = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 5],
  [5, Infinity],
  [0, Infinity],
];
const ats: { [k: string]: ReturnType<typeof record>[] } = {};
for (const mk of ["spread", "total"] as Mk[])
  for (const at of ["open", "close"] as const) {
    ats[`${mk}:${at}`] = EDGES.map(([lo, hi]) => record(mk, at, lo, hi));
    say(`${mk} at the ${at}, blend's side:`);
    for (const r of ats[`${mk}:${at}`]) say(`  edge ${r.lo}-${r.hi ?? "up"}: ${r.w}-${r.l}-${r.p} (${r.pct}), ${r.units}u, t ${r.t}${r.move !== null ? `, line moved our way ${r.move} pts (t ${r.moveT})` : ""}`);
  }

// Early season: our ratings' first 5 games for both teams vs later.
const early = (x: Row) => x.n.home < 5 || x.n.away < 5;
const s26priced = s26.filter((x) => x.g.line?.close.spread != null);
say(`2025-26 our margin RMSE, a side under 5 games: ${r2(rmse(s26priced.filter(early).map((x) => margin(x.g) - x.ours.margin)))} (close ${r2(rmse(s26priced.filter(early).map((x) => margin(x.g) + x.g.line!.close.spread!)))}), later ${r2(rmse(s26priced.filter((x) => !early(x)).map((x) => margin(x.g) - x.ours.margin)))} (close ${r2(rmse(s26priced.filter((x) => !early(x)).map((x) => margin(x.g) + x.g.line!.close.spread!)))})`);

// Home edge in the data: average home margin at non-neutral sites minus the ratings' gap is the fit's hfa; report the raw too.
const homeRaw = r2(mean(games.filter((g) => !g.neutral && g.season >= 2024).map(margin)));
say(`raw average home margin (non-neutral, 2024-26): ${homeRaw}`);

// Strong lean: the top 30% of |blend - market| on the fit half's priced games.
const fitPriced = blendFit.filter((x) => x.g.line?.close.spread != null);
const gaps = fitPriced.map((x) => Math.abs(bm(x) + x.g.line!.close.spread!)).sort((a, b) => a - b);
const tgaps = fitPriced.filter((x) => x.g.line!.close.total !== null).map((x) => Math.abs(bt(x) - x.g.line!.close.total!)).sort((a, b) => a - b);
const strong = r2(gaps[Math.floor(gaps.length * 0.7)] ?? 3);
const strongTotal = r2(tgaps[Math.floor(tgaps.length * 0.7)] ?? 4);

const params: CbbParams = {
  rating: { ...best },
  blend: { margin: { ours: wm, trank: r2(1 - wm) }, total: { ours: wt, trank: r2(1 - wt), b: biasT } },
  trank: { hfa: best.hfa },
  sigma,
  sigmaTotal,
  strong,
  strongTotal,
};
say(`sigma ${sigma}, sigmaTotal ${sigmaTotal}, strong spread lean ${strong}, strong total lean ${strongTotal}`);
writeFileSync("src/lib/models/cbb/params.json", JSON.stringify(params, null, 2) + "\n");
writeFileSync(
  "src/lib/models/cbb/backtest.json",
  JSON.stringify({ fitAt: new Date().toISOString().slice(0, 10), split: SPLIT, seasons: { ratings: "2024-25", blend: `2025-26 before ${SPLIT}`, judged: `2025-26 from ${SPLIT}` }, accuracy: acc, straightUp: { hit: suHit, games: su.length, brier: r3(brier), bins }, lines: ats, homeRaw }, null, 2) + "\n",
);
writeFileSync("research/fit-cbb.txt", log.join("\n") + "\n");

// ---- Seed for the live model: our ratings after 2025-26, with ESPN names for reading.
{
  const r = CbbRatings.from(best, games);
  const round = (m: Map<string, number>) => Object.fromEntries([...m].map(([k, v]) => [k, Math.round(v * 1000) / 1000]));
  writeFileSync("src/lib/models/cbb/seed.json", JSON.stringify({ season: r.season, avg: Math.round(r.avg * 1000) / 1000, off: round(r.off), def: round(r.def) }) + "\n");
  say(`seed: ${r.off.size} teams after ${r.season}-${String(r.season + 1).slice(2)}, league average ${r2(r.avg)}`);
}
