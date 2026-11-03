// Downloads the nflverse files the injury backtest needs into .cache/nfl, only
// the ones missing (the current season always): injury reports and weekly
// player stats from 2009 (the first season nflverse has injury reports).
// Same release host and retry as scripts/refit/nfl-data.mts.
//
//   npx tsx --tsconfig scripts/tsconfig.json scripts/nfl-injury-history.mts [first] [last]
//   e.g. no args: injuries_2009.csv .. injuries_2026.csv and stats_player_week_2009..2026.csv
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

const DIR = ".cache/nfl";
const REL = "https://github.com/nflverse/nflverse-data/releases/download";
mkdirSync(DIR, { recursive: true });
const thisYear = new Date().getUTCMonth() >= 7 ? new Date().getUTCFullYear() : new Date().getUTCFullYear() - 1;
const first = Number(process.argv[2] ?? 2009);
const last = Number(process.argv[3] ?? thisYear);

async function get(url: string): Promise<Buffer | null> {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(120_000) });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      return Buffer.from(await r.arrayBuffer());
    } catch (e) {
      if (i >= 2) throw e;
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
}

for (let s = first; s <= last; s++) {
  const inj = `${DIR}/injuries_${s}.csv`;
  if (s === thisYear || !existsSync(inj)) {
    const b = await get(`${REL}/injuries/injuries_${s}.csv`);
    if (b) writeFileSync(inj, b);
    console.log(`injuries_${s}: ${b ? `${b.length} bytes` : "not published"}`);
  }
  const st = `${DIR}/stats_player_week_${s}.csv`;
  if (s === thisYear || !existsSync(st)) {
    const gz = await get(`${REL}/stats_player/stats_player_week_${s}.csv.gz`);
    if (gz) writeFileSync(st, gunzipSync(gz));
    console.log(`stats_player_week_${s}: ${gz ? "ok" : "not published"}`);
  }
}
