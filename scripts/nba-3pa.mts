// Three-point attempts per player for every cached game (.cache/nba/{season}),
// which the compact box (src/lib/models/nba/box.ts) leaves out. Refetches each
// ESPN summary and keeps only { playerId: 3PA } at .cache/nba-3pa/{season}/{id}.json.
// Resumable. Used by scripts/fit-nba-props-inputs.mts to test threes as
// attempts x make rate.
//
//   npx tsx --tsconfig scripts/tsconfig.json scripts/nba-3pa.mts 2024 2025
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";

const SITE = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";
type Summary = { boxscore?: { players?: { statistics?: { keys?: string[]; athletes?: { athlete?: { id?: string }; stats?: string[] }[] }[] }[] } };

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

for (const season of process.argv.slice(2).map(Number)) {
  const dir = `.cache/nba-3pa/${season}`;
  mkdirSync(dir, { recursive: true });
  const todo = readdirSync(`.cache/nba/${season}`).map((f) => f.replace(".json", "")).filter((id) => !existsSync(`${dir}/${id}.json`));
  console.log(`${season}: ${todo.length} to fetch`);
  let done = 0, bad = 0;
  const q = [...todo];
  await Promise.all(Array.from({ length: 8 }, async () => {
    for (let id = q.shift(); id !== undefined; id = q.shift()) {
      try {
        const s = await json<Summary>(`${SITE}/summary?event=${id}`);
        const out: { [pid: string]: number } = {};
        for (const t of s.boxscore?.players ?? [])
          for (const tb of t.statistics ?? []) {
            const k = (tb.keys ?? []).indexOf("threePointFieldGoalsMade-threePointFieldGoalsAttempted");
            if (k < 0) continue;
            for (const a of tb.athletes ?? []) {
              const v = Number(String(a.stats?.[k] ?? "").split("-")[1]);
              if (a.athlete?.id && Number.isFinite(v)) out[a.athlete.id] = v;
            }
          }
        writeFileSync(`${dir}/${id}.json`, JSON.stringify(out));
      } catch {
        bad++;
      }
      if (++done % 200 === 0) console.log(`  ${done}/${todo.length}`);
    }
  }));
  console.log(`${season}: done, ${bad} failed`);
}
