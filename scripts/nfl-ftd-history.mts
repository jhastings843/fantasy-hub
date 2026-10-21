// Caches, per NFL regular-season game, the first touchdown (ESPN scoring
// plays, read the way grading reads them) and each team's drive count, to
// .cache/nfl/ftd/{espnId}.json, for scripts/fit-first-td.mts. Resumable.
//
//   npx tsx --tsconfig scripts/tsconfig.json scripts/nfl-ftd-history.mts 2024 2025 2026
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readGames } from "../src/lib/models/nfl/data";
import { firstTouchdown, type EspnScoringPlay } from "../src/lib/firsttd/grade";

const SITE = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";
mkdirSync(".cache/nfl/ftd", { recursive: true });
const seasons = process.argv.slice(2).map(Number);
const games = readGames(readFileSync(".cache/nfl/games.csv", "utf8")).filter((g) => seasons.includes(g.season) && g.espn && Date.parse(`${g.gameday}T23:59:00Z`) < Date.now() - 86_400_000);
const todo = games.filter((g) => !existsSync(`.cache/nfl/ftd/${g.espn}.json`));
console.log(`${games.length} games, ${todo.length} to fetch`);
let bad = 0;
const q = [...todo];
await Promise.all(
  Array.from({ length: 6 }, async () => {
    for (let g = q.shift(); g; g = q.shift()) {
      try {
        const r = await fetch(`${SITE}/summary?event=${g.espn}`, { signal: AbortSignal.timeout(20_000) });
        const s = (await r.json()) as { header?: { competitions?: { status?: { type?: { completed?: boolean } } }[] }; scoringPlays?: EspnScoringPlay[]; drives?: { previous?: { team?: { abbreviation?: string } }[] } };
        if (!s.header?.competitions?.[0]?.status?.type?.completed) {
          bad++;
          continue;
        }
        const drives: { [t: string]: number } = {};
        for (const d of s.drives?.previous ?? []) if (d.team?.abbreviation) drives[d.team.abbreviation] = (drives[d.team.abbreviation] ?? 0) + 1;
        writeFileSync(`.cache/nfl/ftd/${g.espn}.json`, JSON.stringify({ game: g.game, first: firstTouchdown(s.scoringPlays ?? []), drives }));
      } catch {
        bad++;
      }
    }
  }),
);
console.log(`done, ${bad} not final or unreadable`);
