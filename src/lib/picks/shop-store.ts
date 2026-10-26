import "server-only";
import { redis } from "@/lib/redis/client";
import { loadOddsUsage, saveOddsUsage } from "@/lib/models/nfl/odds-api-store";
import { MONTHLY_STOP } from "@/lib/models/nfl/odds-api";
import { key, type RefLine } from "./engine";
import type { League } from "./parse";
import { SHOP_BOOKS, SHOP_FRESH_MIN, SHOP_SPORT, applyShop, parseShop, type OddsGame, type ShopRead } from "./shop";

// Price shopping, fetched and saved (shop.ts has the why). One read of a
// sport's spreads and totals across Jack's books costs 2 credits, so it is
// taken only on a game-day morning for that sport, from the daily bets run,
// at most every SHOP_EVERY_MIN, and never past the account's monthly stop
// (shared with the NFL props reads). The quotes path applies the latest read
// while it is fresh; no read, an old read or no key leaves DraftKings alone.
//
// Redis: picks:v2:{league}:shop  ShopRead (latest), kept a day

const BASE = "https://api.the-odds-api.com/v4";
const KEY = (league: League) => `picks:v2:${league}:shop`;
const COST = 2;
/** The daily run retries every pulse while it waits on boards; this keeps that to a few reads. */
const SHOP_EVERY_MIN = 90;

export async function loadShop(league: League): Promise<ShopRead | null> {
  return (await redis.get<ShopRead>(KEY(league)).catch(() => null)) ?? null;
}

/** Take a fresh read when one is due. Returns a line for the run report. Never throws. */
export async function refreshShop(league: League, appNames: string[], now = new Date()): Promise<string> {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) return "price shopping off: no ODDS_API_KEY";
  try {
    const last = await loadShop(league);
    if (last && now.getTime() - Date.parse(last.at) < SHOP_EVERY_MIN * 60_000) return `shop read ${Math.round((now.getTime() - Date.parse(last.at)) / 60_000)} min ago`;
    const usage = await loadOddsUsage();
    if (usage && usage.used + COST > MONTHLY_STOP) return `price shopping stopped at ${usage.used} credits this month (stop ${MONTHLY_STOP})`;
    const res = await fetch(`${BASE}/sports/${SHOP_SPORT[league]}/odds?apiKey=${apiKey}&bookmakers=${SHOP_BOOKS.join(",")}&markets=spreads,totals&oddsFormat=american`, {
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return `price shopping: The Odds API answered ${res.status}`;
    const games = parseShop(league, (await res.json()) as OddsGame[], appNames);
    const cost = Number(res.headers.get("x-requests-last"));
    const read: ShopRead = { at: now.toISOString(), league, games, ...(Number.isFinite(cost) ? { cost } : {}) };
    await redis.set(KEY(league), read, { ex: 86_400 });
    const u = await saveOddsUsage(res.headers, read.at);
    return `shop read: ${games.length} games named, ${read.cost ?? "?"} credits${u ? `, ${u.used} used this month` : ""}`;
  } catch (e) {
    return `price shopping: ${e instanceof Error ? e.message : String(e)}`;
  }
}

/** The quotes with the latest fresh shop read applied (DraftKings' own number, best price of Jack's books). */
export async function shopLines(league: League, week: number, lines: Map<string, RefLine>, now = new Date()): Promise<Map<string, RefLine>> {
  const read = await loadShop(league);
  if (!read || now.getTime() - Date.parse(read.at) > SHOP_FRESH_MIN * 60_000) return lines;
  const byGame = new Map(read.games.map((g) => [key({ week, home: g.home, away: g.away }), g]));
  // The same matchup can come round again later in the season: only the read's game within a few hours of this kickoff.
  const near = (k: string, ref: RefLine) => {
    const g = byGame.get(k);
    return g && (!ref.kickoff || Math.abs(Date.parse(g.commence) - Date.parse(ref.kickoff)) < 6 * 3_600_000) ? g : undefined;
  };
  return new Map([...lines].map(([k, ref]) => [k, applyShop(ref, near(k, ref), read.at)]));
}
