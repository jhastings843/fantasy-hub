// Our NFL props model against Sam's saved weeks (6 and 7, before his
// paywall) and David's projections on the same markets. Ours is projected
// from nflverse weeks before the game (2025 as the prior), the game's own
// nflverse spread, and the players with a stat row standing in for who was
// active, as in the walk-forward fit. Prints mean absolute error per source.
//
//   npx tsx --tsconfig scripts/tsconfig.json --env-file=.env.local scripts/compare-sam-nfl.mts
import { readFileSync } from "node:fs";
import { Redis } from "@upstash/redis";
import { readGames, readStats } from "../src/lib/models/nfl/data";
import { NflRunning, summarizeNfl } from "../src/lib/models/nfl/history";
import { nflMedian, projectNflGame, type NflParams, type NflStat } from "../src/lib/models/nfl/props";
import { nameKey } from "../src/lib/props/grade";
import type { StoredProps } from "../src/lib/props/store";

const P = JSON.parse(readFileSync("src/lib/models/nfl/params.json", "utf8")) as NflParams;
const prior = summarizeNfl(readStats(readFileSync(".cache/nfl/stats_player_week_2025.csv", "utf8")));
const rows = readStats(readFileSync(".cache/nfl/stats_player_week_2026.csv", "utf8"));
const games = new Map(readGames(readFileSync(".cache/nfl/games.csv", "utf8")).map((g) => [g.game, g]));
const redis = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL!, token: process.env.UPSTASH_REDIS_REST_TOKEN! });
const e: { [s: string]: { n: number; ours: number; oursMed: number; sam: number; david: number; dn: number; line: number; oursSide: number; samSide: number; davidSide: number } } = {};
for (const week of [6, 7]) {
  const saved = (await redis.hgetall<{ [slug: string]: StoredProps }>(`props:v1:2026:w${week}`)) ?? {};
  const run = new NflRunning();
  for (const w of [...new Set(rows.filter((r) => r.week < week).map((r) => r.week))].sort((a, b) => a - b)) run.addWeek(rows.filter((r) => r.week === w));
  for (const [slug, sp] of Object.entries(saved)) {
    if (!sp.result || sp.late) continue;
    const meta = games.get(slug);
    const gr = rows.filter((r) => r.game === slug);
    if (!meta || !gr.length) continue;
    const players = gr.map((r) => run.player(r.id, r.team, r.pos, prior));
    const teams = Object.fromEntries([meta.home, meta.away].map((t) => [t, run.team(t, prior)]));
    const proj = projectNflGame(players, teams, meta.home, meta.homeMargin, prior.base, P);
    const byName = new Map(gr.map((r) => [nameKey(r.name), r.id]));
    const pm = new Map(proj.map((x) => [x.id, x]));
    const res = new Map(sp.result.markets.map((r) => [r.id, r]));
    for (const m of sp.game.markets) {
      const y = res.get(m.id)?.actual;
      const pr = pm.get(byName.get(nameKey(m.player)) ?? "");
      if (!m.stat || y === null || y === undefined || !pr) continue;
      const s = m.stat as NflStat;
      const ours = pr.mean[s];
      const med = s === "rec" ? ours : nflMedian(s, Math.max(ours, 0.1), P);
      const x = (e[s] ??= { n: 0, ours: 0, oursMed: 0, sam: 0, david: 0, dn: 0, line: 0, oursSide: 0, samSide: 0, davidSide: 0 });
      x.n++;
      x.ours += Math.abs(ours - y);
      x.oursMed += Math.abs(med - y);
      x.sam += Math.abs(m.model - y);
      x.line += Math.abs(m.consensus - y);
      const right = (v: number) => (y !== m.consensus && (v > m.consensus) === (y > m.consensus) ? 1 : 0);
      x.oursSide += right(med);
      x.samSide += right(m.model);
      const d = sp.david?.[m.id];
      if (d !== undefined) {
        x.dn++;
        x.david += Math.abs(d - y);
        x.davidSide += right(d);
      }
    }
  }
}
for (const [s, x] of Object.entries(e))
  console.log(
    `${s}: n ${x.n}; MAE ours ${(x.ours / x.n).toFixed(1)} (median ${(x.oursMed / x.n).toFixed(1)}), Sam ${(x.sam / x.n).toFixed(1)}, market line ${(x.line / x.n).toFixed(1)}${x.dn ? `, David ${(x.david / x.dn).toFixed(1)} (n ${x.dn})` : ""}; right side of the line ours ${x.oursSide}, Sam ${x.samSide}${x.dn ? `, David ${x.davidSide} of ${x.dn}` : ""}`,
  );
