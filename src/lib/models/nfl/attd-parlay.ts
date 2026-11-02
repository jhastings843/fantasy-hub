// Anytime TD parlay of the day (Jack, 2026-10-31): Sunday morning, 3 to 5
// anytime legs where our model and Venom agree, one leg per game.
//
// A leg needs all three:
//   1. Venom picked him (his top 5 for the game) and gives him a chance p.
//   2. Our chance beats DraftKings' break-even (we lean the same way).
//   3. The blend, (ours + Venom's) / 2, beats the break-even by ATTD_EDGE (5 pts).
// Each game's best leg (largest blended gap) makes the pool, games ranked by
// that gap, up to 6. The page lets Jack pick 2 to 6 legs off the top of the
// pool (Jack, 2026-11-01); only one ticket is tracked: the leg count the model
// is most confident in, meaning the best long-run growth at our blended
// chances (the Kelly growth rate, which weighs the chance of cashing against
// the payout, so it neither always takes the fewest legs nor the most).
// Fewer than 2 qualifying games: no parlay that Sunday.
// One leg per game because legs in the same game move together. A void leg
// (player sat) drops out and the ticket pays on the rest, as DK does.
//
//   ticket(legs with blends 0.58, 0.52, 0.48 at +100, +120, +140)
//     -> price +956, chance 0.145, ev +0.53 a unit
//
// Pure. Stored and graded in attd-parlay-store.ts.

import { ATTD_EDGE, type AttdResult, type AttdRow } from "./anytime";
import { implied, payout } from "@/lib/props/parse";

export const PARLAY_LEGS = { min: 2, max: 6 };

/**
 * Which slate a ticket covers. Sunday is the parlay of the day above; TNF and
 * MNF (Jack, 2026-11-02) each get their own 2-leg ticket off that night's
 * game(s), tracked apart. A night slate is usually one game, so its legs can
 * share a game but not a team (Jack, 2026-11-02: two Seattle backs on one
 * ticket split the same carries), and the bar is lower: both our chance and the blend must beat
 * DK's break-even, with no 5-point margin (one game rarely has two 5-point legs).
 * Priced as two singles multiplied; DK's same-game price can differ.
 */
export type ParlaySlate = "sun" | "tnf" | "mnf";
export const NIGHT_LEGS = 2;
export const SLATE_LABEL: { [k in ParlaySlate]: string } = { sun: "Sunday", tnf: "TNF", mnf: "MNF" };

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
  /** Every qualifying leg, best first; legs is its top slice. Missing on tickets built before Nov 1, 2026 pm. */
  pool?: ParlayLeg[];
  /** Missing on Sunday tickets built before Nov 2, 2026: those are "sun". */
  slate?: ParlaySlate;
  /** Set when a ticket is thrown out before kickoff (why); it grades void and never counts. */
  voided?: string;
}

/** One ticket's numbers. growth: the Kelly growth rate at our chances (0 when no edge). */
export interface Ticket {
  legs: ParlayLeg[];
  price: number;
  chance: number;
  ev: number;
  growth: number;
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

/** A night (TNF/MNF) pool: every Venom pick our model and the blend both put above DK's break-even, best blended gap first, any game. */
export function pickNightLegs(games: ParlayGame[], venom: Map<string, number>): ParlayLeg[] {
  const out: ParlayLeg[] = [];
  for (const g of games)
    for (const r of g.rows) {
      const v = venom.get(r.key);
      if (r.dk === undefined || v === undefined) continue;
      const be = implied(r.dk);
      const chance = (r.anytime + v) / 2;
      if (!(r.anytime > be) || !(chance > be)) continue;
      out.push({ slug: g.slug, game: g.game, kickoff: g.kickoff, key: r.key, name: r.name, team: r.team, price: r.dk, ours: r.anytime, venom: v, chance: r3(chance), gap: r3(chance - be) });
    }
  out.sort((a, b) => b.gap - a.gap);
  const teams = new Set<string>();
  return out.filter((l) => !teams.has(l.team) && !!teams.add(l.team));
}

/** The night ticket: the pool's top NIGHT_LEGS legs, or null when fewer qualify. */
export function buildNightParlay(season: number, week: number, slate: "tnf" | "mnf", pool: ParlayLeg[], now: Date): AttdParlay | null {
  if (pool.length < NIGHT_LEGS) return null;
  const t = ticket(pool.slice(0, NIGHT_LEGS));
  return { season, week, builtAt: now.toISOString(), legs: t.legs, price: t.price, chance: t.chance, ev: t.ev, pool: t.legs, slate };
}

/** A ticket from these legs. */
export function ticket(legs: ParlayLeg[]): Ticket {
  const dec = legs.reduce((a, l) => a * decimal(l.price), 1);
  const p = legs.reduce((a, l) => a * l.chance, 1);
  // Growth of a Kelly-sized bet: p ln(p d) + (1 - p) ln((1 - p) d / (d - 1)); no edge, no bet, 0.
  const growth = p * dec > 1 && p < 1 ? p * Math.log(p * dec) + (1 - p) * Math.log(((1 - p) * dec) / (dec - 1)) : 0;
  return { legs, price: american(dec), chance: r3(p), ev: r3(p * dec - 1), growth: Math.round(growth * 1e5) / 1e5 };
}

/** Every ticket the page offers: the pool's top 2, top 3, ... up to the whole pool. */
export function tickets(pool: ParlayLeg[]): Ticket[] {
  const out: Ticket[] = [];
  for (let n = PARLAY_LEGS.min; n <= Math.min(pool.length, PARLAY_LEGS.max); n++) out.push(ticket(pool.slice(0, n)));
  return out;
}

/** The leg count the model is most confident in: best growth, fewer legs on a tie. Null under PARLAY_LEGS.min legs. */
export function bestTicket(pool: ParlayLeg[]): Ticket | null {
  return tickets(pool).reduce<Ticket | null>((best, t) => (!best || t.growth > best.growth ? t : best), null);
}

/** The tracked ticket with its pool, or null under PARLAY_LEGS.min legs. */
export function buildParlay(season: number, week: number, pool: ParlayLeg[], now: Date): AttdParlay | null {
  const t = bestTicket(pool);
  if (!t) return null;
  return { season, week, builtAt: now.toISOString(), legs: t.legs, price: t.price, chance: t.chance, ev: t.ev, pool };
}

export type ParlayOutcome = { status: "open" } | { status: "won" | "lost" | "void"; net: number };

/** Grade at 1u. results: each game's AttdResult once graded. A miss settles it at once; a win waits for every leg. */
export function gradeParlay(p: AttdParlay, results: { [slug: string]: AttdResult | undefined }): ParlayOutcome {
  if (p.voided) return { status: "void", net: 0 };
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
