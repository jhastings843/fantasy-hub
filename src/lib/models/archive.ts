import "server-only";
import { redis } from "@/lib/redis/client";
import { etDate, nbaSeasonOfDate } from "@/lib/props/parse";
import { samTeam } from "@/lib/firsttd/grade";
import { closeLines, lineCounts, mergeLines, readPropBets, type ArchivedGame, type KalshiQuote, type LinesLeague, type PropBetRow } from "./lines";

// The prop line archive's store (pure logic in lines.ts). Every capture slot
// reads DraftKings' player props from ESPN for each NBA game today and
// tomorrow (Eastern) and each NFL game this week that hasn't started, plus
// Kalshi's first TD and first basket prices, and folds them into one Redis
// value per game. The first capture after a game starts marks it closed, so
// the last pregame read stands as the closing line.
//
// Keys (new prefix, nothing of Sam's touched):
//   lines:v1:{league}:{season}:{espnEventId}   the game (ArchivedGame)
//   lines:v1:{league}:{season}:events          set of event ids on file

const SITE = { nba: "https://site.api.espn.com/apis/site/v2/sports/basketball/nba", nfl: "https://site.api.espn.com/apis/site/v2/sports/football/nfl" };
const CORE = { nba: "basketball/leagues/nba", nfl: "football/leagues/nfl" };
const PROPS = (l: LinesLeague, ev: string, page: number) =>
  `https://sports.core.api.espn.com/v2/sports/${CORE[l]}/events/${ev}/competitions/${ev}/odds/100/propBets?limit=1000&page=${page}`;
const KALSHI = "https://api.elections.kalshi.com/trade-api/v2";
const KALSHI_SERIES: { [l in LinesLeague]: string } = { nfl: "KXNFLFIRSTTD", nba: "KXNBAFIRSTBASKET" };
const UA = { "user-agent": "Mozilla/5.0 (fantasy-hub line archive)" };

export const gameKey = (l: LinesLeague, season: number, ev: string) => `lines:v1:${l}:${season}:${ev}`;
export const eventsKey = (l: LinesLeague, season: number) => `lines:v1:${l}:${season}:events`;

async function json<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store", headers: UA, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
  return (await res.json()) as T;
}

/** The NFL season a date belongs to: January to July is the season before. */
const nflSeasonOf = (d: Date) => (d.getUTCMonth() < 7 ? d.getUTCFullYear() - 1 : d.getUTCFullYear());

export interface ScheduledGame {
  league: LinesLeague;
  season: number;
  event: string;
  away: string;
  home: string;
  tip?: string;
  state: string;
}

interface SbEvent {
  id: string;
  date?: string;
  status?: { type?: { state?: string } };
  competitions?: { competitors?: { homeAway?: string; team?: { abbreviation?: string } }[] }[];
}

function fromScoreboard(l: LinesLeague, events: SbEvent[]): ScheduledGame[] {
  return events.map((e) => {
    const cs = e.competitions?.[0]?.competitors ?? [];
    const tip = e.date;
    const d = tip ? new Date(tip) : new Date();
    return {
      league: l,
      season: l === "nba" ? nbaSeasonOfDate(d) : nflSeasonOf(d),
      event: e.id,
      away: cs.find((c) => c.homeAway === "away")?.team?.abbreviation ?? "",
      home: cs.find((c) => c.homeAway === "home")?.team?.abbreviation ?? "",
      tip,
      state: e.status?.type?.state ?? "",
    };
  });
}

