// Does weighting recent games help the NFL Anytime TD model? (Jack, 2026-11-08:
// Emanuel Wilson was Seattle's RB1, Zach Charbonnet may have taken over, and
// full-season shares notice that slowly.)
//
// Same cases as fit-anytime-td.mts (every 2024-2026 game with a line; the list
// is the team's last-3-games players who played). Each player's totals are now
// weighted: a game `k` team-weeks before this one counts h^k (h = 1 is today's
// model), and last season's totals count wPrev. For each (h, wPrev) the shrink
// kTd and calib are refit on train, then scored on the two test sets the fit
// uses (2025 weeks 10-18, 2026). Verdict: paired per-team-game log loss vs the
// h 1, wPrev 1 baseline fit the same way; ship only if both tests improve and
// 2026 by 2+ SE. Writes no files.
//
//   npx tsx --tsconfig scripts/tsconfig.json scripts/test-attd-recency.mts
import { existsSync, readFileSync } from "node:fs";
import ATTD from "../src/lib/models/nfl/attd-params.json";
import { readGames, readStats, type NflRow } from "../src/lib/models/nfl/data";
import { impliedPoints, type TdLine } from "../src/lib/models/nfl/firsttd";
import { attdTeam, type AttdLine, type AttdParams } from "../src/lib/models/nfl/anytime";

type Tot = Omit<TdLine, "team">;
const rows: { [s: number]: NflRow[] } = Object.fromEntries([2023, 2024, 2025, 2026].filter((s) => existsSync(`.cache/nfl/stats_player_week_${s}.csv`)).map((s) => [s, readStats(readFileSync(`.cache/nfl/stats_player_week_${s}.csv`, "utf8"))]));
const games = readGames(readFileSync(".cache/nfl/games.csv", "utf8"));
const K = ["rushTd", "recTd", "car", "tgt", "teamRushTd", "teamRecTd", "teamCar", "teamTgt"] as const;

/** tdTotals with each row (and its team's game totals) times weight(row). */
function weighted(rs: NflRow[], weight: (r: NflRow) => number): Map<string, Tot> {
  const team = new Map<string, { rushTd: number; recTd: number; car: number; tgt: number }>();
  for (const r of rs) {
    const t = team.get(`${r.game}|${r.team}`) ?? { rushTd: 0, recTd: 0, car: 0, tgt: 0 };
    t.rushTd += r.rushTd; t.recTd += r.recTd; t.car += r.car; t.tgt += r.tgt;
    team.set(`${r.game}|${r.team}`, t);
  }
  const out = new Map<string, Tot>();
  for (const r of rs) {
    const w = weight(r);
    const t = team.get(`${r.game}|${r.team}`)!;
    const x = out.get(r.id) ?? { id: r.id, name: r.name, rushTd: 0, recTd: 0, car: 0, tgt: 0, teamRushTd: 0, teamRecTd: 0, teamCar: 0, teamTgt: 0 };
    x.rushTd += w * r.rushTd; x.recTd += w * r.recTd; x.car += w * r.car; x.tgt += w * r.tgt;
    x.teamRushTd += w * t.rushTd; x.teamRecTd += w * t.recTd; x.teamCar += w * t.car; x.teamTgt += w * t.tgt;
    out.set(r.id, x);
  }
  return out;
}

interface Base { season: number; week: number; team: string; pts: number; ids: string[]; names: string[]; tds: number[]; before: NflRow[]; prev: NflRow[] }
const bases: Base[] = [];
for (const season of [2024, 2025, 2026]) {
  const cur = rows[season] ?? [];
  const prev = rows[season - 1] ?? [];
  const weeksDone = new Set(cur.map((r) => r.week));
  for (const g of games.filter((x) => x.season === season && weeksDone.has(x.week))) {
    if (g.total === null || g.homeMargin === null) continue;
    const inGame = cur.filter((r) => r.game === g.game);
    if (!inGame.length) continue;
    const before = cur.filter((r) => r.week < g.week);
    const pts = impliedPoints(g.total, g.homeMargin);
    for (const t of [g.home, g.away]) {
      const weeks = [...new Set(before.filter((r) => r.team === t).map((r) => r.week))].sort((a, b) => a - b).slice(-3);
      const pool = weeks.length
        ? before.filter((r) => r.team === t && weeks.includes(r.week))
        : (() => {
            const pw = [...new Set(prev.filter((r) => r.team === t).map((r) => r.week))].sort((a, b) => a - b).slice(-3);
            return prev.filter((r) => r.team === t && pw.includes(r.week));
          })();
      const here = new Map(inGame.filter((r) => r.team === t).map((r) => [r.id, r]));
      const ids = [...new Set(pool.map((r) => r.id))].filter((id) => here.has(id));
      bases.push({ season, week: g.week, team: t, pts: t === g.home ? pts.home : pts.away, ids, names: ids.map((id) => here.get(id)!.name),
        tds: ids.map((id) => here.get(id)!.rushTd + here.get(id)!.recTd), before, prev });
    }
  }
}

