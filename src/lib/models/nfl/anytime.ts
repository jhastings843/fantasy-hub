// Our NFL Anytime TD model (Jack, 2026-10-26: an ATTD tab under NFL props).
//
// A team's offensive TDs (rushing + receiving, the ones that pay an anytime
// TD) are Poisson with mean a x its implied points, from the market's total
// and spread. Each listed player gets his share of them from the First TD
// model's scorerShares (his rushing and receiving TD history, shrunk toward
// his carry and target shares), so his own TDs are Poisson with mean
// team mean x share:
//
//   P(anytime) = 1 - e^-m        P(2+) = 1 - e^-m (1 + m)
//
// The raw chances run spread out (too sure at 40-50%, too shy under 10% in
// every test set), so P(anytime) is pulled toward 50/50 in log-odds by calib.
//
//   anytimeChances(24 implied pts, share 0.25, a 0.105) -> m 0.63, anytime 46.7%, 2+ 13.2%
//
// Constants are fit by scripts/fit-anytime-td.mts, walk forward. Pure.

import { scorerShares, type FtdParams, type TdLine } from "./firsttd";
import { calibrate } from "../nba/props";
import { implied, payout } from "@/lib/props/parse";
import { nameKey, type EspnBoxTeam } from "@/lib/props/grade";

export interface AttdParams extends FtdParams {
  /** Offensive (rushing + receiving) TDs per implied point. */
  a: number;
  /** Log-odds scale on P(anytime): under 1 pulls toward 50/50. */
  calib?: number;
  /** Weight of red-zone shares in the shrink target, 0 = carries and targets only (from 2026-10-26). */
  wRz?: number;
  /** Extra weight on goal-line carries inside the red-zone carry share. */
  gGl?: number;
}

/** Red-zone (20 and in) and goal-line (5 and in) opportunities over the same games as a TdLine, his and his team's. */
export interface ZoneTotals {
  glCar: number;
  rzCar: number;
  rzTgt: number;
  teamGlCar: number;
  teamRzCar: number;
  teamRzTgt: number;
}

export type AttdLine = TdLine & { zone?: ZoneTotals };

/**
 * scorerShares with red-zone usage in the shrink target: a player's TD share
 * leans on where he gets the ball, not only how often. With wRz 0 it is
 * scorerShares exactly.
 */
export function attdShares(lines: AttdLine[], p: AttdParams): number[] {
  const w = p.wRz ?? 0;
  if (!w || !lines.some((l) => l.zone)) return scorerShares(lines, p);
  const g = p.gGl ?? 0;
  const ref = [...lines].sort((a, b) => b.teamRushTd + b.teamRecTd - (a.teamRushTd + a.teamRecTd))[0];
  const rush = (ref.teamRushTd + p.kR * p.rushShare) / (ref.teamRushTd + ref.teamRecTd + p.kR);
  const raw = lines.map((l) => {
    const z = l.zone;
    const cs0 = l.teamCar ? l.car / l.teamCar : 0;
    const ts0 = l.teamTgt ? l.tgt / l.teamTgt : 0;
    const zc = z && z.teamRzCar + g * z.teamGlCar > 0 ? (z.rzCar + g * z.glCar) / (z.teamRzCar + g * z.teamGlCar) : cs0;
    const zt = z && z.teamRzTgt > 0 ? z.rzTgt / z.teamRzTgt : ts0;
    const cs = (1 - w) * cs0 + w * zc;
    const ts = (1 - w) * ts0 + w * zt;
    return { r: (l.rushTd + p.kTd * cs) / (l.teamRushTd + p.kTd || 1), c: (l.recTd + p.kTd * ts) / (l.teamRecTd + p.kTd || 1) };
  });
  const sr = raw.reduce((a, x) => a + x.r, 0) || 1;
  const sc = raw.reduce((a, x) => a + x.c, 0) || 1;
  return raw.map((x) => (1 - p.other) * (rush * (x.r / sr) + (1 - rush) * (x.c / sc)));
}

