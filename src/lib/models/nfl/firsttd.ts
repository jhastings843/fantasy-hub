// Our NFL First TD model, in the first TD tracker's own shape (FtdGame from
// lib/firsttd/parse.ts), so grading, Kalshi money checks and trends work
// unchanged.
//
// 1. Possessions: the teams trade drives, the opening receiver a coin flip.
//    Each drive ends in an offensive TD for the team with the ball with
//    chance c x (its implied points) / (drives per team), or in a defensive
//    or special-teams TD with chance delta, else play goes on. After every
//    drive is spent with no TD, "none". The implied points come from the
//    market: (total +/- spread) / 2.
// 2. The scorer, given his team scores: rushing with the team's rushing share
//    of its TDs (shrunk toward the league by kR pseudo-TDs), then each
//    player's share of the team's rushing (receiving) TDs, shrunk toward his
//    share of its carries (targets) by kTd pseudo-TDs. A fixed share of TDs
//    goes to players outside the list ("any other").
//
// Constants are fit by scripts/fit-first-td.mts, walk forward. Pure.

import type { FtdGame, FtdPlayer, FtdTeam } from "@/lib/firsttd/parse";
import type { NflRow } from "./data";

export interface FtdParams {
  /** Offensive TDs per implied point. */
  c: number;
  /** Non-offensive TD chance per drive. */
  delta: number;
  /** Drives per team per game (data). */
  drives: number;
  kTd: number;
  kR: number;
  /** League share of offensive TDs that are rushing (data). */
  rushShare: number;
  /** Share of a team's TDs scored by players not on its list (data). */
  other: number;
  /** Power on the listed players' shares, renormalized: above 1 favors the likeliest scorers. Absent or 1: off. */
  sharp?: number;
  /** Weight on last season's TD history next to this season's (1: counted the same, as before). */
  wPrev?: number;
}

/** A player's TD history: his TDs and opportunities, and his team's in the same games. */
export interface TdLine {
  id: string;
  name: string; // full name, "Jaxon Smith-Njigba"
  team: string;
  rushTd: number;
  recTd: number;
  car: number;
  tgt: number;
  teamRushTd: number;
  teamRecTd: number;
  teamCar: number;
  teamTgt: number;
}

/** P(home scores the first offensive TD), P(away), P(none). */
export function teamFirst(homePts: number, awayPts: number, p: FtdParams): { home: number; away: number; none: number } {
  const ph = Math.min(0.95, Math.max(0, (p.c * homePts) / p.drives));
  const pa = Math.min(0.95, Math.max(0, (p.c * awayPts) / p.drives));
  const out = { home: 0, away: 0, none: 0 };
  for (const homeFirst of [true, false]) {
    let alive = 0.5;
    for (let d = 0; d < 2 * Math.round(p.drives); d++) {
      const homeBall = (d % 2 === 0) === homeFirst;
      const off = homeBall ? ph : pa;
      out[homeBall ? "home" : "away"] += alive * off;
      out.none += alive * p.delta;
      alive *= 1 - off - p.delta;
    }
    out.none += alive;
  }
  return out;
}

/** Each listed player's chance to score his team's TD, given that his team scores one. */
export function scorerShares(lines: TdLine[], p: FtdParams): number[] {
  if (!lines.length) return [];
  // Team rushing share of TDs, from the listed players' team columns (the largest sample among them).
  const ref = [...lines].sort((a, b) => b.teamRushTd + b.teamRecTd - (a.teamRushTd + a.teamRecTd))[0];
  const rush = (ref.teamRushTd + p.kR * p.rushShare) / (ref.teamRushTd + ref.teamRecTd + p.kR);
  const raw = lines.map((l) => {
    const cs = l.teamCar ? l.car / l.teamCar : 0;
    const ts = l.teamTgt ? l.tgt / l.teamTgt : 0;
    const r = (l.rushTd + p.kTd * cs) / (l.teamRushTd + p.kTd || 1);
    const c = (l.recTd + p.kTd * ts) / (l.teamRecTd + p.kTd || 1);
    return { r, c };
  });
  const sr = raw.reduce((a, x) => a + x.r, 0) || 1;
  const sc = raw.reduce((a, x) => a + x.c, 0) || 1;
  const sh = raw.map((x) => rush * (x.r / sr) + (1 - rush) * (x.c / sc));
  const g = p.sharp ?? 1;
  if (g === 1) return sh.map((x) => (1 - p.other) * x);
  const pw = sh.map((x) => Math.pow(x, g));
  const sp = pw.reduce((a, x) => a + x, 0) || 1;
  return pw.map((x) => ((1 - p.other) * x) / sp);
}

