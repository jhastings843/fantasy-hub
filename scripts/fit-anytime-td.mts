// Walk-forward fit and test of the NFL Anytime TD model (src/lib/models/nfl/anytime.ts).
//
// Every game of 2024, 2025 and 2026 with nflverse's line: each team's list is
// its players from its last 3 games this season (last season's at week 1)
// who had a stat row in this game (standing in for who was active), as in
// fit-first-td.mts. Outcome: the player scored a rushing or receiving TD.
// Fit on 2024 and 2025 weeks 1-9; tested on 2025 weeks 10-18 and 2026.
//
//   npx tsx --tsconfig scripts/tsconfig.json scripts/fit-anytime-td.mts
// --refit (weekly job, scripts/refit/common.mts): test = the last 4 weeks with
// data, train = every game before; stores the refit only if its log loss per
// team-game (summed over the team's listed players) beats the live settings
// by 2+ SE. Writes no files. Add --dry to score without storing.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import ATTD_DEFAULTS from "../src/lib/models/nfl/attd-params.json";
import { REFIT, liveParams, paired, submit } from "./refit/common.mjs";
import { readGames, readStats, type NflRow } from "../src/lib/models/nfl/data";
import { impliedPoints, tdTotals, type TdLine } from "../src/lib/models/nfl/firsttd";
import { attdTeam, type AttdLine, type AttdParams, type ZoneTotals } from "../src/lib/models/nfl/anytime";
import FTD from "../src/lib/models/nfl/ftd-params.json";

const rows: { [s: number]: NflRow[] } = Object.fromEntries([2023, 2024, 2025, 2026].filter((s) => existsSync(`.cache/nfl/stats_player_week_${s}.csv`)).map((s) => [s, readStats(readFileSync(`.cache/nfl/stats_player_week_${s}.csv`, "utf8"))]));
const games = readGames(readFileSync(".cache/nfl/games.csv", "utf8"));
// Red-zone and goal-line counts per player-game (scripts/nfl-zones.mts).
const zones: { [k: string]: number[] } = Object.assign({}, ...[2023, 2024, 2025, 2026].filter((s) => existsSync(`.cache/nfl/zones_${s}.json`)).map((s) => JSON.parse(readFileSync(`.cache/nfl/zones_${s}.json`, "utf8"))));
/** Zone totals per player over some rows, with his team's in the same games (as tdTotals). */
function zoneTotals(rs: NflRow[]): Map<string, ZoneTotals> {
  const team = new Map<string, number[]>();
  for (const r of rs) {
    const z = zones[`${r.game}|${r.id}`];
    if (!z) continue;
    const t = team.get(`${r.game}|${r.team}`) ?? [0, 0, 0, 0];
    z.forEach((v, i) => (t[i] += v));
    team.set(`${r.game}|${r.team}`, t);
  }
  const out = new Map<string, ZoneTotals>();
  for (const r of rs) {
    const z = zones[`${r.game}|${r.id}`] ?? [0, 0, 0, 0];
    const t = team.get(`${r.game}|${r.team}`) ?? [0, 0, 0, 0];
    const x = out.get(r.id) ?? { glCar: 0, rzCar: 0, rzTgt: 0, teamGlCar: 0, teamRzCar: 0, teamRzTgt: 0 };
    x.glCar += z[0];
    x.rzCar += z[1];
    x.rzTgt += z[3];
    x.teamGlCar += t[0];
    x.teamRzCar += t[1];
    x.teamRzTgt += t[3];
    out.set(r.id, x);
  }
  return out;
}
const addZ = (a?: ZoneTotals, b?: ZoneTotals): ZoneTotals | undefined =>
  a || b ? (Object.fromEntries((["glCar", "rzCar", "rzTgt", "teamGlCar", "teamRzCar", "teamRzTgt"] as const).map((k) => [k, (a?.[k] ?? 0) + (b?.[k] ?? 0)])) as unknown as ZoneTotals) : undefined;

interface Case {
  season: number;
  week: number;
  team: string;
  pts: number;
  list: AttdLine[];
  /** TDs per listed player in this game. */
  tds: number[];
  /** The team's rushing + receiving TDs in this game (all players). */
  teamTds: number;
}

