// Lotto shadow (Jack, 2026-10-26, after @TheModelManSam's +18,000 "X+ points"
// parlays). Paper only: never in emails, bets or the learner.
//
// Two records from the boards our props model already saves:
// 1. Every long-shot rung (DK's "N+" ladder at +250 to +2000, market.longRungs)
//    graded against the box score: do our chances on long shots beat DK's?
//    Thousands a week, so this answers well before the tickets can.
// 2. One 3-leg ticket a night: the rung with the best value in each game (our
//    chance times DK's payout), one per player, top 3 games. Priced as the
//    product of the legs, as DK prices a parlay across games. A void leg drops
//    out and the ticket pays on what is left, as DK does.
//
// Built from each game's last pregame copy, so a late game's leg may carry
// news from after the first tip: a real ticket placed at the first tip would
// sometimes pick differently.
//
//   ticket(3 games with long rungs) -> { legs: [Tyson 14.5+ pts +420, ...], price: 22676, chance: 0.009 }

import { etDate, implied, payout } from "@/lib/props/parse";
import type { GradedGame } from "@/lib/props/grade";
import type { LongRung, OurMarketExtra } from "./market";

/** The slice of a saved board the lotto reads. */
export interface LottoBoard {
  espnId?: string;
  kickoff?: string;
  away: string;
  home: string;
  game: { markets: { id: string; player: string; stat?: string | null; statLabel: string }[] };
  extra: { [id: string]: OurMarketExtra };
  result?: GradedGame;
}

export interface Rung extends LongRung {
  date: string;
  /** Tip time (ISO). */
  at: string;
  game: string;
  matchup: string;
  id: string;
  player: string;
  stat: string;
  /** Our chance times DK's decimal payout, less 1: the rung's value at our number. */
  ev: number;
  /** Null until graded; "void" when he didn't play. */
  hit: boolean | "void" | null;
  actual: number | null;
}

export interface Ticket {
  date: string;
  legs: Rung[];
  /** American price of the ticket (product of the legs that stood). */
  price: number;
  /** Our chance every leg hits. */
  chance: number;
  /** DK's chance with its vig in. */
  book: number;
  outcome: "W" | "L" | null;
}

/** Legs per ticket, and the games a player needs this season before his rungs count (as the props board's edge cards). */
export const LEGS = 3;
export const MIN_GAMES = 3;
/** Ticket stake in units: lottos are played small. */
export const STAKE = 0.1;

const dec = (american: number) => 1 + payout(american);
const toAmerican = (d: number) => Math.round(d >= 2 ? (d - 1) * 100 : -100 / (d - 1));

/** Every long rung on the boards, graded where the game is final. */
export function rungsOf(boards: LottoBoard[]): Rung[] {
  const out: Rung[] = [];
  for (const b of boards) {
    if (!b.kickoff || !b.espnId) continue;
    const date = etDate(new Date(b.kickoff));
    const actual = new Map((b.result?.markets ?? []).map((m) => [m.id, m.actual]));
    for (const m of b.game.markets) {
      const x = b.extra[m.id];
      if (!x?.longs?.length || (x.games ?? 0) < MIN_GAMES) continue;
      for (const r of x.longs) {
        const a = b.result ? actual.get(m.id) ?? null : null;
        out.push({
          ...r,
          date,
          at: b.kickoff,
          game: b.espnId,
          matchup: `${b.away}@${b.home}`,
          id: m.id,
          player: m.player,
          stat: m.stat ?? m.statLabel,
          ev: Math.round((r.ours * dec(r.over) - 1) * 1000) / 1000,
          hit: !b.result ? null : a === null ? "void" : a > r.line,
          actual: a,
        });
      }
    }
  }
  return out;
}

/**
 * How a ticket is built (Jack, 2026-10-27: test a bunch while the evidence
 * collects). Every recipe takes one rung per game, positive value only:
 * - value:  the game's best-value rung, games ranked by value (the original ticket)
 * - chance: the game's likeliest rung, games ranked by our chance
 * - long:   the game's longest price, games ranked by price
 * The list is fixed up front so a lucky recipe can't be picked after the fact.
 */
