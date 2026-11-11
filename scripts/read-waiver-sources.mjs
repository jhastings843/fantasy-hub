// Read-only: fetch the stored week N waiver sources from Upstash (GET only, no writes).
//   node --env-file=.env.local scripts/read-waiver-sources.mjs 2026 10 out.json
import { writeFileSync } from "node:fs";

const [season = "2026", week = "10", out = "previews/sources.json"] = process.argv.slice(2);
const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;
const keys = [
  `waivers:v1:research:${season}:w${week}:redraft`,
  `waivers:v1:research:${season}:w${week}:dynasty`,
  `jingles:v1:waivers:${season}:w${week}`,
  `jingles:v1:waivers:latest`,
  `waivers:v1:flock:${season}:w${week}`,
  `dynastynerds:v1:${season}:w${week}`,
  `email:v1:sent:midweek:${season}:w${week}`,
];
const res = await fetch(`${url}/pipeline`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}` },
  body: JSON.stringify(keys.map((k) => ["GET", k])),
});
const rows = await res.json();
const result = Object.fromEntries(
  keys.map((k, i) => {
    const v = rows[i]?.result;
    try { return [k, v == null ? null : JSON.parse(v)]; } catch { return [k, v]; }
  }),
);
writeFileSync(out, JSON.stringify(result, null, 2));
for (const k of keys) console.log(k, result[k] == null ? "MISSING" : "found");
