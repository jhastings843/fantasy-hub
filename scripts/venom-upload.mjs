// Uploads one week of Venom's Anytime TD picks (data/venom/nfl-attd-SEASON-wNN.json,
// written by data/venom/save.py) to Redis for the Anytime TD learner
// (src/lib/models/nfl/venom.ts). Members-only data: it goes to the app's
// private store only, never to the repo.
//   node --env-file=.env.local scripts/venom-upload.mjs 9        (one week)
//   node --env-file=.env.local scripts/venom-upload.mjs all      (every saved week)
import { readFileSync, readdirSync } from "node:fs";
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN,
});
const arg = process.argv[2];
if (!arg) throw new Error("usage: venom-upload.mjs WEEK|all");
const files = readdirSync("data/venom")
  .filter((f) => /^nfl-attd-\d{4}-w\d+\.json$/.test(f))
  .filter((f) => arg === "all" || Number(f.match(/w(\d+)/)[1]) === Number(arg));
if (!files.length) throw new Error(`no saved Venom week ${arg} in data/venom`);
for (const f of files) {
  const d = JSON.parse(readFileSync(`data/venom/${f}`, "utf8"));
  const rows = d.rows.map((r) => ({ name: r.name, team: r.team, p: r.p }));
  await redis.set(`venom:v1:nfl:attd:${d.season}:w${d.week}`, rows);
  await redis.sadd(`venom:v1:nfl:attd:${d.season}:weeks`, String(d.week));
  console.log(`week ${d.week}: ${rows.length} picks uploaded`);
}
