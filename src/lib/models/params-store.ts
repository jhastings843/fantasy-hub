import "server-only";
import { createHash } from "node:crypto";
import { redis } from "@/lib/redis/client";

// Model settings that refit on their own (Jack, 2026-10-27: settings live in
// the database; a weekly job refits and keeps only settings that win on games
// the fit never saw). The JSON beside each model is the default and the
// fallback; an accepted refit is stored here and overrides it field by field.
// Stores read settings through live(): call primeParams() at an entry point,
// and every read after that sees the stored override (5 minutes fresh).

export const MODEL_KEYS = ["nba-props", "nba-fb", "nba-game", "nba-kotc", "nfl-props", "nfl-ftd", "nfl-attd", "nfl-spread", "nfl-totals"] as const;
export type ModelKey = (typeof MODEL_KEYS)[number];

export interface StoredParams {
  params: Record<string, unknown>;
  at: string;
  /** What the refit job measured: held-out loss before and after, games, paired gain in standard errors. */
  evidence: { before: number; after: number; games: number; se: number; note?: string };
}

const KEY = (m: ModelKey) => `models:v1:params:${m}`;
const FRESH_MS = 5 * 60_000;
const cache = new Map<ModelKey, Record<string, unknown> | null>();
const defaultsOf = new Map<ModelKey, object>();
let primedAt = 0;
/** Set when the last load failed: what went wrong. Cleared by the next good load. */
let failed: string | null = null;

/** Loads every model's stored override in one read. Never throws: a failed read keeps the last values (or the defaults) and shows in paramsProblem() and paramsVersion(). */
export async function primeParams(now = Date.now()): Promise<void> {
  if (now - primedAt < FRESH_MS && !failed) return;
  try {
    const got = await redis.mget<(StoredParams | null)[]>(...MODEL_KEYS.map(KEY));
    MODEL_KEYS.forEach((m, i) => cache.set(m, got[i]?.params ?? null));
    primedAt = now;
    failed = null;
  } catch (e) {
    failed = e instanceof Error ? e.message : String(e);
  }
}

/**
 * Where a model's settings came from on this run:
 *   live     a stored refit, read on the last load
 *   default  the JSON beside the model (no refit stored, or nothing ever loaded)
 *   stale    the last load failed; an earlier load's values are in use
 * degraded marks a failed last load.
 */
export type ParamsSource = "live" | "default" | "stale";
export interface ParamsStamp {
  /** First 10 hex of sha1 over the settings JSON in use (defaults with any refit laid over). */
  hash: string;
  source: ParamsSource;
  degraded?: true;
}

/** Short hash of a settings object. Pure. */
export function paramsHash(p: unknown): string {
  return createHash("sha1").update(JSON.stringify(p)).digest("hex").slice(0, 10);
}

/** The version of the settings a model runs on right now, for stamping on what it saves. */
export function paramsVersion(model: ModelKey): ParamsStamp {
  const defaults = (defaultsOf.get(model) ?? {}) as Record<string, unknown>;
  const o = cache.get(model) ?? null;
  const source: ParamsSource = failed && primedAt > 0 ? "stale" : o ? "live" : "default";
  const stamp: ParamsStamp = { hash: paramsHash(o ? { ...defaults, ...o } : defaults), source };
  if (failed) stamp.degraded = true;
  return stamp;
}

/** A line for a run report's problems when the last settings load failed, else null. */
export function paramsProblem(): string | null {
  if (!failed) return null;
  return `model settings did not load (${failed.slice(0, 120)}): running on ${primedAt > 0 ? "the last loaded values" : "the JSON defaults"}`;
}

/** Test hook: forget every load. */
export function resetParamsForTest(): void {
  cache.clear();
  primedAt = 0;
  failed = null;
}

/** The settings a model runs on: its JSON defaults with any accepted refit laid over them. */
export function live<T extends object>(model: ModelKey, defaults: T): T {
  defaultsOf.set(model, defaults);
  return new Proxy(defaults, {
    get(target, prop, recv) {
      const o = cache.get(model);
      if (o && typeof prop === "string" && prop in o) return o[prop];
      return Reflect.get(target, prop, recv);
    },
  });
}

/**
 * Checks a refit before it is stored: only fields the defaults already have,
 * each the same shape (numbers stay finite numbers), so a bad upload can't
 * add a setting or break a type. Pure. Returns the problems, empty when fine.
 */
export function checkParams(defaults: Record<string, unknown>, next: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(next)) {
    if (!(k in defaults)) out.push(`unknown setting ${k}`);
    else if (!sameShape(defaults[k], v)) out.push(`${k} changed shape`);
  }
  return out;
}

function sameShape(a: unknown, b: unknown): boolean {
  if (typeof a === "number") return typeof b === "number" && Number.isFinite(b);
  if (Array.isArray(a)) return Array.isArray(b) && b.length === a.length && a.every((x, i) => sameShape(x, b[i]));
  if (a && typeof a === "object") return !!b && typeof b === "object" && !Array.isArray(b) && Object.keys(b as object).every((k) => k in (a as object) && sameShape((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  return typeof a === typeof b;
}

export async function saveParams(model: ModelKey, stored: StoredParams): Promise<void> {
  await redis.set(KEY(model), stored);
  await redis.rpush(`models:v1:params-log:${model}`, JSON.stringify({ at: stored.at, evidence: stored.evidence }));
  primedAt = 0;
}

export async function storedParams(model: ModelKey): Promise<StoredParams | null> {
  return (await redis.get<StoredParams>(KEY(model)).catch(() => null)) ?? null;
}
