// Fetches NBA regular-season games from ESPN (scoreboard by date, then each
// game's summary) and caches the compact form (src/lib/models/nba/box.ts) to
// .cache/nba/{season}/{eventId}.json. Resumable: cached games are skipped.
// Feeds the walk-forward fits (scripts/fit-nba-props.mts, fit-first-basket.mts).
//
//   npx tsx --tsconfig scripts/tsconfig.json scripts/nba-history.mts 2024 2025 2026
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { compactGame, type EspnNbaSummary } from "../src/lib/models/nba/box";

const SITE = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";
// Regular-season windows (start inclusive, end inclusive), filed under the first year.
const WINDOW: { [s: number]: [string, string] } = { 2024: ["2024-10-22", "2025-04-13"], 2025: ["2025-10-21", "2026-04-12"], 2026: ["2026-10-20", "2027-04-11"] };

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

const days = (a: string, b: string) => {
  const out: string[] = [];
  const end = Math.min(Date.parse(`${b}T00:00:00Z`), Date.now());
  for (let t = Date.parse(`${a}T00:00:00Z`); t <= end; t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10).replace(/-/g, ""));
  return out;
};

async function pool<T>(xs: T[], n: number, f: (x: T) => Promise<void>) {
  const q = [...xs];
  await Promise.all(Array.from({ length: n }, async () => { for (let x = q.shift(); x !== undefined; x = q.shift()) await f(x); }));
}

for (const season of process.argv.slice(2).map(Number)) {
  const dir = `.cache/nba/${season}`;
  mkdirSync(dir, { recursive: true });
  const ids: string[] = [];
  await pool(days(...WINDOW[season]), 6, async (d) => {
    const sb = await json<{ events?: { id: string; season?: { type?: number }; status?: { type?: { completed?: boolean } } }[] }>(`${SITE}/scoreboard?dates=${d}`);
    for (const e of sb.events ?? []) if (e.season?.type === 2 && e.status?.type?.completed) ids.push(e.id);
  });
  const todo = ids.filter((id) => !existsSync(`${dir}/${id}.json`));
  console.log(`${season}: ${ids.length} final games, ${todo.length} to fetch`);
  let done = 0, bad = 0;
  await pool(todo, 8, async (id) => {
    try {
      const g = compactGame(id, await json<EspnNbaSummary>(`${SITE}/summary?event=${id}`));
      if (g) writeFileSync(`${dir}/${id}.json`, JSON.stringify(g));
      else bad++;
    } catch {
      bad++;
    }
    if (++done % 200 === 0) console.log(`  ${done}/${todo.length}`);
  });
  console.log(`${season}: done, ${bad} unreadable`);
}
