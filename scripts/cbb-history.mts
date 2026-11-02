// Pulls the history our college basketball model is fit and tested on.
//
// 1. ESPN's Division I scoreboard (groups=50), one call per date, November
//    through the national title game, for 2023-24, 2024-25 and 2025-26:
//    every final with ESPN team ids, home/away, neutral site, conference game
//    and postseason flags.
// 2. DraftKings' opening and closing spread and total for each 2024-25 and
//    2025-26 final, from ESPN's core odds API (one call per game).
// 3. Bart Torvik's 2025-26 schedule file (super_sked): T-Rank's line at the
//    time of each game, as a second source to test against.
//
// Everything lands in .cache/cbb/ (kept between runs); the joined table is
// written to .cache/cbb/games.json for scripts/fit-cbb.mts.
//
//   npx tsx --tsconfig scripts/tsconfig.json scripts/cbb-history.mts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readOpenClose, type CoreOdds } from "../src/lib/models/nba/game-lines";
import { readTorvikSked, type TorvikGame } from "../src/lib/models/cbb/torvik";
import type { CbbFinal } from "../src/lib/models/cbb/model";

const DIR = ".cache/cbb";
mkdirSync(`${DIR}/days`, { recursive: true });
mkdirSync(`${DIR}/odds`, { recursive: true });
const SITE = "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard";
const ODDS = (id: string) => `https://sports.core.api.espn.com/v2/sports/basketball/leagues/mens-college-basketball/events/${id}/competitions/${id}/odds`;
const SEASONS = [2023, 2024, 2025]; // start years: 2023-24, 2024-25, 2025-26
const ODDS_SEASONS = new Set([2024, 2025]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function getJson(url: string, tries = 4): Promise<unknown> {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`${r.status}`);
      return await r.json();
    } catch (e) {
      if (i >= tries) throw new Error(`${url}: ${e instanceof Error ? e.message : e}`);
      await sleep(1000 * (i + 1));
    }
  }
}
async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

interface Board {
  events?: {
    id: string;
    date: string;
    season?: { year?: number; type?: number };
    status?: { type?: { completed?: boolean } };
    competitions?: {
      neutralSite?: boolean;
      conferenceCompetition?: boolean;
      tournamentId?: number;
      notes?: { headline?: string }[];
      competitors?: { homeAway: string; score?: string; team: { id: string; location?: string; abbreviation?: string } }[];
    }[];
  }[];
}

const days = (start: number) => {
  const out: string[] = [];
  for (let d = Date.UTC(start, 10, 1); d <= Date.UTC(start + 1, 3, 10); d += 86_400_000) out.push(new Date(d).toISOString().slice(0, 10).replace(/-/g, ""));
  return out;
};

const finals: CbbFinal[] = [];
const names = new Map<string, string>();
for (const season of SEASONS) {
  const ds = days(season);
  const boards = new Map<string, Board>();
  await pool(ds, 6, async (d) => {
    const f = `${DIR}/days/${d}.json`;
    if (!existsSync(f)) writeFileSync(f, JSON.stringify((await getJson(`${SITE}?dates=${d}&groups=50&limit=500`)) ?? {}));
    boards.set(d, JSON.parse(readFileSync(f, "utf8")) as Board);
  });
  for (const d of ds) {
    for (const e of boards.get(d)?.events ?? []) {
      const c = e.competitions?.[0];
      const h = c?.competitors?.find((x) => x.homeAway === "home");
      const a = c?.competitors?.find((x) => x.homeAway === "away");
      if (!c || !h || !a || !e.status?.type?.completed) continue;
      const hs = Number(h.score);
      const as = Number(a.score);
      if (!Number.isFinite(hs) || !Number.isFinite(as) || hs + as === 0) continue;
      names.set(h.team.id, h.team.location ?? h.team.id);
      names.set(a.team.id, a.team.location ?? a.team.id);
      finals.push({
        id: e.id,
        season,
        tip: e.date,
        home: h.team.id,
        away: a.team.id,
        homeScore: hs,
        awayScore: as,
        neutral: !!c.neutralSite,
        conf: !!c.conferenceCompetition,
        post: (e.season?.type ?? 2) === 3,
      });
    }
  }
  console.log(`${season}-${String(season + 1).slice(2)}: ${finals.filter((g) => g.season === season).length} finals`);
}
// One copy per event (a date's board can repeat a late game).
const byId = new Map(finals.map((g) => [g.id, g]));
const uniq = [...byId.values()].sort((a, b) => a.tip.localeCompare(b.tip));

// Lines.
const want = uniq.filter((g) => ODDS_SEASONS.has(g.season));
let got = 0;
await pool(want, 10, async (g) => {
  const f = `${DIR}/odds/${g.id}.json`;
  if (!existsSync(f)) {
    const raw = await getJson(ODDS(g.id)).catch(() => null);
    writeFileSync(f, JSON.stringify(raw ?? {}));
  }
  const oc = readOpenClose(JSON.parse(readFileSync(f, "utf8")) as CoreOdds);
  if (oc && oc.close.spread !== null) {
    g.line = { open: oc.open, close: oc.close, provider: oc.provider };
  }
  if (++got % 1000 === 0) process.stdout.write(".");
});
console.log(`\nlines: ${want.filter((g) => g.line).length} of ${want.length} finals in 2024-26`);

// T-Rank's line at the time, 2025-26 (and 2024-25 when Torvik serves it).
for (const season of [2024, 2025]) {
  const f = `${DIR}/torvik-${season + 1}.json`;
  if (!existsSync(f)) {
    const r = await fetch(`https://barttorvik.com/${season + 1}_super_sked.json`);
    if (r.ok) writeFileSync(f, await r.text());
  }
  if (!existsSync(f)) continue;
  const sked: TorvikGame[] = readTorvikSked(JSON.parse(readFileSync(f, "utf8")) as unknown[][]);
  writeFileSync(`${DIR}/torvik-${season + 1}-games.json`, JSON.stringify(sked));
  console.log(`torvik ${season + 1}: ${sked.length} games with a pregame line`);
}

writeFileSync(`${DIR}/games.json`, JSON.stringify(uniq));
writeFileSync(`${DIR}/names.json`, JSON.stringify(Object.fromEntries(names)));
console.log(`wrote ${uniq.length} finals, ${names.size} teams`);
