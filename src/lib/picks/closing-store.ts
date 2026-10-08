import "server-only";
import { redis } from "@/lib/redis/client";
import type { League } from "./parse";
import { key } from "./engine";
import { type ClosingLine, parseScoreboard, parseSummary } from "./closing";

// Closing lines for the Picks tab, from ESPN's public scoreboard and game
// summaries (no key, no quota; the Survivor page already leans on the same
// feed). A finished game's close never changes, so each one is fetched once
// and kept: one Redis key per week, merged as games finish. A finished game
// ESPN never priced is kept too, with null lines, so it is not asked again.

const SPORT = { nfl: "nfl", cfb: "college-football" } as const;
const BASE = "https://site.api.espn.com/apis/site/v2/sports/football";
const weekKey = (league: League, season: number, week: number) => `picks:v1:${league}:close:${season}:w${week}`;

async function json<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`ESPN answered ${res.status}`);
  return (await res.json()) as T;
}

/** Runs at most `n` at a time, so a college week is not 60 requests at once. */
async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

async function fillWeek(
  league: League,
  season: number,
  week: number,
  wanted: Set<string>,
  stored: ClosingLine[],
): Promise<ClosingLine[]> {
  const extra = league === "cfb" ? "&groups=80&limit=400" : "";
  const events = parseScoreboard(
    league,
    await json(`${BASE}/${SPORT[league]}/scoreboard?week=${week}&seasontype=2&dates=${season}${extra}`),
  );
  const have = new Set(stored.map(key));
  const todo = events.filter((e) => e.completed && !have.has(key({ week, ...e })) && wanted.has(key({ week, ...e })));
  const got = await pool(todo, 8, async (e): Promise<ClosingLine | null> => {
    try {
      const s = parseSummary(await json(`${BASE}/${SPORT[league]}/summary?event=${e.id}`));
      return { week, home: e.home, away: e.away, open: null, close: null, totalOpen: null, totalClose: null, ...s };
    } catch {
      return null; // a blip: asked again on the next build
    }
  });
  return got.filter((x): x is ClosingLine => x !== null);
}

/**
 * Closing lines for these games, keyed like the engine. Fetches only what is
 * not on file; anything that fails is simply missing from the map this time.
 */
export async function closingLines(
  league: League,
  season: number,
  games: { week: number; home: string; away: string }[],
): Promise<{ closes: Map<string, ClosingLine>; problems: string[] }> {
  const closes = new Map<string, ClosingLine>();
  const problems: string[] = [];
  const byWeek = new Map<number, Set<string>>();
  for (const g of games) {
    if (!byWeek.has(g.week)) byWeek.set(g.week, new Set());
    byWeek.get(g.week)!.add(key(g));
  }
  await Promise.all(
    [...byWeek].map(async ([week, wanted]) => {
      let stored: ClosingLine[] = [];
      try {
        stored = (await redis.get<ClosingLine[]>(weekKey(league, season, week))) ?? [];
      } catch {
        /* treated as nothing on file */
      }
      const missing = [...wanted].some((k) => !stored.some((c) => key(c) === k));
      if (missing) {
        try {
          const fresh = await fillWeek(league, season, week, wanted, stored);
          if (fresh.length) {
            stored = [...stored, ...fresh];
            await redis.set(weekKey(league, season, week), stored).catch(() => {});
          }
        } catch (e) {
          problems.push(`Week ${week}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      for (const c of stored) if (wanted.has(key(c))) closes.set(key(c), c);
    }),
  );
  return { closes, problems };
}
