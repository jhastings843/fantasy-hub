import "server-only";
import { cachedWithFallback, invalidate } from "@/lib/redis/cached";
import type { Game, TeamWeek } from "./types";
import { noVig, ratingWinProb, spreadToWinProb } from "./probability";

// ESPN's public scoreboard carries DraftKings spreads AND moneylines for the
// full season with no key and no quota, which is why this does not use
// the-odds-api. Verified for 2026: every week 1-18 priced, moneyline on every
// game. `spread` is the HOME team's number, so negative means home is favoured.
const ESPN_SCOREBOARD =
  "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";

// ESPN spells Washington WSH. Everything else matches our canon.
const ESPN_TO_CANON: Record<string, string> = { WSH: "WAS" };

function canon(abbr: string): string {
  return ESPN_TO_CANON[abbr] ?? abbr;
}

interface EspnCompetitor {
  homeAway: "home" | "away";
  team: { abbreviation: string };
  score?: string;
}

interface EspnOdds {
  spread?: number;
  overUnder?: number;
  moneyline?: {
    home?: { close?: { odds?: string }; open?: { odds?: string } };
    away?: { close?: { odds?: string }; open?: { odds?: string } };
  };
}

interface EspnEvent {
  date: string;
  status?: { type?: { completed?: boolean } };
  competitions: Array<{
    competitors: EspnCompetitor[];
    odds?: EspnOdds[];
    status?: { type?: { completed?: boolean } };
  }>;
}

function parseAmerican(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw.replace("+", ""));
  return Number.isFinite(n) && n !== 0 ? n : null;
}

export function toGame(week: number, ev: EspnEvent): Game | null {
  const comp = ev.competitions?.[0];
  if (!comp) return null;
  const homeC = comp.competitors.find((c) => c.homeAway === "home");
  const awayC = comp.competitors.find((c) => c.homeAway === "away");
  if (!homeC || !awayC) return null;

  const home = canon(homeC.team.abbreviation);
  const away = canon(awayC.team.abbreviation);

  const odds = comp.odds?.[0];
  const ml = odds?.moneyline;
  const homeMl =
    parseAmerican(ml?.home?.close?.odds) ?? parseAmerican(ml?.home?.open?.odds);
  const awayMl =
    parseAmerican(ml?.away?.close?.odds) ?? parseAmerican(ml?.away?.open?.odds);
  const spread = typeof odds?.spread === "number" ? odds.spread : null;

  let homeWinProb: number;
  let probSource: Game["probSource"];
  if (homeMl !== null && awayMl !== null) {
    homeWinProb = noVig(homeMl, awayMl);
    probSource = "moneyline";
  } else if (spread !== null) {
    homeWinProb = spreadToWinProb(spread);
    probSource = "spread";
  } else {
    homeWinProb = ratingWinProb(home, away);
    probSource = "rating";
  }

  const completed =
    comp.status?.type?.completed ?? ev.status?.type?.completed ?? false;

  return {
    week,
    home,
    away,
    kickoff: ev.date,
    homeSpread: spread,
    homeMoneyline: homeMl,
    awayMoneyline: awayMl,
    overUnder: typeof odds?.overUnder === "number" ? odds.overUnder : null,
    homeWinProb,
    probSource,
    completed,
    homeScore: homeC.score != null ? Number(homeC.score) : null,
    awayScore: awayC.score != null ? Number(awayC.score) : null,
  };
}

async function fetchWeekOnce(season: number, week: number): Promise<Game[]> {
  const url = `${ESPN_SCOREBOARD}?week=${week}&seasontype=2&dates=${season}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`ESPN scoreboard week ${week}: ${res.status}`);
  const data = (await res.json()) as { events?: EspnEvent[] };
  return (data.events ?? [])
    .map((e) => toGame(week, e))
    .filter((g): g is Game => g !== null);
}

/** One retry, because a single blip should not cost a week of the schedule. */
async function fetchWeek(season: number, week: number): Promise<Game[]> {
  try {
    return await fetchWeekOnce(season, week);
  } catch {
    return fetchWeekOnce(season, week);
  }
}

export const REGULAR_SEASON_WEEKS = 18;

/**
 * Every regular season week has games, so a week with none means the fetch
 * failed rather than that the NFL took a week off. That distinction matters: a
 * missing week silently rewrites every future-value number, and a missing
 * CURRENT week would move the whole page on to next week's board and invite a
 * pick for the wrong slate.
 */
export function seasonIsComplete(games: Game[]): boolean {
  const weeks = new Set(games.map((g) => g.week));
  for (let w = 1; w <= REGULAR_SEASON_WEEKS; w++) {
    if (!weeks.has(w)) return false;
  }
  return true;
}

export interface SeasonGames {
  games: Game[];
  /** True when serving a last-known-good copy because a fetch came back short. */
  stale: boolean;
  at: string;
}

/**
 * Every regular season game with a priced win probability. Refreshed every 15
 * minutes: lines move through the week but not minute to minute, and the page
 * reads this on every render. A short or failed fetch falls back to the last
 * complete copy rather than caching a hole in the schedule.
 */
/**
 * Drop the cached slate so the next read goes to ESPN.
 *
 * Only the live key, never the last-known-good copy beside it: a forced
 * refresh that fails should fall back to the lines we had, not to nothing.
 */
export async function revalidateGames(season: number): Promise<void> {
  await invalidate(`survivor:games:${season}:v2`);
}

export async function getSeasonGames(season: number): Promise<SeasonGames> {
  const res = await cachedWithFallback<Game[]>({
    key: `survivor:games:${season}:v2`,
    ttlSeconds: 60 * 15,
    empty: [],
    isComplete: seasonIsComplete,
    fetcher: async () => {
      const weeks = Array.from({ length: REGULAR_SEASON_WEEKS }, (_, i) => i + 1);
      const results = await Promise.all(
        weeks.map((w) => fetchWeek(season, w).catch(() => [] as Game[])),
      );
      return results.flat();
    },
  });
  return { games: res.value, stale: res.stale, at: res.at };
}

/** Flatten games into one row per team per week. */
export function toTeamWeeks(games: Game[]): TeamWeek[] {
  const rows: TeamWeek[] = [];
  for (const g of games) {
    rows.push({
      team: g.home,
      opponent: g.away,
      home: true,
      winProb: g.homeWinProb,
      spread: g.homeSpread,
      moneyline: g.homeMoneyline,
      probSource: g.probSource,
      kickoff: g.kickoff,
    });
    rows.push({
      team: g.away,
      opponent: g.home,
      home: false,
      winProb: 1 - g.homeWinProb,
      spread: g.homeSpread === null ? null : -g.homeSpread,
      moneyline: g.awayMoneyline,
      probSource: g.probSource,
      kickoff: g.kickoff,
    });
  }
  return rows;
}
