// Seeds the NFL model's prior (last season's summary) from the local
// nflverse cache.
//
//   npx tsx --tsconfig scripts/tsconfig.json --env-file=.env.local scripts/seed-nfl-models.mts 2026
import { readFileSync } from "node:fs";
import { redis } from "../src/lib/redis/client";
import { readStats } from "../src/lib/models/nfl/data";
import { summarizeNfl } from "../src/lib/models/nfl/history";
import { NK } from "../src/lib/models/nfl/store";

const season = Number(process.argv[2] ?? 2026);
const s = summarizeNfl(readStats(readFileSync(`.cache/nfl/stats_player_week_${season - 1}.csv`, "utf8")));
await redis.set(NK.prior(season), s);
console.log(`NFL prior for ${season}: ${Object.keys(s.players).length} players, ${Object.keys(s.teams).length} teams`);
