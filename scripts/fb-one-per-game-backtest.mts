// Read-only: fb:tip (every tip-team edge) vs one bet per game (the tip-team
// edge with our highest chance) vs fb:tiptop, on every graded First Basket game.
//   npx tsx --tsconfig scripts/tsconfig.json --env-file=.env.local scripts/fb-one-per-game-backtest.mts
import { getRedis } from "../src/lib/redis/client";
import { fbGraded } from "../src/lib/models/nba/store";
import { FB_SLICES } from "../src/lib/models/learn";
import { primeParams } from "../src/lib/models/params-store";

const client = getRedis() as unknown as { [k: string]: unknown };
for (const m of ["set", "hset", "hdel", "del", "rpush", "lpush", "sadd", "srem", "expire", "incr", "zadd", "eval", "evalsha", "setnx", "mset"]) Object.defineProperty(client, m, { value: () => { throw new Error(`read-only: ${m}`); } });

await primeParams();
const boards = await fbGraded(2026);
const keep = (id: string) => FB_SLICES.find(([s]) => s === id)![2];
const tipOf = keep("fb:tip"), tiptopOf = keep("fb:tiptop");
type R = { at: string; net: number; game: string };
const sets: Record<string, R[]> = { "fb:tip (live now)": [], "one per game (tip-team best p)": [], "fb:tiptop": [] };
for (const b of boards) {
  const tip = b.bets.filter((x) => tipOf(b, x));
  for (const x of tip) sets["fb:tip (live now)"].push({ at: b.at, net: x.net, game: b.event });
  const best = tip.reduce<(typeof tip)[number] | undefined>((m, y) => (!m || (y.p ?? 0) > (m.p ?? 0) ? y : m), undefined);
  if (best) sets["one per game (tip-team best p)"].push({ at: b.at, net: best.net, game: b.event });
  for (const x of b.bets.filter((x) => tiptopOf(b, x))) sets["fb:tiptop"].push({ at: b.at, net: x.net, game: b.event });
}
// t on per-game net (bets in a game are correlated: only one can win).
function stats(rows: R[]) {
  const g = new Map<string, number>();
  for (const r of rows) g.set(r.game, (g.get(r.game) ?? 0) + r.net);
  const v = [...g.values()], n = v.length, mean = v.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1));
  const wins = rows.filter((r) => r.net > 0).length, units = rows.reduce((a, r) => a + r.net, 0);
  return { bets: rows.length, games: n, wins, units: +units.toFixed(1), roi: +(100 * units / rows.length).toFixed(1), t: +(mean / (sd / Math.sqrt(n))).toFixed(2) };
}
const dates = boards.map((b) => b.at).sort();
const mid = dates[Math.floor(dates.length / 2)];
const days = new Set(boards.map((b) => b.at.slice(0, 10))).size;
console.log(`graded games ${boards.length}, ${dates[0].slice(0, 10)} to ${dates.at(-1)!.slice(0, 10)}, ${days} slate days, split at ${mid.slice(0, 10)}`);
for (const [k, rows] of Object.entries(sets)) {
  const all = stats(rows), a = stats(rows.filter((r) => r.at < mid)), z = stats(rows.filter((r) => r.at >= mid));
  const last14 = stats(rows.filter((r) => r.at >= "2026-11-06"));
  console.log(JSON.stringify({ slice: k, perDay: +(all.bets / days).toFixed(1), ...all, firstHalf: `${a.units}u t ${a.t}`, secondHalf: `${z.units}u t ${z.t}`, since1106: `${last14.bets} bets ${last14.units}u` }));
}
