// Brings .cache/nfl up to date for the NFL refits (fit-first-td, fit-anytime-td,
// fit-nfl-props, fit-nfl-spread --refit). Run from the repo root in CI after
// restoring the .cache/nfl cache. Always re-downloads the current season's
// files; earlier seasons only when missing (a cold cache), so a warm run is
// three small downloads, one play-by-play file and the week's ESPN summaries.
//
//   npx tsx --tsconfig scripts/tsconfig.json scripts/refit/nfl-data.mts
//
// Files (season S = the latest season in games.csv with a final score):
//   games.csv                          nflverse nfldata, every season (all four fits)
//   stats_player_week_{S-2..S}.csv     nflverse stats_player (FTD, ATTD, props)
//   pbp/play_by_play_{S-2..S}.csv.gz   nflverse pbp, only to build the two below
//   zones_{S-2..S}.json                scripts/nfl-zones.mts (ATTD red zone)
//   air_{S-2..S}.json                  scripts/nfl-air.mts (props depth of target)
//   ftd/{espnId}.json                  scripts/nfl-ftd-history.mts (FTD outcomes)
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { readGames } from "../../src/lib/models/nfl/data";

const DIR = ".cache/nfl";
const REL = "https://github.com/nflverse/nflverse-data/releases/download";
mkdirSync(`${DIR}/pbp`, { recursive: true });

async function get(url: string): Promise<Buffer> {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(120_000) });
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      return Buffer.from(await r.arrayBuffer());
    } catch (e) {
      if (i >= 2) throw e;
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
}
const t0 = Date.now();
const step = (s: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${s}`);

const gamesCsv = await get("https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv");
writeFileSync(`${DIR}/games.csv`, gamesCsv);
const S = Math.max(...readGames(gamesCsv.toString("utf8")).filter((g) => g.season && Date.parse(`${g.gameday}T00:00:00Z`) < Date.now()).map((g) => g.season));
step(`games.csv; current season ${S}`);

const seasons = [S - 2, S - 1, S];
const fresh: number[] = [];
for (const s of seasons) {
  const stats = `${DIR}/stats_player_week_${s}.csv`;
  if (s === S || !existsSync(stats)) {
    const gz = await get(`${REL}/stats_player/stats_player_week_${s}.csv.gz`);
    writeFileSync(`${stats}.gz`, gz);
    writeFileSync(stats, gunzipSync(gz));
    step(`stats_player_week_${s}`);
  }
  const pbp = `${DIR}/pbp/play_by_play_${s}.csv.gz`;
  if (s === S || !existsSync(`${DIR}/zones_${s}.json`) || !existsSync(`${DIR}/air_${s}.json`)) {
    writeFileSync(pbp, await get(`${REL}/pbp/play_by_play_${s}.csv.gz`));
    fresh.push(s);
    step(`play_by_play_${s}`);
  }
}
const tsx = (script: string, args: number[]) => execFileSync("npx", ["tsx", "--tsconfig", "scripts/tsconfig.json", script, ...args.map(String)], { stdio: "inherit" });
if (fresh.length) {
  tsx("scripts/nfl-zones.mts", fresh);
  tsx("scripts/nfl-air.mts", fresh);
  step(`zones and air for ${fresh.join(", ")}`);
}
// Resumable: only games without a cached first TD are fetched.
tsx("scripts/nfl-ftd-history.mts", seasons.slice(1));
step("first TD outcomes");