export type Pick = "value" | "chance" | "long" | "raw";
export interface Recipe {
  id: string;
  label: string;
  legs: number;
  pick: Pick;
  /** Only this stat's rungs (Sam's are points only). */
  stat?: string;
  /** Only legs DK prices in this band (American). */
  band?: [number, number];
  /** Water-down: the same players as `of`, each on his shortest rung of the stat. */
  water?: string;
}
const PICK_LABEL: { [k in Pick]: string } = { value: "best value", chance: "likeliest", long: "longest price", raw: "best raw value" };
/**
 * Sam style (Jack, 2026-10-28, after @TheModelManSam cashed +19,300): 3 legs,
 * points only, legs +300 to +700 so a ticket lands near +20,000, picked on our
 * raw model (the blend leans on DK, which hides a role player's usage spike).
 * His "water down" ticket plays the same players lower; ours can only go down
 * to the +250 rungs the boards store, so it lands near +4,000 to +6,000.
 * Added after three nights of results; judged from 2026-10-29 on.
 */
const SAM: Recipe[] = [
  { id: "sam-pts", label: "Sam style: 3 legs, points, +300 to +700", legs: 3, pick: "raw", stat: "pts", band: [300, 700] },
  { id: "sam-pts-water", label: "Sam style, watered down: same players, shortest points rung", legs: 3, pick: "raw", stat: "pts", water: "sam-pts" },
];
export const RECIPES: Recipe[] = [
  ...[2, 3, 4, 5].flatMap((legs) =>
    (["value", "chance", "long"] as const).map((pick) => ({ id: `l${legs}-${pick}`, label: `${legs} legs, ${PICK_LABEL[pick]}`, legs, pick })),
  ),
  ...SAM,
];
/** The original nightly ticket, the one the learner and the Today page follow. */
export const DEFAULT_RECIPE: Recipe = RECIPES.find((r) => r.id === `l${LEGS}-value`)!;

/** A rung's value on our raw model, before the blend toward DK. */
const rawEv = (r: Rung) => r.raw * dec(r.over) - 1;
const score: { [k in Pick]: (r: Rung) => number } = { value: (r) => r.ev, chance: (r) => r.ours, long: (r) => r.over, raw: rawEv };

/** The night's ticket under a recipe: one positive-value rung per game, the top games. Null when too few games qualify. */
export function ticket(date: string, rungs: Rung[], recipe: Recipe = DEFAULT_RECIPE): Ticket | null {
  if (recipe.water) return watered(date, rungs, recipe);
  const by = score[recipe.pick];
  const best = new Map<string, Rung>();
  for (const r of rungs) {
    if (r.date !== date || (recipe.pick === "raw" ? rawEv(r) : r.ev) <= 0) continue;
    if (recipe.stat && r.stat !== recipe.stat) continue;
    if (recipe.band && (r.over < recipe.band[0] || r.over > recipe.band[1])) continue;
    const cur = best.get(r.game);
    if (!cur || by(r) > by(cur)) best.set(r.game, r);
  }
  const legs = [...best.values()].sort((a, b) => by(b) - by(a) || a.id.localeCompare(b.id)).slice(0, recipe.legs);
  if (legs.length < recipe.legs) return null;
  return priced(date, legs);
}

/** The water-down ticket: the parent ticket's players, each on his shortest rung of the stat. */
function watered(date: string, rungs: Rung[], recipe: Recipe): Ticket | null {
  const parent = RECIPES.find((r) => r.id === recipe.water);
  const base = parent ? ticket(date, rungs, parent) : null;
  if (!base) return null;
  const legs = base.legs.map((l) => rungs.filter((r) => r.date === date && r.id === l.id).sort((a, b) => a.over - b.over)[0] ?? l);
  return priced(date, legs);
}

