// One search entry per organisation (Jack, 2026-11-03: "If I search south
// carolina, all that should pop up is south carolina with its logo"). Pro
// teams key on a normalised abbreviation; college keys on ESPN's team id,
// which ESPN shares across a school's football and basketball, so South
// Carolina football and hoops become one entry. Pure: the search route feeds
// it this week's boards, the header box filters it on the client.

import type { PicksReport } from "@/lib/picks/report";
import type { NbaBoard } from "@/lib/picks/nba-store";
import type { CbbBoard } from "@/lib/models/cbb/store";
import { NFL_TEAMS } from "@/lib/picks/teams";

export type TeamSport = "NFL" | "CFB" | "NBA" | "CBB";

export interface TeamEntry {
  /** "nfl:PHI", "nba:DEN", "ncaa:2579" (ESPN team id); "cfb:<board key>" for a college team with no ESPN id. */
  key: string;
  name: string;
  sports: TeamSport[];
  logo: { league: "nfl" | "nba" | "cfb"; team?: string; espnId?: string };
  /** Lowercased name, short name, nickname, abbreviation, city. */
  terms: string;
  /** Header search entry keys of this team's games this week, hidden when the team row shows. */
  games: string[];
}

const SPORT_ORDER: TeamSport[] = ["NFL", "CFB", "NBA", "CBB"];

/* ------------------------------------------------------- abbreviations -- */

// Same canonical codes as components/hh/team.tsx (its colour tables).
const NFL_ALIAS: Record<string, string> = { WSH: "WAS", LA: "LAR", JAC: "JAX", OAK: "LV", SD: "LAC", STL: "LAR" };
const NBA_ALIAS: Record<string, string> = { BRK: "BKN", GSW: "GS", NOP: "NO", NYK: "NY", PHO: "PHX", SAS: "SA", UTAH: "UTA", WSH: "WAS" };

export const nflAbbr = (x: string) => {
  const up = x.trim().toUpperCase();
  return NFL_ALIAS[up] ?? up;
};
export const nbaAbbr = (x: string) => {
  const up = x.trim().toUpperCase();
  return NBA_ALIAS[up] ?? up;
};

/* ------------------------------------------------------- static lists -- */

/** NFL: canonical abbreviation to [city, nickname], from the models' own name table. */
export const NFL_LIST: Record<string, [string, string]> = Object.fromEntries(
  Object.entries(NFL_TEAMS).map(([full, abbr]) => {
    const parts = full.split(" ");
    return [nflAbbr(abbr), [parts.slice(0, -1).join(" "), parts[parts.length - 1]]];
  }),
);

/** NBA: canonical abbreviation to [city, nickname]. */
export const NBA_LIST: Record<string, [string, string]> = {
  ATL: ["Atlanta", "Hawks"], BOS: ["Boston", "Celtics"], BKN: ["Brooklyn", "Nets"], CHA: ["Charlotte", "Hornets"],
  CHI: ["Chicago", "Bulls"], CLE: ["Cleveland", "Cavaliers"], DAL: ["Dallas", "Mavericks"], DEN: ["Denver", "Nuggets"],
  DET: ["Detroit", "Pistons"], GS: ["Golden State", "Warriors"], HOU: ["Houston", "Rockets"], IND: ["Indiana", "Pacers"],
  LAC: ["LA", "Clippers"], LAL: ["Los Angeles", "Lakers"], MEM: ["Memphis", "Grizzlies"], MIA: ["Miami", "Heat"],
  MIL: ["Milwaukee", "Bucks"], MIN: ["Minnesota", "Timberwolves"], NO: ["New Orleans", "Pelicans"], NY: ["New York", "Knicks"],
  OKC: ["Oklahoma City", "Thunder"], ORL: ["Orlando", "Magic"], PHI: ["Philadelphia", "76ers"], PHX: ["Phoenix", "Suns"],
  POR: ["Portland", "Trail Blazers"], SAC: ["Sacramento", "Kings"], SA: ["San Antonio", "Spurs"], TOR: ["Toronto", "Raptors"],
  UTA: ["Utah", "Jazz"], WAS: ["Washington", "Wizards"],
};

const NICK_EXTRA: Record<string, string> = { "nba:PHI": "sixers", "nba:MIN": "wolves", "nba:LAC": "los angeles", "nba:POR": "blazers", "nba:CLE": "cavs", "nba:DAL": "mavs" };

/** Display name of a pro team from its key ("nfl:PHI" -> "Philadelphia Eagles"), or null when unknown. */
export function proName(key: string): string | null {
  const [lg, abbr] = key.split(":");
  const row = lg === "nfl" ? NFL_LIST[abbr] : lg === "nba" ? NBA_LIST[abbr] : undefined;
  return row ? `${row[0]} ${row[1]}` : null;
}

/* -------------------------------------------------------------- build -- */

export interface TeamIndexInput {
  nfl?: PicksReport | null;
  cfb?: PicksReport | null;
  nba?: NbaBoard | null;
  cbb?: CbbBoard | null;
}

