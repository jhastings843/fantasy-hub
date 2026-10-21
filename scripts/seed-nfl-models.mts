// Seeds the NFL models' priors from the local nflverse cache: last season's
// summary (props) and its TD totals per player (First TD).
//
//   npx tsx --tsconfig scripts/tsconfig.json --env-file=.env.local scripts/seed-nfl-models.mts 2026
import { readFileSync } from "node:fs";
import { redis } from "../src/lib/redis/client";
import { readStats } from "../src/lib/models/nfl/data";
import { summarizeNfl } from "../src/lib/models/nfl/history";
import { NK } from "../src/lib/models/nfl/store";
import { FK } from "../src/lib/models/nfl/ftd-store";
import { tdTotals } from "../src/lib/models/nfl/firsttd";

const season = Number(process.argv[2] ?? 2026);
const rows = readStats(readFileSync(`.cache/nfl/stats_player_week_${season - 1}.csv`, "utf8"));
const s = summarizeNfl(rows);
await redis.set(NK.prior(season), s);
console.log(`NFL prior for ${season}: ${Object.keys(s.players).length} players, ${Object.keys(s.teams).length} teams`);
const td = Object.fromEntries(tdTotals(rows));
await redis.set(FK.tdprior(season), td);
console.log(`NFL TD prior for ${season}: ${Object.keys(td).length} players`);