const cases: Case[] = [];
for (const season of [2024, 2025, 2026]) {
  const cur = rows[season] ?? [];
  const prev = rows[season - 1] ?? [];
  const prevTot = tdTotals(prev);
  const prevZ = zoneTotals(prev);
  const weeksDone = new Set(cur.map((r) => r.week));
  for (const g of games.filter((x) => x.season === season && weeksDone.has(x.week))) {
    if (g.total === null || g.homeMargin === null) continue;
    const inGame = cur.filter((r) => r.game === g.game);
    if (!inGame.length) continue;
    const before = cur.filter((r) => r.week < g.week);
    const curTot = tdTotals(before);
    const curZ = zoneTotals(before);
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
      const list: AttdLine[] = ids.map((id) => {
        const a = prevTot.get(id);
        const b = curTot.get(id);
        const z = { rushTd: 0, recTd: 0, car: 0, tgt: 0, teamRushTd: 0, teamRecTd: 0, teamCar: 0, teamTgt: 0 };
        const sum = Object.fromEntries(Object.keys(z).map((k) => [k, ((a as never)?.[k] ?? 0) + ((b as never)?.[k] ?? 0)])) as typeof z;
        return { id, name: (b ?? a)?.name ?? here.get(id)!.name, team: t, ...sum, zone: addZ(prevZ.get(id), curZ.get(id)) };
      });
      cases.push({
        season,
        week: g.week,
        team: t,
        pts: t === g.home ? pts.home : pts.away,
        list,
        tds: list.map((l) => here.get(l.id)!.rushTd + here.get(l.id)!.recTd),
        teamTds: inGame.filter((r) => r.team === t).reduce((s, r) => s + r.rushTd + r.recTd, 0),
      });
    }
  }
}
const wk = (c: Case) => c.season * 100 + c.week;
const lastWeeks = [...new Set(cases.map(wk))].sort((a, b) => a - b).slice(-4);
const train = REFIT ? cases.filter((c) => wk(c) < lastWeeks[0]) : cases.filter((c) => c.season === 2024 || (c.season === 2025 && c.week <= 9));
const testA = REFIT ? cases.filter((c) => lastWeeks.includes(wk(c))) : cases.filter((c) => c.season === 2025 && c.week >= 10);
const testB = REFIT ? testA : cases.filter((c) => c.season === 2026);
if (REFIT) console.log(`refit: test weeks ${lastWeeks.join(", ")} (season*100+week); "test 2025" and "test 2026" lines below both mean these weeks`);

const log: string[] = [];
const say = (s: string) => {
  console.log(s);
  log.push(s);
};
say(`team-games: train ${train.length}, test 2025 wks 10-18 ${testA.length}, test 2026 ${testB.length}`);

// a: offensive TDs per implied point, the closed-form Poisson fit on train.
const a = Math.round((train.reduce((s, c) => s + c.teamTds, 0) / train.reduce((s, c) => s + c.pts, 0)) * 10000) / 10000;
let P: AttdParams = { ...FTD, a };
say(`teams: a ${a} rushing + receiving TDs per implied point (a 24-point team expects ${(a * 24).toFixed(2)})`);

