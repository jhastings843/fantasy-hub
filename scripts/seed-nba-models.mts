// Seeds the live NBA model tables from the local cache (scripts/nba-history.mts):
// last season's summary as this season's prior, this season's finished
// games folded into the player and team tables, and the First Basket tables
// rebuilt from every cached season. Re-running is safe: games
// already ingested are skipped.
//
//   npx tsx --tsconfig scripts/tsconfig.json --env-file=.env.local scripts/seed-nba-models.mts 2026
import { readdirSync, readFileSync } from "node:fs";
import { redis } from "../src/lib/redis/client";
import type { NbaGame } from "../src/lib/models/nba/box";
import { summarize, type TeamEntry } from "../src/lib/models/nba/history";
import { K, foldGame } from "../src/lib/models/nba/store";
import { emptyTables, foldFb } from "../src/lib/models/nba/firstbasket";

const season = Number(process.argv[2] ?? 2026);
const load = (s: number): NbaGame[] =>
  readdirSync(`.cache/nba/${s}`)
    .map((f) => JSON.parse(readFileSync(`.cache/nba/${s}/${f}`, "utf8")) as NbaGame)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

await redis.set(K.prior(season), summarize(load(season - 1)));
console.log(`prior for ${season} saved from ${season - 1}`);
const seen = new Set(((await redis.smembers(K.ingested(season))) ?? []).map(String));
const teams = (await redis.get<{ [t: string]: TeamEntry }>(K.teams(season))) ?? {};
let n = 0;
for (const g of load(season)) {
  if (seen.has(g.id)) continue;
  await foldGame(season, g, teams);
  n++;
}
await redis.set(K.teams(season), teams);
console.log(`${n} games folded into ${season}`);
// First Basket tables: rebuilt from every cached season (cumulative; finals after this are folded in by the live run).
const fb = emptyTables();
for (const s of [season - 2, season - 1, season]) for (const g of load(s)) foldFb(fb, g);
await redis.set(K.fb, fb);
console.log(`first basket tables: ${Object.keys(fb.tips).length} jumpers, ${fb.tipTeamFirst.n} games`);
