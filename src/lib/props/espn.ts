// Two free ESPN feeds for the same markets as Sam's props pages.
//
// 1. ESPN's fantasy projections (the kona_player_info view, no key): a third
//    projection, next to Sam's and Rotowire's. Matched by full name.
// 2. ESPN's core odds API propBets (provider 100 = DraftKings): each player
//    market's opening line and current line, no prices. The opening line is
//    earlier than Sam's first page, so it shows which way the market went
//    from the very start. Players come as ESPN athlete ids, named from the
//    two teams' rosters.

import type { PropMarket, Stat } from "./parse";
import { nameKey } from "./grade";

const FANTASY = (season: number, week: number) =>
  `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leaguedefaults/3?view=kona_player_info&scoringPeriodId=${week}`;
const PROPS = (event: string, page: number) =>
  `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/events/${event}/competitions/${event}/odds/100/propBets?limit=1000&page=${page}`;
const ROSTER = (teamId: string) => `https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${teamId}/roster`;

// ESPN fantasy stat ids.
const STAT_ID: { [s in Stat]?: string } = { pass_yds: "3", rush_yds: "24", rec_yds: "42", rec: "53" };
const PROP_TYPE: { [name: string]: Stat } = {
  "Total Passing Yards (incl. overtime)": "pass_yds",
  "Total Rushing Yards (incl. overtime)": "rush_yds",
  "Total Receiving Yards (incl. overtime)": "rec_yds",
  "Total Receptions (incl. overtime)": "rec",
};

async function json<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(url, { cache: "no-store", headers, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
  return (await res.json()) as T;
}

export interface FantasyPlayer {
  player?: { fullName?: string; stats?: { id?: string; stats?: { [k: string]: number } }[] };
}

/** Week projections keyed by name: { "jaxonsmithnjigba": { "42": 90.6, ... } }. */
export function indexEspnProjections(players: FantasyPlayer[], season: number, week: number): Map<string, { [k: string]: number }> {
  const id = `11${season}${week}`;
  const out = new Map<string, { [k: string]: number }>();
  for (const p of players) {
    const name = p.player?.fullName;
    const st = p.player?.stats?.find((x) => x.id === id)?.stats;
    if (!name || !st) continue;
    const k = nameKey(name);
    // Two players with one name: keep neither rather than guess.
    if (out.has(k)) out.set(k, {});
    else out.set(k, st);
  }
  return out;
}

export function espnFor(markets: PropMarket[], idx: Map<string, { [k: string]: number }>): { [id: string]: number } {
  const out: { [id: string]: number } = {};
  for (const m of markets) {
    const sid = m.stat ? STAT_ID[m.stat] : undefined;
    if (!sid) continue;
    const v = idx.get(nameKey(m.player))?.[sid];
    if (typeof v === "number" && Number.isFinite(v)) out[m.id] = Math.round(v * 10) / 10;
  }
  return out;
}

export async function fetchEspnProjections(season: number, week: number) {
  const filter = {
    players: {
      filterSlotIds: { value: [0, 2, 4, 6, 23] },
      filterStatsForTopScoringPeriodIds: { value: 2, additionalValue: [`11${season}${week}`] },
      limit: 1500,
      sortPercOwned: { sortPriority: 1, sortAsc: false },
    },
  };
  const d = await json<{ players?: FantasyPlayer[] }>(FANTASY(season, week), { "x-fantasy-filter": JSON.stringify(filter) });
  return indexEspnProjections(d.players ?? [], season, week);
}

export interface PropBet {
  type?: { name?: string };
  athlete?: { $ref?: string };
  open?: { target?: { value?: number } };
  current?: { target?: { value?: number } };
}

/** DraftKings open and current line per (athlete id, stat). Over and under rows repeat; the first wins. */
export function indexDkLines(items: PropBet[]): Map<string, { open: number; current: number }> {
  const out = new Map<string, { open: number; current: number }>();
  for (const x of items) {
    const stat = PROP_TYPE[x.type?.name ?? ""];
    const athlete = x.athlete?.$ref?.match(/athletes\/(\d+)/)?.[1];
    const open = x.open?.target?.value;
    const current = x.current?.target?.value;
    if (!stat || !athlete || typeof open !== "number" || typeof current !== "number") continue;
    const k = `${athlete}|${stat}`;
    if (!out.has(k)) out.set(k, { open, current });
  }
  return out;
}

export function dkFor(
  markets: PropMarket[],
  lines: Map<string, { open: number; current: number }>,
  names: Map<string, string>, // name key -> athlete id
): { [id: string]: { open: number; current: number } } {
  const out: { [id: string]: { open: number; current: number } } = {};
  for (const m of markets) {
    const a = m.stat ? names.get(nameKey(m.player)) : undefined;
    const l = a ? lines.get(`${a}|${m.stat}`) : undefined;
    if (l) out[m.id] = l;
  }
  return out;
}

/** DraftKings' prop lines for one game, matched to names from both rosters. */
export async function fetchDkLines(event: string, teamIds: string[], markets: PropMarket[]) {
  const items: PropBet[] = [];
  for (let page = 1; page <= 4; page++) {
    const d = await json<{ items?: PropBet[]; pageCount?: number }>(PROPS(event, page));
    items.push(...(d.items ?? []));
    if (!d.pageCount || page >= d.pageCount) break;
  }
  const names = new Map<string, string>();
  for (const t of teamIds) {
    const r = await json<{ athletes?: { items?: { id?: string; fullName?: string }[] }[] }>(ROSTER(t));
    for (const g of r.athletes ?? []) for (const a of g.items ?? []) if (a.id && a.fullName) names.set(nameKey(a.fullName), a.id);
  }
  return dkFor(markets, indexDkLines(items), names);
}