/** NBA games from yesterday to tomorrow (Eastern), and the NFL's current week. */
export async function schedule(now: Date): Promise<{ games: ScheduledGame[]; problems: string[] }> {
  const games: ScheduledGame[] = [];
  const problems: string[] = [];
  for (const i of [-1, 0, 1]) {
    const d = etDate(new Date(now.getTime() + i * 86_400_000)).replace(/-/g, "");
    try {
      games.push(...fromScoreboard("nba", (await json<{ events?: SbEvent[] }>(`${SITE.nba}/scoreboard?dates=${d}`)).events ?? []));
    } catch (e) {
      problems.push(`ESPN NBA ${d}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  try {
    games.push(...fromScoreboard("nfl", (await json<{ events?: SbEvent[] }>(`${SITE.nfl}/scoreboard`)).events ?? []));
  } catch (e) {
    problems.push(`ESPN NFL: ${e instanceof Error ? e.message : String(e)}`);
  }
  return { games, problems };
}

async function propBets(l: LinesLeague, ev: string): Promise<PropBetRow[]> {
  const rows: PropBetRow[] = [];
  for (let page = 1; page <= 4; page++) {
    const d = await json<{ items?: PropBetRow[]; pageCount?: number }>(PROPS(l, ev, page));
    rows.push(...(d.items ?? []));
    if (!d.pageCount || page >= d.pageCount) break;
  }
  return rows;
}

/** Kalshi's codes and ESPN's, folded to one spelling so a game's two teams can be matched either way round. */
const FOLD: { [k: string]: string } = { JAC: "JAX", LA: "LAR", WAS: "WSH", GS: "GSW", NY: "NYK", SA: "SAS", NO: "NOP", UTAH: "UTA", PHO: "PHX", BRK: "BKN" };
const fold = (a: string) => FOLD[a] ?? a;
export const pairKey = (a: string, b: string) => [fold(a), fold(b)].sort().join("+");

/** Open markets in a Kalshi series, keyed by the game's two teams (unordered). */
async function kalshiSeries(series: string): Promise<Map<string, KalshiQuote[]>> {
  const ev = await json<{ events?: { event_ticker?: string; sub_title?: string }[] }>(`${KALSHI}/events?series_ticker=${series}&status=open&limit=200`);
  const games = new Map<string, string>();
  for (const e of ev.events ?? []) {
    const m = e.sub_title?.match(/^([A-Z]{2,4}) (?:vs|at|@) ([A-Z]{2,4})/);
    if (m && e.event_ticker) games.set(e.event_ticker, pairKey(m[1], m[2]));
  }
  const out = new Map<string, KalshiQuote[]>();
  if (!games.size) return out;
  const p = (s?: string) => {
    const v = Number(s);
    return Number.isFinite(v) && v > 0 && v < 1 ? v : null;
  };
  let cursor = "";
  for (let page = 0; page < 10; page++) {
    const r = await json<{ markets?: { event_ticker?: string; yes_sub_title?: string; yes_bid_dollars?: string; yes_ask_dollars?: string; last_price_dollars?: string }[]; cursor?: string }>(
      `${KALSHI}/markets?series_ticker=${series}&status=open&limit=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    );
    for (const m of r.markets ?? []) {
      const key = m.event_ticker ? games.get(m.event_ticker) : undefined;
      if (!key || !m.yes_sub_title) continue;
      out.set(key, [...(out.get(key) ?? []), { name: m.yes_sub_title.trim(), bid: p(m.yes_bid_dollars), ask: p(m.yes_ask_dollars), last: p(m.last_price_dollars) }]);
    }
    if (!r.cursor || !r.markets?.length) break;
    cursor = r.cursor;
  }
  return out;
}

export async function loadArchived(l: LinesLeague, season: number, ev: string): Promise<ArchivedGame | null> {
  return redis.get<ArchivedGame>(gameKey(l, season, ev));
}

export interface ArchiveReport {
  saved: string[];
  closed: string[];
  skipped: number;
  kalshi: { nfl: number; nba: number };
  problems: string[];
}

/** Run a few at a time: 25 games of two pages each is too many to fire at once. */
async function pool<T>(xs: T[], n: number, f: (x: T) => Promise<void>) {
  const q = [...xs];
  await Promise.all(Array.from({ length: n }, async () => { for (let x = q.shift(); x !== undefined; x = q.shift()) await f(x); }));
}

/** Save every pregame game's lines and close games that have started. Safe to call any time. */
export async function runLineArchive(now = new Date()): Promise<ArchiveReport> {
  const report: ArchiveReport = { saved: [], closed: [], skipped: 0, kalshi: { nfl: 0, nba: 0 }, problems: [] };
  const { games, problems } = await schedule(now);
  report.problems.push(...problems);
  const kalshi: { [l in LinesLeague]: Map<string, KalshiQuote[]> } = { nfl: new Map(), nba: new Map() };
  for (const l of ["nfl", "nba"] as const) {
    try {
      kalshi[l] = await kalshiSeries(KALSHI_SERIES[l]);
      report.kalshi[l] = kalshi[l].size;
    } catch (e) {
      report.problems.push(`Kalshi ${KALSHI_SERIES[l]}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const at = now.toISOString();
  await pool(games, 4, async (g) => {
    const label = `${g.league} ${g.away}@${g.home}`;
    try {
      const prev = await loadArchived(g.league, g.season, g.event);
      const started = g.state !== "pre" || (!!g.tip && new Date(g.tip) <= now);
      if (started) {
        if (prev && !prev.closedAt) {
          await redis.set(gameKey(g.league, g.season, g.event), closeLines(prev, at));
          report.closed.push(label);
        } else report.skipped++;
        return;
      }
      const fresh = readPropBets(await propBets(g.league, g.event), g.league);
      const k = kalshi[g.league].get(pairKey(g.league === "nfl" ? samTeam(g.away) : g.away, g.league === "nfl" ? samTeam(g.home) : g.home));
      if (!fresh.size && !k && !prev) {
        report.skipped++;
        return;
      }
      const next = mergeLines(prev ?? undefined, { league: g.league, season: g.season, event: g.event, away: g.away, home: g.home, ...(g.tip ? { tip: g.tip } : {}) }, fresh, at, k);
      await redis.set(gameKey(g.league, g.season, g.event), next);
      await redis.sadd(eventsKey(g.league, g.season), g.event);
      const c = lineCounts(next);
      report.saved.push(`${label} ${c.markets} markets, ${c.priced} priced`);
    } catch (e) {
      report.problems.push(`${label}: ${e instanceof Error ? e.message : String(e)}`);
    }
  });
  return report;
}

/** Every archived game for a league and season (for models and backtests). */
export async function archivedGames(l: LinesLeague, season: number): Promise<ArchivedGame[]> {
  const ids = (await redis.smembers(eventsKey(l, season))) ?? [];
  const out: ArchivedGame[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const vals = await redis.mget<(ArchivedGame | null)[]>(...chunk.map((id) => gameKey(l, season, id)));
    for (const v of vals) if (v) out.push(v);
  }
  return out;
}