function priced(date: string, legs: Rung[]): Ticket {
  const standing = legs.filter((l) => l.hit !== "void");
  const graded = legs.every((l) => l.hit !== null);
  const d = standing.reduce((a, l) => a * dec(l.over), 1);
  return {
    date,
    legs,
    price: standing.length ? toAmerican(d) : 0,
    chance: standing.reduce((a, l) => a * l.ours, 1),
    book: standing.reduce((a, l) => a * implied(l.over), 1),
    outcome: !graded ? null : standing.length && standing.every((l) => l.hit === true) ? "W" : standing.length ? "L" : null,
  };
}

export interface LottoSummary {
  rungs: { n: number; hits: number; ours: number; book: number; edge: { n: number; hits: number; net: number } };
  tickets: { n: number; won: number; net: number; expected: number };
  /** By our chance, in bands: how often rungs we gave that chance hit. */
  bands: { band: string; n: number; hits: number; ours: number; book: number }[];
}

const BANDS = [0, 0.05, 0.1, 0.15, 0.2, 0.3, 1];

/** Graded rungs and tickets rolled up. Edge rungs: our chance beats DK's break-even, 1u each. */
export function summarize(rungs: Rung[], tickets: Ticket[]): LottoSummary {
  const g = rungs.filter((r) => r.hit === true || r.hit === false);
  const edge = g.filter((r) => r.ev > 0);
  const t = tickets.filter((x) => x.outcome !== null);
  return {
    rungs: {
      n: g.length,
      hits: g.filter((r) => r.hit === true).length,
      ours: g.reduce((a, r) => a + r.ours, 0),
      book: g.reduce((a, r) => a + implied(r.over), 0),
      edge: { n: edge.length, hits: edge.filter((r) => r.hit === true).length, net: edge.reduce((a, r) => a + (r.hit === true ? payout(r.over) : -1), 0) },
    },
    tickets: {
      n: t.length,
      won: t.filter((x) => x.outcome === "W").length,
      net: t.reduce((a, x) => a + (x.outcome === "W" ? STAKE * payout(x.price) : -STAKE), 0),
      expected: t.reduce((a, x) => a + x.chance, 0),
    },
    bands: BANDS.slice(0, -1).map((lo, i) => {
      const hi = BANDS[i + 1];
      const b = g.filter((r) => r.ours >= lo && r.ours < hi);
      return {
        band: `${Math.round(lo * 100)}-${Math.round(hi * 100)}%`,
        n: b.length,
        hits: b.filter((r) => r.hit === true).length,
        ours: b.reduce((a, r) => a + r.ours, 0),
        book: b.reduce((a, r) => a + implied(r.over), 0),
      };
    }),
  };
}

/** Every night's ticket under a recipe (the original by default), newest first. */
export function tickets(rungs: Rung[], recipe: Recipe = DEFAULT_RECIPE): Ticket[] {
  const dates = [...new Set(rungs.map((r) => r.date))].sort().reverse();
  return dates.map((d) => ticket(d, rungs, recipe)).filter((x): x is Ticket => x !== null);
}

export interface RecipeRecord {
  recipe: Recipe;
  /** Graded tickets. */
  n: number;
  won: number;
  /** Hits our chances expected, and DraftKings' (vig in). */
  expected: number;
  book: number;
  /** At STAKE a ticket. */
  net: number;
  /** Tonight's ticket price, when there is one. */
  tonight?: number;
}

/** Every recipe's record, the original first. Tracked only. */
export function recipeRecords(rungs: Rung[], today?: string): RecipeRecord[] {
  return RECIPES.map((recipe) => {
    const all = tickets(rungs, recipe);
    const t = all.filter((x) => x.outcome !== null);
    const tonight = today ? all.find((x) => x.date === today && x.outcome === null) : undefined;
    return {
      recipe,
      n: t.length,
      won: t.filter((x) => x.outcome === "W").length,
      expected: t.reduce((a, x) => a + x.chance, 0),
      book: t.reduce((a, x) => a + x.book, 0),
      net: t.reduce((a, x) => a + (x.outcome === "W" ? STAKE * payout(x.price) : -STAKE), 0),
      ...(tonight ? { tonight: tonight.price } : {}),
    };
  }).sort((a, b) => (a.recipe === DEFAULT_RECIPE ? -1 : b.recipe === DEFAULT_RECIPE ? 1 : 0));
}
