// Live scores and box-score stats from ESPN's free site API (Jack, 2026-10-22:
// "live scores that update every 10 or so mins"). Read on page load with a
// one-minute cache, so a page refreshing every 10 minutes costs one ESPN call
// per live game at most. Lines are not here: ESPN drops the betting lines at
// kickoff, and live lines from The Odds API would cost thousands of credits a
// month.

import { boxStats, nameKey, nbaBoxStats, type EspnBoxTeam } from "@/lib/props/grade";

const BASE = "https://site.api.espn.com/apis/site/v2/sports";
const PATH = { nfl: "football/nfl", cfb: "football/college-football", nba: "basketball/nba" } as const;
export type LiveSport = keyof typeof PATH;

export interface LiveTeam {
  abbr: string;
  name: string;
  /** School or city, the way the college board names teams ("Missouri State"). */
  location: string;
  score: number;
}
export interface LiveGame {
  id: string;
  state: "pre" | "in" | "post";
  /** ESPN's short status: "Q3 4:12", "Halftime", "Final". */
  detail: string;
  away: LiveTeam;
  home: LiveTeam;
}

interface EspnCompetitor {
  homeAway?: string;
  score?: string;
  team?: { abbreviation?: string; displayName?: string; shortDisplayName?: string; location?: string };
}
interface EspnCompetition {
  status?: { type?: { state?: string; shortDetail?: string } };
  competitors?: EspnCompetitor[];
}

async function get<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { next: { revalidate: 60 }, signal: AbortSignal.timeout(8000) });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

function toGame(id: string, c: EspnCompetition | undefined): LiveGame | null {
  const cs = c?.competitors ?? [];
  const team = (side: "home" | "away"): LiveTeam | null => {
    const x = cs.find((t) => t.homeAway === side);
    if (!x?.team) return null;
    return { abbr: x.team.abbreviation ?? "", name: x.team.shortDisplayName ?? x.team.displayName ?? "", location: x.team.location ?? "", score: Number(x.score) || 0 };
  };
  const home = team("home");
  const away = team("away");
  if (!home || !away) return null;
  const st = c?.status?.type?.state;
  return { id, state: st === "in" ? "in" : st === "post" ? "post" : "pre", detail: c?.status?.type?.shortDetail ?? "", away, home };
}

/** Today's scoreboard for a league. College asks for every FBS game. */
export async function scoreboard(sport: LiveSport): Promise<LiveGame[]> {
  const q = sport === "cfb" ? "?groups=80&limit=300" : "";
  const d = await get<{ events?: { id?: string; competitions?: EspnCompetition[] }[] }>(`${BASE}/${PATH[sport]}/scoreboard${q}`);
  return (d?.events ?? []).flatMap((e) => {
    const g = e.id ? toGame(e.id, e.competitions?.[0]) : null;
    return g ? [g] : [];
  });
}

/** One game's score and every player's stats so far, by name key. */
export async function liveBox(sport: "nfl" | "nba", id: string): Promise<{ game: LiveGame | null; stats: Map<string, { [k: string]: number }> }> {
  const d = await get<{ header?: { competitions?: EspnCompetition[] }; boxscore?: { players?: EspnBoxTeam[] } }>(`${BASE}/${PATH[sport]}/summary?event=${id}`);
  const players = d?.boxscore?.players ?? [];
  const stats = (sport === "nfl" ? boxStats(players) : nbaBoxStats(players)) as Map<string, { [k: string]: number }>;
  return { game: toGame(id, d?.header?.competitions?.[0]), stats };
}

// Board keys to ESPN teams: the NFL board uses abbreviations (a few differ from ESPN's), college uses school names.
const NFL_ALIAS: { [k: string]: string } = { WAS: "WSH", LA: "LAR", JAC: "JAX" };

/** The live game for a board matchup, matched by team on both sides. */
export function findGame(games: LiveGame[], sport: LiveSport, away: string, home: string): LiveGame | undefined {
  const is = (t: LiveTeam, key: string) =>
    sport === "cfb" ? [t.location, t.name, t.abbr].some((x) => x && nameKey(x) === nameKey(key)) : t.abbr === (NFL_ALIAS[key] ?? key) || t.abbr === key;
  return games.find((g) => is(g.away, away) && is(g.home, home));
}

interface EspnBroadcastComp {
  broadcasts?: { names?: string[]; market?: string }[];
  geoBroadcasts?: { media?: { shortName?: string }; market?: { type?: string } }[];
}

/** The channel per ESPN event id on today's / this week's scoreboard: a national feed when listed, else the first. One cached call. */
export async function tvByEvent(sport: LiveSport): Promise<Map<string, string>> {
  const q = sport === "cfb" ? "?groups=80&limit=300" : "";
  const d = await get<{ events?: { id?: string; competitions?: EspnBroadcastComp[] }[] }>(`${BASE}/${PATH[sport]}/scoreboard${q}`);
  const out = new Map<string, string>();
  for (const e of d?.events ?? []) {
    const c = e.competitions?.[0];
    const all = [
      ...(c?.geoBroadcasts ?? []).map((b) => ({ name: b.media?.shortName, national: /national/i.test(b.market?.type ?? "") })),
      ...(c?.broadcasts ?? []).flatMap((b) => (b.names ?? []).map((n) => ({ name: n, national: /national/i.test(b.market ?? "") }))),
    ].filter((b) => b.name);
    const pick = all.find((b) => b.national) ?? all[0];
    if (e.id && pick?.name) out.set(e.id, pick.name);
  }
  return out;
}
