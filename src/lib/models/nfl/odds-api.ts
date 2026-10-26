// DraftKings' NFL prop prices from The Odds API (the-odds-api.com), because
// ESPN's feed carries DK's NFL prop lines but no prices (0 of 664 on
// 2026-10-21). One read per game, the morning of game day (Jack, 2026-10-21),
// for the markets the models price: four yardage/catch props and First TD.
//
// Cost: the event-odds endpoint charges one credit per market per region;
// `bookmakers=draftkings` counts as one region, so a read is at most 5
// credits. The events list is free. The free plan is 500 credits a month;
// MONTHLY_STOP keeps us under it, read from the API's own usage header.
//
// This half is pure: parsing and matching. odds-api-store.ts fetches and saves.

import { NFL_TEAMS } from "@/lib/picks/teams";
import { nameKey } from "@/lib/props/grade";
import type { NflStat } from "./props";

export const ODDS_SPORT = "americanfootball_nfl";
export const MONTHLY_STOP = 450;

export const ODDS_MARKET: { [s in NflStat]: string } = {
  pass_yds: "player_pass_yds",
  rush_yds: "player_rush_yds",
  rec_yds: "player_reception_yds",
  rec: "player_receptions",
};
export const FIRST_TD = "player_1st_td";
/** Anytime TD (Jack, 2026-10-26): a sixth market, so a read is at most 6 credits. */
export const ANYTIME_TD = "player_anytime_td";
export const MARKETS = [...Object.values(ODDS_MARKET), FIRST_TD, ANYTIME_TD];
/** DraftKings plus FanDuel (Jack, 2026-10-21): up to 10 books count as one region, so the second book costs nothing. */
export const BOOKS = ["draftkings", "fanduel"];

/** One morning read of one game. */
export interface OddsRead {
  at: string;
  /** "nameKey|stat" -> DK's line and prices. */
  props: { [k: string]: { line: number; over: number; under: number } };
  /** nameKey -> DK's First TD price. */
  firstTd: { [k: string]: number };
  /** nameKey -> DK's Anytime TD price (reads from 2026-10-27 on). */
  anytime?: { [k: string]: number };
  /** Credits this read cost, from the API's x-requests-last header. */
  cost?: number;
  /** FanDuel's numbers from the same read (reads from 2026-10-22 on), same shape: its own line, any line. */
  fd?: { props: OddsRead["props"]; firstTd: OddsRead["firstTd"]; anytime?: OddsRead["anytime"] };
}

interface OddsOutcome {
  name?: string;
  description?: string;
  price?: number;
  point?: number;
}
interface OddsEventOdds {
  bookmakers?: { key?: string; markets?: { key?: string; outcomes?: OddsOutcome[] }[] }[];
}

const STAT_OF = new Map(Object.entries(ODDS_MARKET).map(([s, m]) => [m, s as NflStat]));

/** One book's props and First TD prices from an event-odds response. */
function parseBook(json: unknown, book: string): { props: OddsRead["props"]; firstTd: OddsRead["firstTd"]; anytime: { [k: string]: number } } {
  const out = { props: {} as OddsRead["props"], firstTd: {} as OddsRead["firstTd"], anytime: {} as { [k: string]: number } };
  const b = (json as OddsEventOdds)?.bookmakers?.find((x) => x.key === book);
  for (const m of b?.markets ?? []) {
    if (m.key === FIRST_TD || m.key === ANYTIME_TD) {
      const into = m.key === FIRST_TD ? out.firstTd : out.anytime;
      for (const o of m.outcomes ?? []) {
        const who = o.description ?? o.name;
        if (who && typeof o.price === "number" && o.name !== "No") into[nameKey(who)] = o.price;
      }
      continue;
    }
    const stat = STAT_OF.get(m.key ?? "");
    if (!stat) continue;
    const by = new Map<string, { line?: number; over?: number; under?: number }>();
    for (const o of m.outcomes ?? []) {
      if (!o.description || typeof o.price !== "number" || typeof o.point !== "number") continue;
      const k = `${nameKey(o.description)}|${stat}`;
      const e = by.get(k) ?? {};
      // One line per player here; a second number is an alternate and is skipped.
      if (e.line !== undefined && e.line !== o.point) continue;
      e.line = o.point;
      if (o.name === "Over") e.over = o.price;
      else if (o.name === "Under") e.under = o.price;
      by.set(k, e);
    }
    for (const [k, e] of by) if (e.line !== undefined && e.over !== undefined && e.under !== undefined) out.props[k] = { line: e.line, over: e.over, under: e.under };
  }
  return out;
}

export function parseEventOdds(json: unknown, at: string): OddsRead {
  const dk = parseBook(json, "draftkings");
  const fd = parseBook(json, "fanduel");
  return { at, ...dk, ...(Object.keys(fd.props).length || Object.keys(fd.firstTd).length || Object.keys(fd.anytime).length ? { fd } : {}) };
}

/** FanDuel's line and prices on a prop, whatever its line. */
export function fdProp(read: OddsRead | null | undefined, name: string, stat: NflStat): { line: number; over: number; under: number } | null {
  return read?.fd?.props[`${nameKey(name)}|${stat}`] ?? null;
}

/**
 * DK's price for our board. At ESPN's line when the read agrees; when DK's
 * line in the read is a different number, that line and its price, so the
 * prop is tested where DK actually priced it (Jack, 2026-10-22: 11 of 14
 * NE@CHI props went unpriced over a half to six point gap).
 */
export function oddsPrice(read: OddsRead | null | undefined, name: string, stat: NflStat, line: number): { over: number; under: number; line?: number } | null {
  const p = read?.props[`${nameKey(name)}|${stat}`];
  if (!p) return null;
  return p.line === line ? { over: p.over, under: p.under } : { over: p.over, under: p.under, line: p.line };
}

export interface OddsEvent {
  id: string;
  home_team: string;
  away_team: string;
  commence_time: string;
}

/** The Odds API's event for a game, by both teams (our abbreviations) and a kickoff within three hours. */
export function matchEvent(events: OddsEvent[], home: string, away: string, kickoff: string): OddsEvent | undefined {
  const t = Date.parse(kickoff);
  return events.find((e) => NFL_TEAMS[e.home_team] === home && NFL_TEAMS[e.away_team] === away && Math.abs(Date.parse(e.commence_time) - t) < 3 * 3600_000);
}

const etDate = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });

/** Read now? Only on the game's own Eastern date, from 8am ET, once. */
export function readDue(kickoff: string, now: Date, have: boolean): boolean {
  if (have) return false;
  const k = new Date(kickoff);
  if (k <= now || etDate(k) !== etDate(now)) return false;
  const hour = Number(now.toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }));
  return hour >= 8;
}
