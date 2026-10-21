// Turning saved games (box.ts) into the model's inputs (props.ts): a prior
// season's per-player totals and league baselines, and a running season that
// knows, before any game, what each player and team had done up to then.
// Shared by the walk-forward fit (scripts/fit-nba-props.mts) and the live
// run, so the backtest and the page read history the same way. Pure.

import type { NbaGame } from "./box";
import { NBA_STATS, posOf, type LeagueBase, type NbaStat, type Played, type PlayerInput, type Pos, type PriorSeason, type TeamInput } from "./props";

export interface SeasonSummary {
  base: LeagueBase;
  priors: { [id: string]: PriorSeason };
  pace: { [team: string]: number };
}

/** One season's totals per player, its league baselines, and each team's possessions per game. */
export function summarize(games: NbaGame[]): SeasonSummary {
  const priors: { [id: string]: PriorSeason } = {};
  const posVotes: { [id: string]: { [p: string]: number } } = {};
  const role = { s: [0, 0], b: [0, 0] };
  const byPos: { [p in Pos]: { min: number } & { [s in NbaStat]: number } } = {
    G: { min: 0, pts: 0, reb: 0, ast: 0, threes: 0 },
    F: { min: 0, pts: 0, reb: 0, ast: 0, threes: 0 },
    C: { min: 0, pts: 0, reb: 0, ast: 0, threes: 0 },
  };
  const poss: { [team: string]: number[] } = {};
  let teamGames = 0;
  let appearances = 0;
  for (const g of games) {
    teamGames += 2;
    appearances += g.players.length;
    for (const [t, v] of Object.entries(g.poss)) (poss[t] ??= []).push(v);
    for (const l of g.players) {
      const pos = posOf(l.pos);
      const pr = (priors[l.id] ??= { games: 0, min: 0, pts: 0, reb: 0, ast: 0, threes: 0, pos });
      pr.games++;
      pr.min += l.min;
      for (const s of NBA_STATS) pr[s] += l[s];
      const v = (posVotes[l.id] ??= {});
      v[pos] = (v[pos] ?? 0) + 1;
      const r = l.starter ? role.s : role.b;
      r[0] += l.min;
      r[1]++;
      const bp = byPos[pos];
      bp.min += l.min;
      for (const s of NBA_STATS) bp[s] += l[s];
    }
  }
  for (const [id, v] of Object.entries(posVotes)) priors[id].pos = Object.entries(v).sort((a, b) => b[1] - a[1])[0][0] as Pos;
  const rate = {} as LeagueBase["rate"];
  for (const p of ["G", "F", "C"] as Pos[]) {
    rate[p] = {} as { [s in NbaStat]: number };
    for (const s of NBA_STATS) rate[p][s] = byPos[p].min ? byPos[p][s] / byPos[p].min : 0;
  }
  const pace = Object.fromEntries(Object.entries(poss).map(([t, xs]) => [t, xs.reduce((a, x) => a + x, 0) / xs.length]));
  const all = Object.values(poss).flat();
  return {
    base: {
      minStarter: role.s[1] ? role.s[0] / role.s[1] : 30,
      minBench: role.b[1] ? role.b[0] / role.b[1] : 15,
      rate,
      pace: all.length ? all.reduce((a, x) => a + x, 0) / all.length : 100,
      rotationSize: teamGames ? appearances / teamGames : 10,
    },
    priors,
    pace,
  };
}

/** A season in progress: every player's and team's games so far. Feed games in date order. */
export class RunningSeason {
  players = new Map<string, { pos: Pos; games: Played[] }>();
  teams = new Map<string, number[]>();
  recent = new Map<string, string[][]>();

  add(g: NbaGame) {
    for (const [t, v] of Object.entries(g.poss)) {
      const xs = this.teams.get(t) ?? [];
      xs.push(v);
      this.teams.set(t, xs);
    }
    for (const t of [g.home, g.away]) this.recent.set(t, [...(this.recent.get(t) ?? []), g.players.filter((l) => l.team === t).map((l) => l.id)].slice(-ROTATION_GAMES));
    for (const l of g.players) {
      const p = this.players.get(l.id) ?? { pos: posOf(l.pos), games: [] };
      p.games.push({ date: g.date, team: l.team, min: l.min, starter: l.starter, pts: l.pts, reb: l.reb, ast: l.ast, threes: l.threes });
      this.players.set(l.id, p);
    }
  }

  /** A player's input as of now (only games already added). */
  player(id: string, team: string, pos: string, prior: SeasonSummary | null, starter?: boolean): PlayerInput {
    const p = this.players.get(id);
    return { id, team, pos: p?.pos ?? posOf(pos), games: p ? [...p.games] : [], ...(prior?.priors[id] ? { prior: prior.priors[id] } : {}), ...(starter !== undefined ? { starter } : {}) };
  }

  /** Everyone who played for the team in its last few games. */
  rotation(t: string): string[] {
    return [...new Set((this.recent.get(t) ?? []).flat())];
  }

  team(t: string, prior: SeasonSummary | null): TeamInput {
    return { team: t, poss: [...(this.teams.get(t) ?? [])], ...(prior?.pace[t] !== undefined ? { priorPace: prior.pace[t] } : {}) };
  }
}

// The live store's tables (lib/models/nba/store.ts): one entry per player and
// per team, grown a game at a time as finals come in.

export interface PlayerEntry {
  name: string;
  pos: Pos;
  games: Played[];
}
export interface TeamEntry {
  poss: number[];
  /** Player ids who appeared, per game, the latest ROTATION_GAMES games. */
  recent: string[][];
}

/** A team's rotation is everyone who played in its last few games. */
export const ROTATION_GAMES = 5;

/** Fold one final into the tables (changes them in place). Returns the player ids touched. */
export function ingest(players: { [id: string]: PlayerEntry }, teams: { [team: string]: TeamEntry }, g: NbaGame): string[] {
  for (const team of [g.home, g.away]) {
    const t = (teams[team] ??= { poss: [], recent: [] });
    if (g.poss[team] !== undefined) t.poss.push(g.poss[team]);
    t.recent = [...t.recent, g.players.filter((l) => l.team === team).map((l) => l.id)].slice(-ROTATION_GAMES);
  }
  for (const l of g.players) {
    const p = (players[l.id] ??= { name: l.name, pos: posOf(l.pos), games: [] });
    p.name = l.name;
    p.games.push({ date: g.date, team: l.team, min: l.min, starter: l.starter, pts: l.pts, reb: l.reb, ast: l.ast, threes: l.threes });
  }
  return g.players.map((l) => l.id);
}

export const rotation = (t: TeamEntry | undefined) => [...new Set((t?.recent ?? []).flat())];
