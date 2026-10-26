// Air yards per player-game from nflverse play by play
// (.cache/nfl/pbp/play_by_play_{season}.csv.gz), for the props fit's depth of
// target input. A target is a regular-season pass attempt thrown to a receiver
// (two-point tries and plays without air_yards skipped). Writes
// .cache/nfl/air_{season}.json: { "<game_id>|<gsis id>": [airYds, targets] }.
//
//   npx tsx --tsconfig scripts/tsconfig.json scripts/nfl-air.mts 2024 2025 2026
import { createReadStream, existsSync, writeFileSync } from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";

/** One CSV line into fields (quoted fields may hold commas; pbp's text has no newlines inside quotes). */
function split(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') (cur += '"'), i++;
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") out.push(cur), (cur = "");
    else cur += c;
  }
  out.push(cur);
  return out;
}

for (const season of process.argv.slice(2).map(Number)) {
  const file = `.cache/nfl/pbp/play_by_play_${season}.csv.gz`;
  if (!existsSync(file)) {
    console.log(`${season}: no ${file}`);
    continue;
  }
  const rl = createInterface({ input: createReadStream(file).pipe(createGunzip()), crlfDelay: Infinity });
  let col: { [k: string]: number } | null = null;
  const out: { [k: string]: number[] } = {};
  let plays = 0;
  let maxWeek = 0;
  for await (const line of rl) {
    const f = split(line);
    if (!col) {
      col = Object.fromEntries(f.map((k, i) => [k, i]));
      continue;
    }
    if (f[col.season_type] !== "REG" || f[col.pass_attempt] !== "1" || f[col.two_point_attempt] === "1") continue;
    const id = f[col.receiver_player_id];
    const air = Number(f[col.air_yards]);
    if (!id || f[col.air_yards] === "" || !Number.isFinite(air)) continue;
    const v = (out[`${f[col.game_id]}|${id}`] ??= [0, 0]);
    v[0] += air;
    v[1]++;
    plays++;
    maxWeek = Math.max(maxWeek, Number(f[col.week]));
  }
  writeFileSync(`.cache/nfl/air_${season}.json`, JSON.stringify(out));
  console.log(`${season}: ${plays} targets through week ${maxWeek}, ${Object.keys(out).length} player-games`);
}
