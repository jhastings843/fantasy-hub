// The optimizer's view in the URL (?mode=pool&n=100&score=espn&pay=wta), so a link reproduces it. Pure.

import { SCORING_IDS, type PayoutId, type ScoringId } from "@/lib/models/cbb/bracket";

export type Mode = "pool" | "perfect";
export interface BracketQuery {
  mode: Mode;
  n: number;
  score: ScoringId;
  pay: PayoutId;
}

export const N_MIN = 2;
export const N_MAX = 10000;
export const QUICK_N = [10, 25, 50, 100, 500, 1000, 10000] as const;
export const DEFAULT_QUERY: BracketQuery = { mode: "pool", n: 100, score: "espn", pay: "wta" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function parseQuery(q: { [k: string]: string | string[] | undefined }): BracketQuery {
  const mode = one(q.mode) === "perfect" ? "perfect" : "pool";
  const n = Math.round(Number(one(q.n)));
  const score = one(q.score) as ScoringId;
  const pay = one(q.pay) === "top3" ? "top3" : "wta";
  return {
    mode,
    n: Number.isFinite(n) && n >= N_MIN ? Math.min(N_MAX, n) : DEFAULT_QUERY.n,
    score: SCORING_IDS.includes(score) ? score : DEFAULT_QUERY.score,
    pay,
  };
}

export function toQuery(v: BracketQuery): string {
  const q = new URLSearchParams({ mode: v.mode });
  if (v.mode === "pool") {
    q.set("n", String(v.n));
    q.set("score", v.score);
    q.set("pay", v.pay);
  }
  return `?${q.toString()}`;
}

/** Slider position 0..1000 on a log scale, and back. */
export const nToPos = (n: number) => Math.round((1000 * Math.log(n / N_MIN)) / Math.log(N_MAX / N_MIN));
export function posToN(pos: number): number {
  const raw = N_MIN * Math.pow(N_MAX / N_MIN, pos / 1000);
  // Round to a friendly number for its size.
  const step = raw < 30 ? 1 : raw < 200 ? 5 : raw < 1000 ? 25 : raw < 5000 ? 100 : 500;
  return Math.min(N_MAX, Math.max(N_MIN, Math.round(raw / step) * step));
}