const loss = (cs: Case[], p: AttdParams) => {
  let l = 0, n = 0;
  for (const c of cs) {
    attdTeam(c.list, c.pts, p).forEach((x, i) => {
      const y = c.tds[i] > 0;
      l -= Math.log(Math.max(1e-6, y ? x.anytime : 1 - x.anytime));
      n++;
    });
  }
  return l / n;
};
{
  let b = { e: Infinity, kTd: P.kTd, kR: P.kR, other: P.other };
  for (const kTd of [2, 5, 10, 20, 40, 80])
    for (const kR of [10, 50, 200])
      for (const other of [0.03, 0.067, 0.1, 0.15]) {
        const e = loss(train, { ...P, kTd, kR, other, wRz: 0 });
        if (e < b.e) b = { e, kTd, kR, other };
      }
  P = { ...P, kTd: b.kTd, kR: b.kR, other: b.other, wRz: 0 };
  say(`scorer: kTd ${P.kTd}, kR ${P.kR}, other ${P.other} (train log loss ${b.e.toFixed(4)})`);
  const base = { A: loss(testA, P), B: loss(testB, P) };
  let z = { e: b.e, wRz: 0, gGl: 0, kTd: P.kTd };
  for (const wRz of [0, 0.25, 0.5, 0.75, 1])
    for (const gGl of [0, 1, 2, 4])
      for (const kTd of [5, 10, 20, 40, 80]) {
        const e = loss(train, { ...P, wRz, gGl, kTd });
        if (e < z.e) z = { e, wRz, gGl, kTd };
      }
  for (const [wRz, gGl, kTd] of [[0, 0, 40], [0.5, 0, 40], [1, 0, 40], [1, 2, 40], [1, 2, 10], [1, 0, 5], [0.5, 1, 20]])
    say(`  wRz ${wRz} gGl ${gGl} kTd ${kTd}: train ${loss(train, { ...P, wRz, gGl, kTd }).toFixed(4)}, test 2025 ${loss(testA, { ...P, wRz, gGl, kTd }).toFixed(4)}, test 2026 ${loss(testB, { ...P, wRz, gGl, kTd }).toFixed(4)}`);
  const withZ = { ...P, wRz: z.wRz, gGl: z.gGl, kTd: z.kTd };
  say(`red zone: wRz ${z.wRz}, gGl ${z.gGl}, kTd ${z.kTd} (train ${z.e.toFixed(4)} vs ${b.e.toFixed(4)} without)`);
  say(`  test 2025 wks 10-18: ${loss(testA, withZ).toFixed(4)} vs ${base.A.toFixed(4)} without; test 2026: ${loss(testB, withZ).toFixed(4)} vs ${base.B.toFixed(4)} without`);
  P = withZ;
}
{
  let b = { e: Infinity, calib: 1 };
  for (let c = 0.6; c <= 1.2001; c += 0.02) {
    const e = loss(train, { ...P, calib: c });
    if (e < b.e) b = { e, calib: Math.round(c * 100) / 100 };
  }
  P = { ...P, calib: b.calib };
  say(`calib: ${P.calib} (train log loss ${b.e.toFixed(4)})`);
}

function report(name: string, cs: Case[]) {
  const all = cs.flatMap((c) => attdTeam(c.list, c.pts, P).map((x, i) => ({ p: x.anytime, two: x.two, y: c.tds[i] > 0, y2: c.tds[i] > 1 })));
  const rate = all.filter((x) => x.y).length / all.length;
  const base = -all.reduce((s, x) => s + Math.log(x.y ? rate : 1 - rate), 0) / all.length;
  say(`\n${name}: ${all.length} player-games, ${(rate * 100).toFixed(1)}% scored. Log loss ${loss(cs, P).toFixed(4)} vs flat rate ${base.toFixed(4)}`);
  say(`  2+ TDs: said ${((all.reduce((s, x) => s + x.two, 0) / all.length) * 100).toFixed(1)}%, happened ${((all.filter((x) => x.y2).length / all.length) * 100).toFixed(1)}%`);
  for (const [lo, hi] of [[0, 0.1], [0.1, 0.2], [0.2, 0.3], [0.3, 0.4], [0.4, 0.5], [0.5, 1]]) {
    const b = all.filter((x) => x.p >= lo && x.p < hi);
    if (!b.length) continue;
    say(`  ${Math.round(lo * 100)}-${Math.round(hi * 100)}%: n ${b.length}, said ${((b.reduce((s, x) => s + x.p, 0) / b.length) * 100).toFixed(1)}%, scored ${((b.filter((x) => x.y).length / b.length) * 100).toFixed(1)}%`);
  }
}
if (REFIT) {
  const L = await liveParams("nfl-attd", ATTD_DEFAULTS as AttdParams);
  const per = (p: AttdParams) => testA.map((c) => loss([c], p) * c.list.length).map((x) => (Number.isFinite(x) ? x : 0));
  const ev = paired(per(L), per(P), `log loss per team-game, weeks ${lastWeeks.join(",")}`);
  await submit("nfl-attd", ATTD_DEFAULTS as AttdParams, P, ev);
  process.exit(0);
}
report("train", train);
report("test 2025 wks 10-18", testA);
report("test 2026", testB);

// Our walk-forward chance for every 2026 player-game, to grade other sources (data/venom) on the same players.
writeFileSync(".cache/attd-ours-2026.json", JSON.stringify(Object.fromEntries(testB.flatMap((c) => attdTeam(c.list, c.pts, P).map((x, i) => [`${c.week}|${c.list[i].name}`, { p: x.anytime, td: c.tds[i] }])))));
writeFileSync("src/lib/models/nfl/attd-params.json", JSON.stringify(P, null, 2) + "\n");
writeFileSync(".cache/fit-anytime-td.txt", log.join("\n") + "\n");
console.log("\nwrote src/lib/models/nfl/attd-params.json");
