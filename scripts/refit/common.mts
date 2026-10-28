// Shared by the weekly refit job (.github/workflows/model-refit.yml).
//
// Each fit script runs as before (writes its JSON defaults) unless started with
// --refit. Then it: rolls its split forward (test = the most recent games, train
// = everything before), refits on train, scores the LIVE settings (the JSON
// with any stored refit laid over it, read from /api/model-params) and the
// refit on the same held-out rows, and stores the refit only when it is better
// by more than 2 standard errors (the route enforces the same bar).
// --dry scores and prints without storing.
import type { ModelKey } from "../../src/lib/models/params-store";

export const REFIT = process.argv.includes("--refit");
export const DRY = process.argv.includes("--dry");
const APP = process.env.APP_URL ?? "https://fantasy-hub-tan.vercel.app";
const auth = () => ({ authorization: `Bearer ${process.env.CRON_SECRET ?? ""}` });

/** The settings the site runs on now: JSON defaults with the stored refit over them, field by field (as live() does). */
export async function liveParams<T extends object>(model: ModelKey, defaults: T): Promise<T> {
  if (!process.env.CRON_SECRET) {
    console.log(`(no CRON_SECRET: scoring the JSON defaults as live for ${model})`);
    return defaults;
  }
  const r = await fetch(`${APP}/api/model-params?model=${model}`, { headers: auth(), signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`GET model-params ${model}: HTTP ${r.status}`);
  const j = (await r.json()) as { stored: { params: Partial<T> } | null };
  return { ...defaults, ...(j.stored?.params ?? {}) };
}

export interface Evidence {
  before: number;
  after: number;
  games: number;
  se: number;
  note?: string;
}

/**
 * Paired comparison of two losses on the same held-out rows (lower is
 * better). se = how many standard errors the mean gain is from zero.
 */
export function paired(before: number[], after: number[], note?: string): Evidence {
  const n = before.length;
  if (!n || n !== after.length) return { before: NaN, after: NaN, games: n, se: 0, note };
  const d = before.map((b, i) => b - after[i]);
  const mean = (xs: number[]) => xs.reduce((a, x) => a + x, 0) / xs.length;
  const m = mean(d);
  const sd = Math.sqrt(d.reduce((a, x) => a + (x - m) ** 2, 0) / Math.max(n - 1, 1));
  const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
  return { before: r6(mean(before)), after: r6(mean(after)), games: n, se: sd > 0 ? Math.round((m / (sd / Math.sqrt(n))) * 100) / 100 : 0, note };
}

/** Only the settings the defaults have, so the route's shape check passes. */
export function pick<T extends object>(defaults: T, p: Partial<T>): Partial<T> {
  return Object.fromEntries(Object.entries(p).filter(([k]) => k in defaults)) as Partial<T>;
}

/** Stores the refit when it clears the bar; otherwise says why it was kept out. Returns true when stored. */
export async function submit<T extends object>(model: ModelKey, defaults: T, params: Partial<T>, ev: Evidence): Promise<boolean> {
  const line = `${model}: held-out loss live ${ev.before} vs refit ${ev.after} over ${ev.games} rows, gain ${ev.se} SE${ev.note ? ` (${ev.note})` : ""}`;
  console.log(line);
  const summary = process.env.GITHUB_STEP_SUMMARY;
  const out = async (s: string) => {
    if (summary) (await import("node:fs")).appendFileSync(summary, s + "\n");
  };
  if (!(ev.after < ev.before && ev.se >= 2)) {
    await out(`- ${line}: kept live (needs 2+ SE)`);
    return false;
  }
  if (DRY || !process.env.CRON_SECRET) {
    await out(`- ${line}: would store (dry run)`);
    console.log("dry run: not stored");
    return false;
  }
  const r = await fetch(`${APP}/api/model-params`, {
    method: "POST",
    headers: { ...auth(), "content-type": "application/json" },
    body: JSON.stringify({ model, params: pick(defaults, params), evidence: ev }),
    signal: AbortSignal.timeout(20_000),
  });
  const j = await r.text();
  await out(`- ${line}: ${r.ok ? "STORED" : `refused (${r.status} ${j})`}`);
  if (!r.ok) throw new Error(`POST model-params ${model}: ${r.status} ${j}`);
  return true;
}

/** The latest season folder with at least `min` games, so early-season runs fall back to last season's full year. */
export function latestSeason(counts: { [season: number]: number }, min: number): number {
  const ok = Object.entries(counts).filter(([, n]) => n >= min).map(([s]) => Number(s));
  return Math.max(...ok);
}

/** ISO date `days` before the last date in the list: the start of the held-out window. */
export function windowStart(dates: string[], days: number): string {
  const last = dates.reduce((a, d) => (d > a ? d : a), "");
  return new Date(Date.parse(`${last.slice(0, 10)}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
}