// Totals depend only on (season, week, h, wPrev): cache them per season-week.
const prevCache = new Map<number, Map<string, Tot>>();
function lists(h: number, wPrev: number): { b: Base; list: AttdLine[] }[] {
  const curCache = new Map<string, Map<string, Tot>>();
  return bases.map((b) => {
    if (!prevCache.has(b.season)) prevCache.set(b.season, weighted(b.prev, () => 1));
    const pk = `${b.season}|${b.week}`;
    if (!curCache.has(pk)) {
      // Each player's own games counted back from his latest, so a bye week does not age a game.
      const order = new Map<string, number[]>();
      for (const r of b.before) (order.get(r.id) ?? order.set(r.id, []).get(r.id)!).push(r.week);
      curCache.set(pk, weighted(b.before, (r) => {
        const ws = order.get(r.id)!.sort((x, y) => y - x);
        return h ** ws.indexOf(r.week);
      }));
    }
    const pt = prevCache.get(b.season)!;
    const ct = curCache.get(pk)!;
    const list = b.ids.map((id, i) => {
      const a = pt.get(id), c = ct.get(id);
      return { id, name: b.names[i], team: b.team, ...(Object.fromEntries(K.map((k) => [k, wPrev * (a?.[k] ?? 0) + (c?.[k] ?? 0)])) as { [k in (typeof K)[number]]: number }) };
    });
    return { b, list };
  });
}

const perGame = (cs: { b: Base; list: AttdLine[] }[], p: AttdParams) =>
  cs.map(({ b, list }) => attdTeam(list, b.pts, p).reduce((s, x, i) => s - Math.log(Math.max(1e-6, b.tds[i] > 0 ? x.anytime : 1 - x.anytime)), 0));
const mean = (xs: number[]) => xs.reduce((a, x) => a + x, 0) / xs.length;
const isTrain = (b: Base) => b.season === 2024 || (b.season === 2025 && b.week <= 9);
const isA = (b: Base) => b.season === 2025 && b.week >= 10;
const isB = (b: Base) => b.season === 2026;

function fit(h: number, wPrev: number) {
  const cs = lists(h, wPrev);
  const tr = cs.filter((c) => isTrain(c.b));
  let best = { e: Infinity, p: ATTD as AttdParams };
  for (const kTd of [5, 10, 20, 40, 80])
    for (let calib = 0.8; calib <= 1.1001; calib += 0.04) {
      const p = { ...(ATTD as AttdParams), kTd, calib: Math.round(calib * 100) / 100 };
      const e = mean(perGame(tr, p));
      if (e < best.e) best = { e, p };
    }
  return { h, wPrev, p: best.p, train: best.e, A: perGame(cs.filter((c) => isA(c.b)), best.p), B: perGame(cs.filter((c) => isB(c.b)), best.p) };
}

const base = fit(1, 1);
console.log(`cases: ${bases.length} team-games; 2026 weeks ${[...new Set(bases.filter(isB).map((b) => b.week))].sort((a, b) => a - b).join(",")}`);
console.log(`baseline h 1 wPrev 1 (kTd ${base.p.kTd}, calib ${base.p.calib}): train ${base.train.toFixed(4)}, test 2025 ${mean(base.A).toFixed(4)}, test 2026 ${mean(base.B).toFixed(4)} (log loss per team-game)`);
const paired = (x: number[], y: number[]) => {
  const d = x.map((v, i) => v - y[i]);
  const m = mean(d);
  const se = Math.sqrt(d.reduce((a, v) => a + (v - m) ** 2, 0) / (d.length - 1) / d.length);
  return { m, se };
};
const res = [];
for (const h of [1, 0.9, 0.8, 0.7, 0.6, 0.5])
  for (const wPrev of [1, 0.5, 0.25]) {
    if (h === 1 && wPrev === 1) continue;
    const f = fit(h, wPrev);
    const a = paired(f.A, base.A), b = paired(f.B, base.B);
    res.push({ ...f, a, b });
    console.log(`h ${h} wPrev ${wPrev} (kTd ${f.p.kTd}, calib ${f.p.calib}): train ${f.train.toFixed(4)} | 2025 ${a.m >= 0 ? "+" : ""}${a.m.toFixed(4)} (se ${a.se.toFixed(4)}) | 2026 ${b.m >= 0 ? "+" : ""}${b.m.toFixed(4)} (se ${b.se.toFixed(4)})`);
  }
const pickBy = res.sort((x, y) => x.train - y.train)[0];
console.log(`\nbest on train: h ${pickBy.h} wPrev ${pickBy.wPrev}; vs baseline: 2025 ${pickBy.a.m.toFixed(4)} (${(pickBy.a.m / pickBy.a.se).toFixed(1)} SE), 2026 ${pickBy.b.m.toFixed(4)} (${(pickBy.b.m / pickBy.b.se).toFixed(1)} SE). Negative = better.`);
console.log(pickBy.a.m < 0 && pickBy.b.m < 0 && -pickBy.b.m >= 2 * pickBy.b.se ? "VERDICT: ship" : "VERDICT: do not ship");

// Seattle before its latest 2026 game: share of expected TDs, baseline vs the train-best weighting.
for (const [label, h, w, p] of [["baseline", 1, 1, base.p], [`h ${pickBy.h} wPrev ${pickBy.wPrev}`, pickBy.h, pickBy.wPrev, pickBy.p]] as const) {
  const sea = lists(h, w).filter((c) => c.b.team === "SEA" && c.b.season === 2026).sort((x, y) => y.b.week - x.b.week)[0];
  if (!sea) continue;
  const out = attdTeam(sea.list, sea.b.pts, p);
  console.log(`SEA wk${sea.b.week} ${label}: ` + out.filter((x) => /Wilson|Charbonnet|Price|Holani/.test(x.name)).map((x) => `${x.name} ${(x.anytime * 100).toFixed(0)}%`).join(", "));
}
