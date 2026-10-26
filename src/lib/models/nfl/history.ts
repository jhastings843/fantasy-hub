// nflverse rows (data.ts) into the NFL model's inputs (props.ts): team totals
// per game, each player's games with his team's totals alongside, a prior
// season's summary, and a running season for the walk-forward fit and the
// live run. Pure.

import type { NflRow } from "./data";
import type { NflBase, NflPlayerInput, NflPos, NflTeamInput, PlayerGame, PriorPlayer } from "./props";

const POS: NflPos[] = ["QB", "RB", "WR", "TE"];
export const nflPos = (p: string): NflPos => (POS.includes(p as NflPos) ? (p as NflPos) : "WR");

export interface TeamGame {
  game: string;
  week: number;
  team: string;
  att: number;
  car: number;
  tgt: number;
}

/** Team totals per game, keyed "game|team". */
export function teamGames(rows: NflRow[]): Map<string, TeamGame> {
  const out = new Map<string, TeamGame>();
  for (const r of rows) {
    const k = `${r.game}|${r.team}`;
    const t = out.get(k) ?? { game: r.game, week: r.week, team: r.team, att: 0, car: 0, tgt: 0 };
    t.att += r.att;
    t.car += r.car;
    t.tgt += r.tgt;
    out.set(k, t);
  }
  return out;
}

export function playerGame(r: NflRow, t: TeamGame): PlayerGame {
  return { week: r.week, team: r.team, att: r.att, passYds: r.passYds, car: r.car, rushYds: r.rushYds, tgt: r.tgt, rec: r.rec, recYds: r.recYds, teamAtt: t.att, teamCar: t.car, teamTgt: t.tgt };
}

export interface NflSummary {
  base: NflBase;
  players: { [id: string]: PriorPlayer };
  teams: { [team: string]: { att: number; car: number } };
}

export function summarizeNfl(rows: NflRow[]): NflSummary {
  const tg = teamGames(rows);
  const players: { [id: string]: PriorPlayer } = {};
  const shares = Object.fromEntries(POS.map((p) => [p, { tgt: [0, 0], car: [0, 0], att: [0, 0], recYds: 0, tgtN: 0, rec: 0, rushYds: 0, carN: 0, passYds: 0, attN: 0 }]));
  for (const r of rows) {
    const t = tg.get(`${r.game}|${r.team}`)!;
    const pos = nflPos(r.pos);
    const pl = (players[r.id] ??= { games: 0, att: 0, passYds: 0, car: 0, rushYds: 0, tgt: 0, rec: 0, recYds: 0, teamAtt: 0, teamCar: 0, teamTgt: 0, pos });
    const g = playerGame(r, t);
    pl.games++;
    for (const k of ["att", "passYds", "car", "rushYds", "tgt", "rec", "recYds", "teamAtt", "teamCar", "teamTgt"] as const) pl[k] += g[k];
    const s = shares[pos];
    for (const k of ["tgt", "car", "att"] as const) {
      if (!t[k]) continue;
      s[k][0] += r[k] / t[k];
      s[k][1]++;
    }
    s.recYds += r.recYds;
    s.tgtN += r.tgt;
    s.rec += r.rec;
    s.rushYds += r.rushYds;
    s.carN += r.car;
    s.passYds += r.passYds;
    s.attN += r.att;
  }
  const byTeam: { [t: string]: { att: number; car: number; n: number } } = {};
  let att = 0, car = 0, tgt = 0;
  for (const t of tg.values()) {
    const b = (byTeam[t.team] ??= { att: 0, car: 0, n: 0 });
    b.att += t.att;
    b.car += t.car;
    b.n++;
    att += t.att;
    car += t.car;
    tgt += t.tgt;
  }
  const n = tg.size || 1;
  const pos = Object.fromEntries(
    POS.map((p) => {
      const s = shares[p];
      const d = (a: number, b: number) => (b ? a / b : 0);
      return [p, { tgtShare: d(s.tgt[0], s.tgt[1]), carShare: d(s.car[0], s.car[1]), attShare: d(s.att[0], s.att[1]), ypt: d(s.recYds, s.tgtN), cr: d(s.rec, s.tgtN), ypc: d(s.rushYds, s.carN), ypa: d(s.passYds, s.attN) }];
    }),
  ) as NflBase["pos"];
  return {
    base: { att: att / n, car: car / n, tgtPerAtt: att ? tgt / att : 0.9, pos },
    players,
    teams: Object.fromEntries(Object.entries(byTeam).map(([t, b]) => [t, { att: b.att / b.n, car: b.car / b.n }])),
  };
}

