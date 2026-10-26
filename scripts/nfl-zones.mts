// Red-zone and goal-line opportunities per player-game from nflverse play by
// play (.cache/nfl/pbp/play_by_play_{season}.csv.gz), for the Anytime TD fit.
// Goal line = snap at the opponent's 5 or closer; red zone = the 20 or closer
// (goal line included). Carries are rush attempts by the rusher, targets are
// pass attempts thrown to the receiver. Writes .cache/nfl/zones_{season}.json:
// { "<game_id>|<gsis id>": [glCar, rzCar, glTgt, rzTgt] }.
//
//   npx tsx --tsconfig scripts/tsconfig.json scripts/nfl-zones.mts 2023 2024 2025 2026
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
  for await (const line of rl) {
    const f = split(line);
    if (!col) {
      col = Object.fromEntries(f.map((k, i) => [k, i]));
      continue;
    }
    const yl = Number(f[col.yardline_100]);
    if (!Number.isFinite(yl) || yl > 20) continue;
    const gl = yl <= 5;
    const game = f[col.game_id];
    const rush = f[col.rush_attempt] === "1" && f[col.rusher_player_id];
    const pass = f[col.pass_attempt] === "1" && f[col.receiver_player_id];
    const add = (id: string, i: number) => {
      const k = `${game}|${id}`;
      const v = (out[k] ??= [0, 0, 0, 0]);
      if (gl) v[i]++;
      v[i + 1]++;
    };
    if (rush) add(f[col.rusher_player_id], 0);
    else if (pass) add(f[col.receiver_player_id], 2);
    plays++;
  }
  writeFileSync(`.cache/nfl/zones_${season}.json`, JSON.stringify(out));
  console.log(`${season}: ${plays} red-zone plays, ${Object.keys(out).length} player-games`);
}
