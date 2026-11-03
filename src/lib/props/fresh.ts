import "server-only";
import { redis } from "@/lib/redis/client";
import { freshOddsRead } from "@/lib/models/nfl/odds-api-store";
import { readNbaLines } from "@/lib/models/nba/store";
import { freshGames, type FreshGame, type FreshQuote } from "./fresh-core";
import type { StakedBet } from "./staked-core";

// The fresh pre-lock reads (rules in fresh-core.ts), taken by the staked-push
// pulse job only; every other reader (Today tab, emails) uses what is saved.
//
// Redis:
//   staked:v1:fresh:{sport|event|date}        FreshQuote, two days
//   staked:v1:fresh-claim:{sport|event|date}  NX claim: one read per game per day, even when it fails
//
// NFL reads The Odds API (only the markets the game's staked props need,
// DraftKings and FanDuel, checked against MONTHLY_STOP first). NBA reads
// ESPN's DraftKings feed, the same free source its board was priced from.

const KEEP = 2 * 86400;
export const FK = {
  quote: (k: string) => `staked:v1:fresh:${k}`,
  claim: (k: string) => `staked:v1:fresh-claim:${k}`,
};

/** The saved fresh quotes for these keys. A failed read is an empty map (every bet stays pending: no push). */
export async function loadFreshQuotes(keys: string[]): Promise<Map<string, FreshQuote>> {
  const ks = [...new Set(keys)];
  if (!ks.length) return new Map();
  try {
    const got = await redis.mget<(FreshQuote | null)[]>(...ks.map(FK.quote));
    return new Map(ks.flatMap((k, i) => (got[i] ? [[k, got[i]!] as const] : [])));
  } catch {
    return new Map();
  }
}

async function readOne(g: FreshGame, now: Date): Promise<FreshQuote> {
  const at = now.toISOString();
  if (g.sport === "NFL") {
    const r = await freshOddsRead({ home: g.home, away: g.away, kickoff: g.kickoff }, g.markets, now);
    return "why" in r ? { ok: false, at, why: r.why } : { ok: true, at, sport: "NFL", read: r.read, markets: g.markets, ...(r.read.cost !== undefined ? { cost: r.read.cost } : {}) };
  }
  try {
    const { lines, alts } = await readNbaLines(g.event);
    return { ok: true, at, sport: "NBA", lines, alts };
  } catch (e) {
    return { ok: false, at, why: `ESPN odds feed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/**
 * Takes the fresh read for each game that is due, once per game per day.
 * Returns how many were read and a line each for the run report. Never throws.
 */
export async function takeFreshReads(bets: StakedBet[], now: Date): Promise<{ read: number; notes: string[] }> {
  const notes: string[] = [];
  let read = 0;
  for (const g of freshGames(bets, now, new Set())) {
    try {
      // The claim comes first, so a rerun or a second pulse can never read the same game twice in a day.
      if ((await redis.set(FK.claim(g.key), now.toISOString(), { nx: true, ex: KEEP })) !== "OK") continue;
      const q = await readOne(g, now);
      await redis.set(FK.quote(g.key), q, { ex: KEEP });
      read++;
      const name = `${g.away}@${g.home}`;
      notes.push(q.ok ? (q.sport === "NFL" ? `${name}: fresh read, ${q.markets.length} markets, ${q.cost ?? "?"} credits` : `${name}: fresh read from ESPN, 0 credits`) : `${name}: no fresh price, ${q.why}`);
    } catch (e) {
      notes.push(`${g.away}@${g.home}: fresh read not saved, ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { read, notes };
}
