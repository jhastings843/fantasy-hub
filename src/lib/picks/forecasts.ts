import "server-only";
import { redis } from "@/lib/redis/client";
import type { League, ModelLine } from "./parse";
import { type BoardGame, type PemLine, type RefLine, key } from "./engine";
import type { CoreRow } from "./compose";

// Immutable pregame evidence. Every data run appends a snapshot for each game
// whose inputs changed since the last one: both models' lines and totals,
// PEM's line, and the one current quote with its prices, stamped with when
// it was seen, and only before kickoff. Nothing is ever rewritten, so a cut
// or policy registered at time T can be judged later on exactly what was
// known before each game, from T on. Season-aware keys.

export interface ForecastSnapshot {
  at: string;
  week: number;
  home: string;
  away: string;
  sam?: ModelLine;
  david?: ModelLine;
  pem?: PemLine;
  samTotal?: number;
  davidTotal?: number;
  ref?: RefLine;
}

const listKey = (league: League, season: number, week: number) => `picks:v2:${league}:${season}:forecast:w${week}`;
const fpKey = (league: League, season: number, week: number) => `picks:v2:${league}:${season}:forecast-fp:w${week}`;
const indexKey = (league: League, season: number) => `picks:v2:${league}:${season}:forecast-weeks`;

/** The inputs that matter, without the read time, so an unchanged game is not re-appended. */
export function fingerprint(s: Omit<ForecastSnapshot, "at">): string {
  const r = s.ref;
  return JSON.stringify([
    s.sam?.model, s.sam?.market, s.david?.model, s.david?.market, s.pem?.model, s.samTotal, s.davidTotal,
    r?.line, r?.total, r?.homePrice, r?.awayPrice, r?.overPrice, r?.underPrice, r?.kickoff,
  ]);
}

export async function archiveForecasts(league: League, season: number, week: number, board: BoardGame[], rows: CoreRow[]): Promise<number> {
  const at = new Date().toISOString();
  const snaps: ForecastSnapshot[] = board
    .filter((g) => g.basis === "reference" && g.ref)
    .map((g) => {
      const row = rows.find((r) => r.home === g.home && r.away === g.away);
      return { at, week, home: g.home, away: g.away, sam: g.sam, david: g.david, pem: g.pem, samTotal: row?.samTotal, davidTotal: row?.davidTotal, ref: g.ref };
    });
  if (!snaps.length) return 0;
  const prev = ((await redis.hgetall<Record<string, string>>(fpKey(league, season, week))) ?? {}) as Record<string, string>;
  const fresh = snaps.filter((s) => prev[key(s)] !== fingerprint(s));
  if (!fresh.length) return 0;
  await redis.rpush(listKey(league, season, week), ...fresh.map((s) => JSON.stringify(s)));
  await redis.hset(fpKey(league, season, week), Object.fromEntries(fresh.map((s) => [key(s), fingerprint(s)])));
  await redis.sadd(indexKey(league, season), week);
  return fresh.length;
}

export async function loadForecasts(league: League, season: number): Promise<ForecastSnapshot[]> {
  try {
    const weeks = (await redis.smembers(indexKey(league, season))).map(Number);
    const lists = await Promise.all(weeks.map((w) => redis.lrange<string | ForecastSnapshot>(listKey(league, season, w), 0, -1)));
    return lists.flat().map((x) => (typeof x === "string" ? (JSON.parse(x) as ForecastSnapshot) : x));
  } catch {
    return [];
  }
}
