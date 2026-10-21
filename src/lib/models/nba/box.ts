// One NBA game, cut down from ESPN's summary (site.api.espn.com .../nba/summary?event=)
// to what our models use: each player's line, both teams' possessions, the
// DraftKings spread and total ESPN keeps in pickcenter (pre-game numbers,
// still there after the final), the opening jump ball, and every shot up to
// the first made field goal. A summary is about 400KB; this is about 4KB.

export interface NbaPlayerLine {
  id: string;
  name: string;
  team: string;
  pos: string; // "G" | "F" | "C" (ESPN's), "" when missing
  starter: boolean;
  min: number;
  pts: number;
  reb: number;
  ast: number;
  threes: number;
  fga: number;
  fgm: number;
  fta: number;
}

export interface NbaShot {
  player: string;
  team: string;
  made: boolean;
}

export interface NbaGame {
  id: string;
  date: string; // tip, ISO
  home: string;
  away: string;
  /** Home spread (negative: home favored) and the total, DraftKings via ESPN. Null when missing. */
  spread: number | null;
  total: number | null;
  score: { [team: string]: number };
  /** Possessions per team: FGA + 0.44 x FTA - OREB + TOV. */
  poss: { [team: string]: number };
  players: NbaPlayerLine[];
  /** The opening tip: the two jumpers (ids) and the team that gained possession. */
  jump: { jumpers: string[]; team: string } | null;
  /** Field goal attempts (no free throws) in order, up to and including the first make. */
  shots: NbaShot[];
}

interface Stat {
  name?: string;
  keys?: string[];
  athletes?: { athlete?: { id?: string; displayName?: string; position?: { abbreviation?: string } }; starter?: boolean; didNotPlay?: boolean; stats?: string[] }[];
}
export interface EspnNbaSummary {
  header?: { competitions?: { date?: string; status?: { type?: { completed?: boolean } }; competitors?: { homeAway?: string; score?: string; team?: { id?: string; abbreviation?: string } }[] }[] };
  boxscore?: {
    teams?: { team?: { abbreviation?: string }; statistics?: { name?: string; displayValue?: string }[] }[];
    players?: { team?: { abbreviation?: string }; statistics?: Stat[] }[];
  };
  pickcenter?: { provider?: { name?: string }; spread?: number; overUnder?: number; homeTeamOdds?: { favorite?: boolean } }[];
  plays?: { type?: { text?: string }; text?: string; team?: { id?: string }; scoringPlay?: boolean; shootingPlay?: boolean; participants?: { athlete?: { id?: string } }[] }[];
}

const first = (s: string | undefined) => Number(String(s ?? "").split("-")[0]);
const second = (s: string | undefined) => Number(String(s ?? "").split("-")[1]);

/** The game in our shape, or null when it isn't final or has no box score. */
export function compactGame(id: string, s: EspnNbaSummary): NbaGame | null {
  const comp = s.header?.competitions?.[0];
  if (!comp?.status?.type?.completed) return null;
  const cs = comp.competitors ?? [];
  const home = cs.find((c) => c.homeAway === "home");
  const away = cs.find((c) => c.homeAway === "away");
  if (!home?.team?.abbreviation || !away?.team?.abbreviation) return null;
  const abbrOf = new Map(cs.map((c) => [c.team?.id ?? "", c.team?.abbreviation ?? ""]));

  const players: NbaPlayerLine[] = [];
  for (const t of s.boxscore?.players ?? []) {
    const team = t.team?.abbreviation ?? "";
    for (const table of t.statistics ?? []) {
      const keys = table.keys ?? [];
      const at = (st: string[] | undefined, k: string) => st?.[keys.indexOf(k)];
      for (const a of table.athletes ?? []) {
        if (!a.athlete?.id || a.didNotPlay || !a.stats?.length) continue;
        const min = Number(at(a.stats, "minutes"));
        if (!Number.isFinite(min) || min <= 0) continue;
        const fg = at(a.stats, "fieldGoalsMade-fieldGoalsAttempted");
        const row: NbaPlayerLine = {
          id: a.athlete.id,
          name: a.athlete.displayName ?? "",
          team,
          pos: a.athlete.position?.abbreviation ?? "",
          starter: !!a.starter,
          min,
          pts: Number(at(a.stats, "points")),
          reb: Number(at(a.stats, "rebounds")),
          ast: Number(at(a.stats, "assists")),
          threes: first(at(a.stats, "threePointFieldGoalsMade-threePointFieldGoalsAttempted")),
          fga: second(fg),
          fgm: first(fg),
          fta: second(at(a.stats, "freeThrowsMade-freeThrowsAttempted")),
        };
        if ([row.pts, row.reb, row.ast, row.threes, row.fga, row.fgm, row.fta].every(Number.isFinite)) players.push(row);
      }
    }
  }
  if (!players.length) return null;

  const poss: { [team: string]: number } = {};
  for (const t of s.boxscore?.teams ?? []) {
    const v = (n: string) => t.statistics?.find((x) => x.name === n)?.displayValue;
    const fga = second(v("fieldGoalsMade-fieldGoalsAttempted"));
    const fta = second(v("freeThrowsMade-freeThrowsAttempted"));
    const oreb = Number(v("offensiveRebounds"));
    const tov = Number(v("totalTurnovers") ?? v("turnovers"));
    const p = fga + 0.44 * fta - oreb + tov;
    if (t.team?.abbreviation && Number.isFinite(p)) poss[t.team.abbreviation] = Math.round(p * 10) / 10;
  }

  const pc = s.pickcenter?.find((p) => p.provider?.name === "DraftKings") ?? s.pickcenter?.[0];
  // ESPN's spread is the favorite's number; homeTeamOdds.favorite says whose.
  const spread = typeof pc?.spread === "number" ? (pc.homeTeamOdds?.favorite === false ? Math.abs(pc.spread) : -Math.abs(pc.spread)) : null;
  const total = typeof pc?.overUnder === "number" ? pc.overUnder : null;

  let jump: NbaGame["jump"] = null;
  const shots: NbaShot[] = [];
  for (const p of s.plays ?? []) {
    const type = p.type?.text ?? "";
    if (!jump && /jump ?ball/i.test(type) && shots.length === 0) {
      const ids = (p.participants ?? []).map((x) => x.athlete?.id ?? "");
      const team = abbrOf.get(p.team?.id ?? "") ?? "";
      if (ids.length >= 2 && team) jump = { jumpers: ids.slice(0, 2), team };
      continue;
    }
    if (!p.shootingPlay || /free throw/i.test(type) || /free throw/i.test(p.text ?? "")) continue;
    const player = p.participants?.[0]?.athlete?.id ?? "";
    const team = abbrOf.get(p.team?.id ?? "") ?? "";
    if (!player || !team) continue;
    shots.push({ player, team, made: !!p.scoringPlay });
    if (p.scoringPlay) break;
  }

  return {
    id,
    date: comp.date ?? "",
    home: home.team.abbreviation,
    away: away.team.abbreviation,
    spread,
    total,
    score: { [home.team.abbreviation]: Number(home.score), [away.team.abbreviation]: Number(away.score) },
    poss,
    players,
    jump,
    shots,
  };
}