/** "Jaxon Smith-Njigba" to "J.Smith-Njigba", the first TD tracker's name form (sameName reads it). */
export const shortName = (full: string) => {
  const [first, ...rest] = full.trim().split(/\s+/);
  return rest.length ? `${first[0]}.${rest.join(" ")}` : full;
};

const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** The game in FtdGame's shape: our chances, "any other" per team, and "none". */
export function ftdGame(
  meta: { season: number; week: number; slug: string; away: string; home: string; when: string },
  homePts: number,
  awayPts: number,
  lines: { [team: string]: TdLine[] },
  p: FtdParams,
): FtdGame {
  const tf = teamFirst(homePts, awayPts, p);
  const teams: FtdTeam[] = [meta.away, meta.home].map((team) => {
    const pFirst = team === meta.home ? tf.home : tf.away;
    const ls = lines[team] ?? [];
    const sh = scorerShares(ls, p);
    const players: FtdPlayer[] = ls.map((l, i) => ({
      key: `${team}_${shortName(l.name).replace(/\s+/g, "_")}`,
      name: shortName(l.name),
      team,
      touches: l.car + l.tgt,
      tds: l.rushTd + l.recTd,
      p: r3(pFirst * sh[i]),
      thin: false,
      out: false,
    }));
    players.sort((a, b) => (b.p ?? 0) - (a.p ?? 0));
    return { team, pFirst: r3(pFirst), players, rest: r3(pFirst * (ls.length ? p.other : 1)), thin: 0 };
  });
  const best = teams.flatMap((t) => t.players).sort((a, b) => (b.p ?? 0) - (a.p ?? 0))[0];
  return { ...meta, pick: best ? { name: best.name, team: best.team, p: best.p ?? 0 } : null, teams, none: r3(tf.none), defense: [] };
}

/** Implied points for each side from the market's total and the expected home margin. */
export const impliedPoints = (total: number, homeMargin: number) => ({ home: (total + homeMargin) / 2, away: (total - homeMargin) / 2 });

/** Totals per player over some rows, with his team's totals in the same games. */
export function tdTotals(rs: NflRow[]): Map<string, Omit<TdLine, "team">> {
  const team = new Map<string, { rushTd: number; recTd: number; car: number; tgt: number }>();
  for (const r of rs) {
    const k = `${r.game}|${r.team}`;
    const t = team.get(k) ?? { rushTd: 0, recTd: 0, car: 0, tgt: 0 };
    t.rushTd += r.rushTd;
    t.recTd += r.recTd;
    t.car += r.car;
    t.tgt += r.tgt;
    team.set(k, t);
  }
  const out = new Map<string, Omit<TdLine, "team">>();
  for (const r of rs) {
    const t = team.get(`${r.game}|${r.team}`)!;
    const x = out.get(r.id) ?? { id: r.id, name: r.name, rushTd: 0, recTd: 0, car: 0, tgt: 0, teamRushTd: 0, teamRecTd: 0, teamCar: 0, teamTgt: 0 };
    x.rushTd += r.rushTd;
    x.recTd += r.recTd;
    x.car += r.car;
    x.tgt += r.tgt;
    x.teamRushTd += t.rushTd;
    x.teamRecTd += t.recTd;
    x.teamCar += t.car;
    x.teamTgt += t.tgt;
    out.set(r.id, x);
  }
  return out;
}

/** Two players' totals added (last season plus this one). */
export function addTotals(a: Omit<TdLine, "team"> | undefined, b: Omit<TdLine, "team"> | undefined, wPrev = 1): Omit<TdLine, "team"> | null {
  const x = b ?? a;
  if (!x) return null;
  const k = ["rushTd", "recTd", "car", "tgt", "teamRushTd", "teamRecTd", "teamCar", "teamTgt"] as const;
  return { id: x.id, name: x.name, ...(Object.fromEntries(k.map((f) => [f, wPrev * (a?.[f] ?? 0) + (b?.[f] ?? 0)])) as { [f in (typeof k)[number]]: number }) };
}