/** A season in progress, fed a week at a time. */
export class NflRunning {
  players = new Map<string, { pos: NflPos; name: string; games: PlayerGame[] }>();
  teams = new Map<string, { att: number; car: number; ids: string[] }[]>();

  addWeek(rows: NflRow[]) {
    const tg = teamGames(rows);
    for (const t of tg.values()) {
      const xs = this.teams.get(t.team) ?? [];
      xs.push({ att: t.att, car: t.car, ids: rows.filter((r) => r.game === t.game && r.team === t.team).map((r) => r.id) });
      this.teams.set(t.team, xs);
    }
    for (const r of rows) {
      const p = this.players.get(r.id) ?? { pos: nflPos(r.pos), name: r.name, games: [] };
      p.games.push(playerGame(r, tg.get(`${r.game}|${r.team}`)!));
      this.players.set(r.id, p);
    }
  }

  player(id: string, team: string, pos: string, prior: NflSummary | null): NflPlayerInput {
    const p = this.players.get(id);
    return { id, team, pos: p?.pos ?? nflPos(pos), games: p ? [...p.games] : [], ...(prior?.players[id] ? { prior: prior.players[id] } : {}) };
  }

  team(t: string, prior: NflSummary | null): NflTeamInput {
    return { team: t, games: (this.teams.get(t) ?? []).map((g) => ({ att: g.att, car: g.car })), ...(prior?.teams[t] ? { prior: prior.teams[t] } : {}) };
  }

  /** Players who appeared for the team in its last few games. */
  rotation(t: string, games = 3): string[] {
    return [...new Set((this.teams.get(t) ?? []).slice(-games).flatMap((g) => g.ids))];
  }
}

const ALLOWED_POS = ["QB", "RB", "WR", "TE"] as const;
const ALLOWED_STAT: [string, (r: NflRow) => number][] = [
  ["pass_yds", (r) => r.passYds],
  ["rush_yds", (r) => r.rushYds],
  ["rec_yds", (r) => r.recYds],
  ["rec", (r) => r.rec],
];

/**
 * What each defense allowed, from earlier games' rows: its games, its totals
 * allowed keyed "POS:stat", and the league's average per team-game. The shape
 * NflTeamInput.defense takes (the opponent-defense input, fit by
 * scripts/fit-nfl-props.mts, which builds the same tables week by week).
 *
 *   defenseTables(rows).KC -> { games: 6, allowed: { "WR:rec_yds": 1010, ... }, league: { "WR:rec_yds": 151.2, ... } }
 */
export function defenseTables(rows: NflRow[]): { [team: string]: NonNullable<NflTeamInput["defense"]> } {
  const perGame = new Map<string, { [k: string]: number }>(); // "game|defense" -> totals
  for (const r of rows) {
    const key = `${r.game}|${r.opp}`;
    const d = perGame.get(key) ?? {};
    for (const [s, f] of ALLOWED_STAT) d[`${nflPos(r.pos)}:${s}`] = (d[`${nflPos(r.pos)}:${s}`] ?? 0) + f(r);
    perGame.set(key, d);
  }
  const keys = ALLOWED_POS.flatMap((p) => ALLOWED_STAT.map(([s]) => `${p}:${s}`));
  const all = [...perGame.values()];
  const league = Object.fromEntries(keys.map((k) => [k, all.reduce((a, d) => a + (d[k] ?? 0), 0) / (all.length || 1)]));
  const out: { [team: string]: NonNullable<NflTeamInput["defense"]> } = {};
  for (const [key, d] of perGame) {
    const team = key.split("|")[1];
    const t = (out[team] ??= { games: 0, allowed: Object.fromEntries(keys.map((k) => [k, 0])), league });
    t.games++;
    for (const k of keys) t.allowed[k] += d[k] ?? 0;
  }
  return out;
}
