// TD lengths for King of the End Zone (Jack, 2026-11-02): DraftKings pays
// everyone who backed the player with the game's longest TD (the scorer gets
// it; a thrown TD credits the receiver). From nflverse play by play, writes
// src/lib/models/nfl/td-length.json:
//   league: yard counts 1..99 for rushing, receiving and other (returns, defense) TDs
//   players: gsis id -> [rushing TD yards[], receiving TD yards[]] since `from`
//   otherPerTeamGame: non-offensive TDs per team-game
//
//   npx tsx --tsconfig scripts/tsconfig.json scripts/fit-td-length.mts 2024 2025 2026
import { createReadStream, existsSync, writeFileSync } from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";

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

const seasons = process.argv.slice(2).map(Number);
const league = { rush: Array(100).fill(0) as number[], rec: Array(100).fill(0) as number[], other: Array(100).fill(0) as number[] };
const players: { [id: string]: [number[], number[]] } = {};
const games = new Set<string>();
let other = 0;
for (const season of seasons) {
  const file = `.cache/nfl/pbp/play_by_play_${season}.csv.gz`;
  if (!existsSync(file)) {
    console.log(`${season}: no ${file}`);
    continue;
  }
  const rl = createInterface({ input: createReadStream(file).pipe(createGunzip()), crlfDelay: Infinity });
  let col: { [k: string]: number } | null = null;
  for await (const line of rl) {
    const f = split(line);
    if (!col) {
      col = Object.fromEntries(f.map((k, i) => [k, i]));
      continue;
    }
    const g = f[col.game_id];
    if (f[col.season_type] && f[col.season_type] !== "REG" && f[col.season_type] !== "POST") continue;
    games.add(g);
    if (f[col.touchdown] !== "1") continue;
    const yds = Math.max(1, Math.min(99, Math.round(Math.abs(Number(f[col.yards_gained]) || 0)) || 1));
    const id = f[col.td_player_id];
    if (f[col.rush_touchdown] === "1" && id) {
      league.rush[yds]++;
      (players[id] ??= [[], []])[0].push(yds);
    } else if (f[col.pass_touchdown] === "1" && id) {
      league.rec[yds]++;
      (players[id] ??= [[], []])[1].push(yds);
    } else {
      league.other[yds]++;
      other++;
    }
  }
  console.log(`${season}: read`);
}
const otherPerTeamGame = Math.round((other / (2 * games.size)) * 1000) / 1000;
writeFileSync("src/lib/models/nfl/td-length.json", JSON.stringify({ seasons, league, players, otherPerTeamGame }));
const n = (a: number[]) => a.reduce((x, y) => x + y, 0);
console.log(`rush ${n(league.rush)} rec ${n(league.rec)} other ${n(league.other)} players ${Object.keys(players).length} other/team-game ${otherPerTeamGame}`);
