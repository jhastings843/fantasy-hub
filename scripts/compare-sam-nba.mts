// Our NBA props model against Sam's saved opening-night numbers (10-20, the
// three games graded before his paywall). Ours is projected as of tip: last
// season as the prior, no games this season yet, the box score's players as
// the available list. Prints mean absolute error per source.
//
//   npx tsx --tsconfig scripts/tsconfig.json --env-file=.env.local scripts/compare-sam-nba.mts
import { readdirSync, readFileSync } from "node:fs";
import { Redis } from "@upstash/redis";
import type { NbaGame } from "../src/lib/models/nba/box";
import { summarize, RunningSeason } from "../src/lib/models/nba/history";
import { projectGame, type NbaParams, type NbaStat } from "../src/lib/models/nba/props";
import { nameKey } from "../src/lib/props/grade";
import type { StoredProps } from "../src/lib/props/store";

const P = JSON.parse(readFileSync("src/lib/models/nba/params.json", "utf8")) as NbaParams;
const load = (s: number) => readdirSync(`.cache/nba/${s}`).map((f) => JSON.parse(readFileSync(`.cache/nba/${s}/${f}`, "utf8")) as NbaGame);
const prior = summarize(load(2025));
const now = load(2026);
const redis = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL!, token: process.env.UPSTASH_REDIS_REST_TOKEN! });
const saved = (await redis.hgetall<{ [id: string]: StoredProps }>("props:v1:nba:2026:w1")) ?? {};
const err: { [k: string]: { n: number; ours: number; sam: number; line: number; oursW: number; samW: number } } = {};
const run = new RunningSeason();
for (const sp of Object.values(saved)) {
  if (!sp.result) continue;
  const g = now.find((x) => x.id === sp.espnId);
  if (!g) continue;
  const players = g.players.map((l) => run.player(l.id, l.team, l.pos, prior));
  const teams = Object.fromEntries([g.home, g.away].map((t) => [t, run.team(t, prior)]));
  const proj = new Map(projectGame(players, teams, g.spread, prior.base, P).map((p) => [p.id, p]));
  const byName = new Map(g.players.map((l) => [nameKey(l.name), l.id]));
  const res = new Map(sp.result.markets.map((r) => [r.id, r]));
  for (const m of sp.game.markets) {
    const actual = res.get(m.id)?.actual;
    const pr = proj.get(byName.get(nameKey(m.player)) ?? "");
    if (!m.stat || actual === null || actual === undefined || !pr) continue;
    const e = (err[m.stat] ??= { n: 0, ours: 0, sam: 0, line: 0, oursW: 0, samW: 0 });
    const ours = pr.mean[m.stat as NbaStat];
    e.n++;
    e.ours += Math.abs(ours - actual);
    e.sam += Math.abs(m.model - actual);
    e.line += Math.abs(m.consensus - actual);
    // Side from the consensus line, right or wrong (pushes count as neither).
    if (actual !== m.consensus) {
      if ((ours > m.consensus) === (actual > m.consensus)) e.oursW++;
      if ((m.model > m.consensus) === (actual > m.consensus)) e.samW++;
    }
  }
}
for (const [s, e] of Object.entries(err))
  console.log(`${s}: n ${e.n}; MAE ours ${(e.ours / e.n).toFixed(2)}, Sam ${(e.sam / e.n).toFixed(2)}, market line ${(e.line / e.n).toFixed(2)}; right side of the line ours ${e.oursW}, Sam ${e.samW}`);
