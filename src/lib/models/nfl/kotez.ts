// King of the End Zone (DraftKings promo, Jack, 2026-11-02): everyone who
// backed the player with the game's longest TD splits a bonus pool. A thrown
// TD counts for the receiver, not the QB.
//
// Chance of the longest TD, by simulation:
//   1. Each listed player's TD count is Poisson at his expected TDs from our
//      Anytime TD model (AttdRow.m). Other TDs (players off the list, returns,
//      defense) are Poisson at each team's leftover share plus the league's
//      0.12 non-offensive TDs a team-game.
//   2. Each TD is rushing or receiving at the player's own mix (shrunk toward
//      the league's by 2 pseudo-TDs), and its length is drawn from his own TDs
//      of that kind with weight n / (n + 6), else from the league's (2024-26).
//   3. The longest wins; a tie splits. No TD at all: nobody wins.
// Value: our chance over the share of the pool backing him. That share is an
// ESTIMATE (no data): proportional to DK's anytime break-even squared, so stars
// draw more than their price alone says. value > 1 means more than his share.
//
// Pure, seeded.

import LEN from "./td-length.json";
import { implied } from "@/lib/props/parse";
import type { AttdRow } from "./anytime";

type Len = { league: { rush: number[]; rec: number[]; other: number[] }; players: { [id: string]: [number[], number[]] }; otherPerTeamGame: number };
const L = LEN as unknown as Len;
export const KOTEZ_SIMS = 20000;
const K_LEN = 6;
const K_MIX = 2;

export interface KotezRow {
  key: string;
  name: string;
  team: string;
  /** Chance he scores the game's longest TD. */
  longest: number;
  anytime: number;
  dk?: number;
  /** ESTIMATE of the share of backers on him. */
  crowd?: number;
  /** longest / crowd; missing without a DK price. */
  value?: number;
}

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
const cum = (a: number[]) => {
  const out: number[] = [];
  let t = 0;
  for (const x of a) out.push((t += x));
  return out;
};
const CUM = { rush: cum(L.league.rush), rec: cum(L.league.rec), other: cum(L.league.other) };
function drawCum(c: number[], u: number): number {
  const t = u * c[c.length - 1];
  let lo = 0, hi = c.length - 1;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (c[m] > t) hi = m;
    else lo = m + 1;
  }
  return lo;
}
function poisson(mean: number, r: () => number): number {
  const l = Math.exp(-mean);
  let k = 0, p = 1;
  do {
    k++;
    p *= r();
  } while (p > l);
  return k - 1;
}
const lgRush = CUM.rush[99] / (CUM.rush[99] + CUM.rec[99]);

/** rows: one game's Anytime TD board (both teams). otherShare: our model's share of a team's offensive TDs to players off the list. */
export function kotezGame(rows: AttdRow[], otherShare: number, sims = KOTEZ_SIMS, seed = 7): { rows: KotezRow[]; noTd: number } {
  const r = rng(seed);
  const ps = rows.map((x) => {
    const h = L.players[x.id] ?? [[], []];
    const mix = (h[0].length + K_MIX * lgRush) / (h[0].length + h[1].length + K_MIX);
    return { x, h, mix };
  });
  const teams = [...new Set(rows.map((x) => x.team))];
  const otherMean = teams.map((t) => {
    const m = rows.filter((x) => x.team === t).reduce((a, x) => a + x.m, 0);
    return (m * otherShare) / (1 - otherShare) + L.otherPerTeamGame;
  });
  const wins = new Array(rows.length).fill(0);
  let none = 0;
  for (let s = 0; s < sims; s++) {
    let best = 0;
    let who: number[] = [];
    ps.forEach((p, i) => {
      for (let k = poisson(p.x.m, r); k > 0; k--) {
        const rush = r() < p.mix;
        const own = rush ? p.h[0] : p.h[1];
        const y = own.length && r() < own.length / (own.length + K_LEN) ? own[Math.floor(r() * own.length)] : drawCum(rush ? CUM.rush : CUM.rec, r());
        if (y > best) {
          best = y;
          who = [i];
        }
        else if (y === best && !who.includes(i)) who.push(i);
      }
    });
    for (const om of otherMean)
      for (let k = poisson(om, r); k > 0; k--) {
        const y = drawCum(CUM.other, r());
        if (y > best) {
          best = y;
          who = [-1];
        }
        else if (y === best) who.push(-1);
      }
    if (!best) {
      none++;
      continue;
    }
    for (const i of who) if (i >= 0) wins[i] += 1 / who.length;
  }
  const priced = rows.map((x) => (x.dk !== undefined ? implied(x.dk) ** 2 : 0));
  const tot = priced.reduce((a, b) => a + b, 0) || 1;
  const out: KotezRow[] = rows.map((x, i) => {
    const longest = Math.round((wins[i] / sims) * 1000) / 1000;
    const crowd = x.dk !== undefined ? Math.round((priced[i] / tot) * 1000) / 1000 : undefined;
    return { key: x.key, name: x.name, team: x.team, longest, anytime: x.anytime, dk: x.dk, crowd, value: crowd ? Math.round((longest / crowd) * 100) / 100 : undefined };
  });
  return { rows: out.sort((a, b) => b.longest - a.longest), noTd: Math.round((none / sims) * 1000) / 1000 };
}
