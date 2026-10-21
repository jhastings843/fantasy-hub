// nflverse's weekly player stats (release `stats_player`, file
// stats_player_week_{season}.csv) cut down to what our NFL models use, and
// its games file (nfldata games.csv: spread, total, ESPN event id). Pure.

export interface NflRow {
  id: string; // gsis
  name: string; // display name, "Drake Maye"
  pos: string;
  season: number;
  week: number;
  game: string; // "2026_07_NE_CHI"
  team: string;
  opp: string;
  att: number;
  passYds: number;
  passTd: number;
  car: number;
  rushYds: number;
  rushTd: number;
  tgt: number;
  rec: number;
  recYds: number;
  recTd: number;
}

export interface NflGameLine {
  game: string;
  season: number;
  week: number;
  home: string;
  away: string;
  /** Expected home margin (nflverse's spread_line: positive, home favored). Null when missing. */
  homeMargin: number | null;
  total: number | null;
  espn: string;
  gameday: string;
  gametime: string;
}

/** A small CSV reader: quoted fields with commas and doubled quotes. */
export function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let f = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          f += '"';
          i++;
        } else q = false;
      } else f += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      row.push(f);
      f = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(f);
      out.push(row);
      row = [];
      f = "";
    } else f += c;
  }
  if (f || row.length) {
    row.push(f);
    out.push(row);
  }
  return out.filter((r) => r.length > 1);
}

const records = (text: string) => {
  const [head, ...rows] = parseCsv(text);
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])) as Record<string, string>);
};
const n = (s: string | undefined) => {
  const v = Number(s);
  return Number.isFinite(v) ? v : 0;
};

export const SKILL = new Set(["QB", "RB", "FB", "WR", "TE"]);

/** Regular-season rows for skill positions. */
export function readStats(text: string): NflRow[] {
  return records(text)
    .filter((r) => r.season_type === "REG" && SKILL.has(r.position))
    .map((r) => ({
      id: r.player_id,
      name: r.player_display_name || r.player_name,
      pos: r.position === "FB" ? "RB" : r.position,
      season: n(r.season),
      week: n(r.week),
      game: r.game_id,
      team: r.team,
      opp: r.opponent_team,
      att: n(r.attempts),
      passYds: n(r.passing_yards),
      passTd: n(r.passing_tds),
      car: n(r.carries),
      rushYds: n(r.rushing_yards),
      rushTd: n(r.rushing_tds),
      tgt: n(r.targets),
      rec: n(r.receptions),
      recYds: n(r.receiving_yards),
      recTd: n(r.receiving_tds),
    }));
}

export function readGames(text: string): NflGameLine[] {
  return records(text)
    .filter((r) => r.game_type === "REG")
    .map((r) => ({
      game: r.game_id,
      season: n(r.season),
      week: n(r.week),
      home: r.home_team,
      away: r.away_team,
      homeMargin: r.spread_line === "" ? null : n(r.spread_line),
      total: r.total_line === "" ? null : n(r.total_line),
      espn: r.espn,
      gameday: r.gameday,
      gametime: r.gametime,
    }));
}

/** nflverse gsis id to ESPN athlete id, from the players file. */
export function readEspnIds(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of records(text)) if (r.gsis_id && r.espn_id) out.set(r.gsis_id, r.espn_id);
  return out;
}
