// Anytime TD parlay of the day (Jack, 2026-10-31): Sunday morning, 3 to 5
// anytime legs where our model and Venom agree, one leg per game.
//
// A leg needs all three:
//   1. Venom picked him (his top 5 for the game) and gives him a chance p.
//   2. Our chance beats DraftKings' break-even (we lean the same way).
//   3. The blend, (ours + Venom's) / 2, beats the break-even by ATTD_EDGE (5 pts).
// Each game's best leg (largest blended gap) goes in, games ranked by that gap,
// up to 5. Fewer than 3 qualifying games: no parlay that Sunday.
// One leg per game because legs in the same game move together. A void leg
// (player sat) drops out and the ticket pays on the rest, as DK does.
//
//   buildParlay(legs with blends 0.58, 0.52, 0.48 at +100, +120, +140)
//     -> price +956, chance 0.145, ev +0.53 a unit
//
// Pure. Stored and graded in attd-parlay-store.ts.

import { ATTD_EDGE, type AttdResult, type AttdRow } from "./anytime";
import { implied, payout } from "@/lib/props/parse";

export const PARLAY_LEGS = { min: 3, max: 5 };

export interface ParlayLeg {
  slug: string;
  game: string;
  kickoff?: string;
  key: string;
  name: string;
  team: string;
  /** DK anytime price, American. */
  price: number;
  ours: number;
  venom: number;
  /** (ours + venom) / 2. */
  chance: number;
  /** chance minus DK's break-even. */
  gap: number;
}

export interface AttdParlay {
  season: number;
  week: number;
  builtAt: string;
  legs: ParlayLeg[];
  /** American price of the ticket (product of the legs). */
  price: number;
  /** Our blended chance that every leg hits. */
  chance: number;
  /** Expected profit per unit at the blended chances. */
  ev: number;
}

export interface ParlayGame {
  slug: string;
  game: string;
  kickoff?: string;
  rows: AttdRow[];
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const decimal = (price: number) => 1 + payout(price);
export const american = (dec: number) => Math.round(dec >= 2 ? (dec - 1) * 100 : -100 / (dec - 1));

/** Each game's best qualifying leg, best first, at most PARLAY_LEGS.max. */
export function pickLegs(games: ParlayGame[], venom: Map<string, number>): ParlayLeg[] {
  const best: ParlayLeg[] = [];
  for (const g of games) {
    let top: ParlayLeg | null = null;
    for (const r of g.rows) {
      const v = venom.get(r.key);
      if (r.dk === undefined || v === undefined) continue;
      const be = implied(r.dk);
      const chance = (r.anytime + v) / 2;
      const gap = chance - be;
      if (!(r.anytime > be) || gap < ATTD_EDGE) continue;
      if (!top || gap > top.gap) top = { slug: g.slug, game: g.game, kickoff: g.kickoff, key: r.key, name: r.name, team: r.team, price: r.dk, ours: r.anytime, venom: v, chance: r3(chance), gap: r3(gap) };
    }
    if (top) best.push(top);
  }
  return best.sort((a, b) => b.gap - a.gap).slice(0, PARLAY_LEGS.max);
}

/** The ticket, or null under PARLAY_LEGS.min legs. */
export function buildParlay(season: number, week: number, legs: ParlayLeg[], now: Date): AttdParlay | null {
  if (legs.length < PARLAY_LEGS.min) return null;
  const dec = legs.reduce((a, l) => a * decimal(l.price), 1);
  const chance = legs.reduce((a, l) => a * l.chance, 1);
  return { season, week, builtAt: now.toISOString(), legs, price: american(dec), chance: r3(chance), ev: r3(chance * dec - 1) };
}

export type ParlayOutcome = { status: "open" } | { status: "won" | "lost" | "void"; net: number };

/** Grade at 1u. results: each game's AttdResult once graded. A miss settles it at once; a win waits for every leg. */
export function gradeParlay(p: AttdParlay, results: { [slug: string]: AttdResult | undefined }): ParlayOutcome {
  let dec = 1;
  let open = false;
  let live = 0;
  for (const l of p.legs) {
    const res = results[l.slug];
    if (!res) {
      open = true;
      continue;
    }
    const t = res[l.key];
    if (t === null || t === undefined) continue; // void: didn't play
    if (t === 0) return { status: "lost", net: -1 };
    dec *= decimal(l.price);
    live++;
  }
  if (open) return { status: "open" };
  if (!live) return { status: "void", net: 0 };
  return { status: "won", net: r3(dec - 1) };
}
