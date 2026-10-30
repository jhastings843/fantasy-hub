// Uploads one week of Venom's boards (data/venom/nfl-STAT-SEASON-wNN.json, written by
// data/venom/save.py) to Redis: Anytime TD picks for the Anytime TD learner, and the
// pass yards, rush yards and receptions boards for the NFL props learner
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
const wanted = (f) => arg === "all" || Number(f.match(/w(\d+)/)[1]) === Number(arg);
const files = readdirSync("data/venom")
  .filter((f) => /^nfl-attd-\d{4}-w\d+\.json$/.test(f))
  .filter(wanted);
// Prop boards: one hash per week, field = stat, value = that board's rows.
const propFiles = readdirSync("data/venom")
  .filter((f) => /^nfl-(pass_yds|rush_yds|rec)-\d{4}-w\d+\.json$/.test(f))
  .filter(wanted);
if (!files.length && !propFiles.length) throw new Error(`no saved Venom week ${arg} in data/venom`);
for (const f of files) {
  const d = JSON.parse(readFileSync(`data/venom/${f}`, "utf8"));
  const rows = d.rows.map((r) => ({ name: r.name, team: r.team, p: r.p }));
  await redis.set(`venom:v1:nfl:attd:${d.season}:w${d.week}`, rows);
  await redis.sadd(`venom:v1:nfl:attd:${d.season}:weeks`, String(d.week));
  console.log(`week ${d.week}: ${rows.length} picks uploaded`);
}
for (const f of propFiles) {
  const d = JSON.parse(readFileSync(`data/venom/${f}`, "utf8"));
  const rows = d.rows.map((r) => ({ name: r.name, team: r.team, rank: r.rank, score: r.score }));
  await redis.hset(`venom:v1:nfl:props:${d.season}:w${d.week}`, { [d.stat]: rows });
  await redis.sadd(`venom:v1:nfl:props:${d.season}:weeks`, String(d.week));
  console.log(`week ${d.week} ${d.stat}: ${rows.length} players uploaded`);
}