type Draft = { key: string; name: string; sports: Set<TeamSport>; logo: TeamEntry["logo"]; terms: Set<string>; games: Set<string> };

export function buildTeamIndex({ nfl, cfb, nba, cbb }: TeamIndexInput): TeamEntry[] {
  const by = new Map<string, Draft>();
  const add = (key: string, name: string, sport: TeamSport, logo: TeamEntry["logo"], terms: (string | undefined)[], game?: string) => {
    const d = by.get(key) ?? { key, name, sports: new Set<TeamSport>(), logo, terms: new Set<string>(), games: new Set<string>() };
    by.set(key, d);
    d.sports.add(sport);
    if (!d.logo.espnId && logo.espnId) d.logo = logo;
    for (const t of terms) if (t && t.trim()) d.terms.add(t.trim().toLowerCase());
    if (game) d.games.add(game);
  };

  // Every pro team, game or not.
  for (const [abbr, [city, nick]] of Object.entries(NFL_LIST)) add(`nfl:${abbr}`, `${city} ${nick}`, "NFL", { league: "nfl", team: abbr }, [`${city} ${nick}`, city, nick, abbr]);
  for (const [abbr, [city, nick]] of Object.entries(NBA_LIST)) add(`nba:${abbr}`, `${city} ${nick}`, "NBA", { league: "nba", team: abbr }, [`${city} ${nick}`, city, nick, abbr, NICK_EXTRA[`nba:${abbr}`]]);

  // This week's NFL games, so their search rows hide behind the team.
  for (const g of nfl?.board ?? []) {
    const entry = `NFL picks:${g.away}@${g.home}`;
    for (const k of [g.home, g.away]) {
      const key = `nfl:${nflAbbr(k)}`;
      add(key, proName(key) ?? nfl!.names[k] ?? k, "NFL", { league: "nfl", team: nflAbbr(k) }, [k, nfl!.names[k]], entry);
    }
  }

  // College football: ESPN ids from the quote; a team with none keys on its board name.
  for (const g of cfb?.board ?? []) {
    const ref = g.ref ?? g.lastRef;
    const entry = `CFB picks:${g.away}@${g.home}`;
    for (const [k, id] of [[g.home, ref?.homeId], [g.away, ref?.awayId]] as const) {
      const name = cfb!.names[k] ?? k;
      add(id ? `ncaa:${id}` : `cfb:${k}`, name, "CFB", { league: "cfb", espnId: id }, [name, k], entry);
    }
  }

  for (const g of [...(nba?.yesterday?.games ?? []), ...(nba?.days.flatMap((d) => d.games) ?? [])]) {
    for (const t of [g.home, g.away]) {
      const key = `nba:${nbaAbbr(t.abbr)}`;
      add(key, proName(key) ?? t.name, "NBA", { league: "nba", team: nbaAbbr(t.abbr) }, [t.abbr, t.name, t.short], `nba:${g.id}`);
    }
  }

  for (const { g } of cbb?.days.flatMap((d) => d.rows) ?? []) {
    for (const t of [g.home, g.away]) {
      const key = `ncaa:${t.id}`;
      add(key, t.name, "CBB", { league: "cfb", espnId: t.id }, [t.name, t.short, t.abbr], `cbb:${g.id}`);
      // Basketball's ESPN location is the cleanest school name; it wins over a football board's spelling.
      by.get(key)!.name = t.name;
    }
  }

  return [...by.values()]
    .map((d) => ({
      key: d.key,
      name: d.name,
      sports: SPORT_ORDER.filter((s) => d.sports.has(s)),
      logo: d.logo,
      terms: [...d.terms].join(" "),
      games: [...d.games],
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/* ------------------------------------------------------------- search -- */

const fold = (x: string) => x.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[.'’]/g, "");

/** Teams matching every word of the query; names that start with the query first. */
export function searchTeams(teams: TeamEntry[], q: string): TeamEntry[] {
  const words = fold(q).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const query = words.join(" ");
  const score = (t: TeamEntry) => (fold(t.name).startsWith(query) ? 0 : words.every((w) => fold(t.name).includes(w)) ? 1 : 2);
  return teams
    .filter((t) => {
      const hay = fold(`${t.name} ${t.terms}`);
      // A one- or two-letter word must match a whole term ("sc", "gs"), not any name containing it.
      return words.every((w) => (w.length <= 2 ? hay.split(/\s+/).includes(w) : hay.includes(w)));
    })
    .sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name))
    // Searching a team's exact name shows just that team (Jack, 2026-11-04: "all that should pop up is south carolina"),
    // not every school whose name contains it (South Carolina State, SC Upstate).
    .filter((t, _i, all) => !all.some((x) => fold(x.name) === query) || fold(t.name) === query);
}

/** "College football · College hoops", "NFL", "NBA". */
export const SPORT_WORDS: Record<TeamSport, string> = { NFL: "NFL", CFB: "College football", NBA: "NBA", CBB: "College hoops" };
export const sportsLine = (s: TeamSport[]) => s.map((x) => SPORT_WORDS[x]).join(" · ");
