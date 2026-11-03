// The four numbers behind our own model's call in one market, for the game
// pop-ups' "Our side" row (Jack, 2026-11-02: "our line should also be listed
// within the boxed breakdowns"). Cover chance is our tracked record pulled
// toward 50% (an estimate); edge per unit is that chance at the posted price,
// or at -110 when no price is posted (flagged `assumed`). Straight up passes
// `assume: false`, since -110 means nothing for a moneyline. Pure.
import { decimal, shrunk } from "./staking";

export const ASSUMED_PRICE = -110;

export interface OurBoxes {
  /** Cover (or win) chance, 0-1; null with no graded games. */
  p: number | null;
  /** Expected return on 1u, percent; null with no chance or no usable price. */
  edgePct: number | null;
  /** The price edge per unit used, when there was one. */
  price: number | null;
  /** True when no price was posted and -110 stood in. */
  assumed: boolean;
}

/** Expected return on 1u at an American price for win chance p, in percent. */
export const edgePerUnit = (p: number, price: number) => (p * decimal(price) - 1) * 100;

export function ourBoxes(o: { record?: { w: number; l: number } | null; price?: number | null; priorGames?: number; assume?: boolean }): OurBoxes {
  const r = o.record;
  const p = r && r.w + r.l > 0 ? (o.priorGames !== undefined ? shrunk(r.w, r.l, o.priorGames) : shrunk(r.w, r.l)) : null;
  const posted = o.price ?? null;
  const assumed = posted === null && o.assume !== false;
  const price = posted ?? (assumed ? ASSUMED_PRICE : null);
  return { p, edgePct: p !== null && price !== null ? edgePerUnit(p, price) : null, price, assumed };
}
