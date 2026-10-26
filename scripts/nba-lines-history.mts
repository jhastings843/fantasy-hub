// Fetches each cached NBA game's opening and closing spread and total from
// ESPN's core odds API (DraftKings when ESPN carries it, from 2025-26; ESPN
// BET before that) and caches them to .cache/nba-lines/{season}/{eventId}.json.
// Feeds the NBA game model's fit (scripts/fit-nba-game.mts). Resumable.
//
//   npx tsx --tsconfig scripts/tsconfig.json scripts/nba-lines-history.mts 2024 2025
// Needs .cache/nba/{season} (scripts/nba-history.mts).
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { readOpenClose, type CoreOdds } from "../src/lib/models/nba/game-lines";

const ODDS = (id: string) => `https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/events/${id}/competitions/${id}/odds`;

async function json<T>(url: string, tries = 3): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (!r.ok) throw new Error(`${r.status}`);
      return (await r.json()) as T;
    } catch (e) {
      if (i + 1 >= tries) throw e;
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

async function pool<T>(xs: T[], n: number, f: (x: T) => Promise<void>) {
  const q = [...xs];
  await Promise.all(Array.from({ length: n }, async () => { for (let x = q.shift(); x !== undefined; x = q.shift()) await f(x); }));
}

for (const season of process.argv.slice(2).map(Number)) {
  const dir = `.cache/nba-lines/${season}`;
  mkdirSync(dir, { recursive: true });
  const todo = readdirSync(`.cache/nba/${season}`).map((f) => f.replace(".json", "")).filter((id) => !existsSync(`${dir}/${id}.json`));
  console.log(`${season}: ${todo.length} to fetch`);
  let done = 0, none = 0;
  await pool(todo, 8, async (id) => {
    try {
      const l = readOpenClose(await json<CoreOdds>(ODDS(id)));
      if (l) writeFileSync(`${dir}/${id}.json`, JSON.stringify(l));
      else none++;
    } catch {
      none++;
    }
    if (++done % 300 === 0) console.log(`  ${done}/${todo.length}`);
  });
  console.log(`${season}: done, ${none} without lines`);
}
