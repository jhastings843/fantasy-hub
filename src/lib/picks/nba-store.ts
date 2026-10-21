import "server-only";
import { type NbaGame, type NbaRead, type SamNbaStatus, nbaNameIndex, parseNbaScoreboard, parseNbaSummaryOdds, parseSamNba, readNba } from "./nba";

// The NBA board: the next few game days from ESPN's public scoreboard
// (DraftKings lines, no key) with Sam's NBA board joined on. Nothing is
// saved yet: until Sam's NBA picks exist there is no record to keep.

export const NBA_SOURCES = {
  samBoard: "https://samthemodelman.smmodel.workers.dev/nba/",
  espn: "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard",
  espnSummary: "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary",
} as const;

const LOOKAHEAD_DAYS = 7;
const SHOW_DAYS = 3;

export type NbaBoardGame = NbaGame & { read: NbaRead | null };
export type NbaDay = { day: string; games: NbaBoardGame[] };
export type NbaBoard = {
  generatedAt: string;
  sam: SamNbaStatus;
  days: NbaDay[];
  /** Yesterday's games (Eastern), for the board's "last night" block. Sam's read comes from the saved copy, not his page. */
  yesterday: NbaDay | null;
  /** Sam's games that didn't join an ESPN game in the days shown. */
  unmatched: string[];
  problems: string[];
};

/** YYYYMMDD in Eastern time, `plus` days from `now`. */
export function etDay(now: Date, plus = 0): string {
  const d = new Date(now.getTime() + plus * 86_400_000);
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}${p.month}${p.day}`;
}

async function get(url: string): Promise<Response> {
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
  return res;
}

export async function getNbaBoard(now = new Date()): Promise<NbaBoard> {
  const problems: string[] = [];
  const dates = Array.from({ length: LOOKAHEAD_DAYS }, (_, i) => etDay(now, i));
  const [slates, prior, samHtml] = await Promise.all([
    Promise.all(
      dates.map(async (d) => {
        try {
          return parseNbaScoreboard(await (await get(`${NBA_SOURCES.espn}?dates=${d}`)).json(), d);
        } catch (e) {
          problems.push(`ESPN ${d}: ${(e as Error).message}`);
          return [];
        }
      }),
    ),
    get(`${NBA_SOURCES.espn}?dates=${etDay(now, -1)}`)
      .then(async (r) => parseNbaScoreboard(await r.json(), etDay(now, -1)))
      .catch((e: Error) => {
        problems.push(`ESPN ${etDay(now, -1)}: ${e.message}`);
        return [] as NbaGame[];
      }),
    get(NBA_SOURCES.samBoard)
      .then((r) => r.text())
      .catch((e: Error) => e),
  ]);

  const days = slates.filter((g) => g.length).slice(0, SHOW_DAYS);
  // Live and final games lose their odds on the scoreboard; the game summary keeps the close.
  await Promise.all(
    days
      .flat()
      .concat(prior)
      .filter((g) => g.state !== "pre" && !g.line && !g.total && !g.ml)
      .map(async (g) => {
        try {
          Object.assign(g, parseNbaSummaryOdds(await (await get(`${NBA_SOURCES.espnSummary}?event=${g.id}`)).json()));
        } catch (e) {
          problems.push(`ESPN summary ${g.id}: ${(e as Error).message}`);
        }
      }),
  );
  const all = days.flat();
  const sam: SamNbaStatus = samHtml instanceof Error ? { state: "down", error: samHtml.message } : parseSamNba(samHtml, nbaNameIndex(slates.flat()));

  const rows = sam.state === "live" ? sam.rows : [];
  const used = new Set<number>();
  const board: NbaDay[] = days.map((gs) => ({
    day: gs[0].day,
    games: gs.map((g) => {
      const i = rows.findIndex((r, j) => !used.has(j) && r.home === g.home.abbr && r.away === g.away.abbr);
      if (i >= 0) used.add(i);
      return { ...g, read: readNba(g, i >= 0 ? rows[i] : undefined) };
    }),
  }));
  // Only names that never mapped to a team; a game on a later day isn't a miss.
  const abbrs = new Set(slates.flat().flatMap((g) => [g.home.abbr, g.away.abbr]));
  const unmatched = rows.filter((r) => !abbrs.has(r.home) || !abbrs.has(r.away)).map((r) => `${r.away} at ${r.home}`);
  if (!all.length) problems.push(`No NBA games on ESPN in the next ${LOOKAHEAD_DAYS} days.`);
  const yesterday = prior.length ? { day: prior[0].day, games: prior.map((g) => ({ ...g, read: null })) } : null;
  return { generatedAt: now.toISOString(), sam, days: board, yesterday, unmatched, problems };
}
