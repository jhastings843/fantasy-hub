import "server-only";
import { redis } from "@/lib/redis/client";
import { BOOKS, MARKETS, MONTHLY_STOP, ODDS_SPORT, type OddsEvent, type OddsRead, matchEvent, parseEventOdds, readDue } from "./odds-api";

// The Odds API, fetched and saved. No key (ODDS_API_KEY) means no reads:
// every caller falls back to David's board and then -110, as before.
//
// Redis:
//   oddsapi:v1:nfl:{season}:{espnEventId}   OddsRead, the morning-of read
//   oddsapi:v1:usage                        { used, remaining, at } from the last response

const BASE = "https://api.the-odds-api.com/v4";
const K = {
  read: (season: number, ev: string) => `oddsapi:v1:nfl:${season}:${ev}`,
  usage: "oddsapi:v1:usage",
};

/** Record the account's usage from a response's headers (any caller of the API, so the monthly stop sees every credit). */
export async function saveOddsUsage(h: Headers, at: string): Promise<OddsUsage | null> {
  const used = num(h, "x-requests-used");
  const remaining = num(h, "x-requests-remaining");
  if (used === undefined || remaining === undefined) return null;
  const u = { used, remaining, at };
  await redis.set(K.usage, u);
  return u;
}

export interface OddsUsage {
  used: number;
  remaining: number;
  at: string;
}

const num = (h: Headers, k: string) => {
  const v = Number(h.get(k));
  return Number.isFinite(v) ? v : undefined;
};

async function get(url: string): Promise<{ body: unknown; headers: Headers }> {
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`The Odds API answered ${res.status}`);
  return { body: await res.json(), headers: res.headers };
}

export async function loadOddsRead(season: number, ev: string): Promise<OddsRead | null> {
  return (await redis.get<OddsRead>(K.read(season, ev)).catch(() => null)) ?? null;
}

export async function loadOddsUsage(): Promise<OddsUsage | null> {
  return (await redis.get<OddsUsage>(K.usage).catch(() => null)) ?? null;
}

/**
 * The saved read for each game, taking the morning-of read first for any
 * game that is due. Returns the reads by ESPN event id and a line for the
 * run report. Never throws.
 */
export async function morningOddsReads(
  season: number,
  games: { espnId: string; home: string; away: string; kickoff: string }[],
  now: Date,
): Promise<{ reads: Map<string, OddsRead>; note: string | null }> {
  const reads = new Map<string, OddsRead>();
  for (const g of games) {
    const r = await loadOddsRead(season, g.espnId);
    if (r) reads.set(g.espnId, r);
  }
  const key = process.env.ODDS_API_KEY;
  const due = games.filter((g) => readDue(g.kickoff, now, reads.has(g.espnId)));
  if (!key || !due.length) return { reads, note: key ? null : due.length ? "no ODDS_API_KEY: prices from David or -110" : null };
  const notes: string[] = [];
  try {
    // The events list is free.
    const { body } = await get(`${BASE}/sports/${ODDS_SPORT}/events?apiKey=${key}`);
    const events = body as OddsEvent[];
    let usage = await loadOddsUsage();
    for (const g of due) {
      if (usage && usage.used + MARKETS.length > MONTHLY_STOP) {
        notes.push(`stopped at ${usage.used} credits this month (stop ${MONTHLY_STOP})`);
        break;
      }
      const e = matchEvent(events, g.home, g.away, g.kickoff);
      if (!e) {
        notes.push(`${g.away}@${g.home}: no Odds API event`);
        continue;
      }
      const res = await get(`${BASE}/sports/${ODDS_SPORT}/events/${e.id}/odds?apiKey=${key}&bookmakers=${BOOKS.join(",")}&markets=${MARKETS.join(",")}&oddsFormat=american`);
      const read = { ...parseEventOdds(res.body, now.toISOString()), cost: num(res.headers, "x-requests-last") };
      const used = num(res.headers, "x-requests-used");
      const remaining = num(res.headers, "x-requests-remaining");
      if (used !== undefined && remaining !== undefined) {
        usage = { used, remaining, at: now.toISOString() };
        await redis.set(K.usage, usage);
      }
      // Kept two weeks: long enough to grade, no longer.
      await redis.set(K.read(season, g.espnId), read, { ex: 14 * 86400 });
      reads.set(g.espnId, read);
      notes.push(`${g.away}@${g.home}: ${Object.keys(read.props).length} props (FanDuel ${Object.keys(read.fd?.props ?? {}).length}), ${Object.keys(read.firstTd).length} first TD, ${read.cost ?? "?"} credits`);
    }
    if (usage) notes.push(`${usage.used} used this month, ${usage.remaining} left`);
  } catch (err) {
    notes.push(`The Odds API: ${err instanceof Error ? err.message : String(err)}`);
  }
  return { reads, note: notes.join("; ") };
}