export interface AttdPlayer {
  id: string;
  name: string;
  team: string;
  /** Expected TDs. */
  m: number;
  anytime: number;
  two: number;
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;

export function anytimeChances(m: number): { anytime: number; two: number } {
  const e = Math.exp(-Math.max(0, m));
  return { anytime: 1 - e, two: 1 - e * (1 + m) };
}

/** Every listed player's expected TDs and chances, given his team's implied points. */
export function attdTeam(lines: AttdLine[], teamPts: number, p: AttdParams): AttdPlayer[] {
  const mean = p.a * Math.max(0, teamPts);
  const sh = attdShares(lines, p);
  return lines.map((l, i) => {
    const m = mean * sh[i];
    const c = anytimeChances(m);
    return { id: l.id, name: l.name, team: l.team, m: r3(m), anytime: r3(calibrate(c.anytime, p.calib ?? 1)), two: r3(c.two) };
  });
}

/** One player on a saved Anytime TD board: our numbers and DraftKings' prices. */
export interface AttdRow extends AttdPlayer {
  /** nameKey, how the box score is matched. */
  key: string;
  /** DraftKings' Anytime TD and 2+ TD prices (American), when posted. */
  dk?: number;
  dk2?: number;
}

/** A graded player: TDs (rushing, receiving, returns), null when he didn't play (void). */
export type AttdResult = { [key: string]: number | null };

/** Our chance must beat DK's break-even by this much to count as an edge (the model runs ~8 pts hot at 30-50%, so keep it honest). */
export const ATTD_EDGE = 0.05;

export interface AttdEdge {
  side: "anytime" | "two";
  price: number;
  ours: number;
  /** Our chance minus DK's break-even. */
  gap: number;
}

/** The player's edges at DK's prices, anytime first. */
export function attdEdges(r: AttdRow, min = ATTD_EDGE): AttdEdge[] {
  const out: AttdEdge[] = [];
  for (const [side, price, ours] of [["anytime", r.dk, r.anytime], ["two", r.dk2, r.two]] as const) {
    if (price === undefined) continue;
    const gap = r3(ours - implied(price));
    if (gap >= min) out.push({ side, price, ours, gap });
  }
  return out;
}

/** TDs per player from an ESPN NFL box score (rushing, receiving, kick and punt returns), by nameKey. */
export function boxTds(players: EspnBoxTeam[]): Map<string, number> {
  const cols: { [table: string]: string } = { rushing: "rushingTouchdowns", receiving: "receivingTouchdowns", kickReturns: "kickReturnTouchdowns", puntReturns: "puntReturnTouchdowns" };
  const out = new Map<string, number>();
  for (const t of players)
    for (const table of t.statistics ?? []) {
      const i = (table.keys ?? []).indexOf(cols[table.name ?? ""] ?? "");
      for (const a of table.athletes ?? []) {
        const name = a.athlete?.displayName;
        if (!name || a.didNotPlay) continue;
        const k = nameKey(name);
        const v = i >= 0 ? Number(a.stats?.[i]) : 0;
        out.set(k, (out.get(k) ?? 0) + (Number.isFinite(v) ? v : 0));
      }
    }
  return out;
}

/** Players missing from every box table didn't play: null (void). */
export function gradeAttd(rows: AttdRow[], tds: Map<string, number>): AttdResult {
  return Object.fromEntries(rows.map((r) => [r.key, tds.has(r.key) ? tds.get(r.key)! : null]));
}

export interface AttdGraded {
  slug: string;
  week: number;
  rows: AttdRow[];
  result: AttdResult;
}

export interface AttdSummary {
  /** Every priced anytime: how often it hit against what we and DK said. */
  priced: { n: number; hits: number; ours: number; dk: number };
  /** Flat 1u on every edge at DK's price. */
  edges: { n: number; won: number; net: number; bySide: { [s in AttdEdge["side"]]: { n: number; won: number; net: number } } };
  bands: { band: string; n: number; hits: number; ours: number; dk: number }[];
}

const BANDS = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 1];

export function summarizeAttd(games: AttdGraded[]): AttdSummary {
  const priced: { ours: number; dk: number; hit: boolean }[] = [];
  const edges = { n: 0, won: 0, net: 0, bySide: { anytime: { n: 0, won: 0, net: 0 }, two: { n: 0, won: 0, net: 0 } } };
  for (const g of games)
    for (const r of g.rows) {
      const t = g.result[r.key];
      if (t === null || t === undefined) continue;
      if (r.dk !== undefined) priced.push({ ours: r.anytime, dk: implied(r.dk), hit: t > 0 });
      for (const e of attdEdges(r)) {
        const won = e.side === "anytime" ? t > 0 : t > 1;
        const net = won ? payout(e.price) : -1;
        for (const x of [edges, edges.bySide[e.side]]) {
          x.n++;
          x.won += won ? 1 : 0;
          x.net += net;
        }
      }
    }
  return {
    priced: { n: priced.length, hits: priced.filter((x) => x.hit).length, ours: priced.reduce((a, x) => a + x.ours, 0), dk: priced.reduce((a, x) => a + x.dk, 0) },
    edges,
    bands: BANDS.slice(0, -1).map((lo, i) => {
      const b = priced.filter((x) => x.ours >= lo && x.ours < BANDS[i + 1]);
      return { band: `${Math.round(lo * 100)}-${Math.round(BANDS[i + 1] * 100)}%`, n: b.length, hits: b.filter((x) => x.hit).length, ours: b.reduce((a, x) => a + x.ours, 0), dk: b.reduce((a, x) => a + x.dk, 0) };
    }),
  };
}
