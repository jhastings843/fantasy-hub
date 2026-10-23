// Our NFL projections against DraftKings' lines, in the props tracker's
// shape (as nba/market.ts does for the NBA). ESPN's feed carries DK's NFL
// lines but, so far, no NFL prices: a price comes from ESPN when it has one,
// else from DK itself via The Odds API's morning-of read (odds-api.ts), else
// from David Sasser's board when his DK line is the same number, else -110
// both ways, marked as assumed (grading already treats a missing price as
// -110). David's price is used only when his line equals ESPN's DK line; the
// Odds API read carries its own DK line, and when that differs from ESPN's the
// prop is tested at the read's line (extra.espnLine keeps what ESPN showed).

import { STAT_LABEL, implied, type PropMarket, type Side } from "@/lib/props/parse";
import type { LiveLine } from "../lines";
import { noVig } from "../nba/market";
import { nflMedian, nflOverUnder, type NflParams, type NflProjection, type NflStat } from "./props";

export const DK_NFL_STAT: { [type: string]: NflStat } = {
  "Total Passing Yards (incl. overtime)": "pass_yds",
  "Total Rushing Yards (incl. overtime)": "rush_yds",
  "Total Receiving Yards (incl. overtime)": "rec_yds",
  "Total Receptions (incl. overtime)": "rec",
};

export interface NflMarketExtra {
  over: number;
  under: number;
  /** Our median (yardage lines are priced from it, not the mean). */
  median: number;
  /** Where the price came from. */
  price: "espn" | "odds-api" | "david" | "assumed";
  /** ESPN's DK line when the price came at a different line (the market's line is the priced one). */
  espnLine?: number;
  /** FanDuel's line and prices on the same prop, the morning of game day (shown, not used for the edge). */
  fd?: { line: number; over: number; under: number };
}

const r1 = (x: number) => Math.round(x * 10) / 10;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

export function ourNflMarkets(
  lines: Map<string, LiveLine>,
  proj: Map<string, NflProjection>,
  names: Map<string, { name: string; team: string }>,
  david: (name: string, stat: NflStat, line: number) => { over: number; under: number; line?: number; source?: "odds-api" | "david" } | null,
  p: NflParams,
): { markets: PropMarket[]; extra: { [id: string]: NflMarketExtra } } {
  const markets: PropMarket[] = [];
  const extra: { [id: string]: NflMarketExtra } = {};
  for (const l of lines.values()) {
    const stat = DK_NFL_STAT[l.type];
    const pr = proj.get(l.athlete);
    const who = names.get(l.athlete);
    const espn = l.current.line;
    if (!stat || !pr || !who || espn === null) continue;
    const d = l.current.over !== null && l.current.under !== null ? null : david(who.name, stat, espn);
    // At a moved line both prices come from the read: ESPN's one posted side belongs to ESPN's line.
    const moved = d?.line !== undefined && d.line !== espn;
    const line = moved ? d!.line! : espn;
    const over = moved ? d!.over : l.current.over ?? d?.over ?? -110;
    const under = moved ? d!.under : l.current.under ?? d?.under ?? -110;
    const source: NflMarketExtra["price"] = moved ? d!.source ?? "david" : l.current.over !== null ? "espn" : d ? (d.source ?? "david") : "assumed";
    const mean = pr.mean[stat];
    const ch = nflOverUnder(stat, Math.max(mean, 0.1), line, p);
    const fair = noVig(over, under);
    const ev = (s: Side) => ch[s] - implied(s === "over" ? over : under);
    // No edge without a real price: an assumed -110 says nothing about what DK would pay.
    const side: Side | null = source === "assumed" ? null : ev("over") > 0 && ev("over") >= ev("under") ? "over" : ev("under") > 0 ? "under" : null;
    const id = `${stat}|${who.name}`;
    const median = stat === "rec" ? mean : nflMedian(stat, Math.max(mean, 0.1), p);
    markets.push({
      id,
      stat,
      statLabel: STAT_LABEL[stat],
      player: who.name,
      team: who.team,
      model: r1(median),
      line,
      gap: side ? r3(ch[side] - fair[side]) : null,
      clears: side !== null,
      weight: null,
      books: [{ book: "DraftKings", line, over, under, win: side !== null }],
      consensus: line,
      side,
      lean: ch.over > ch.under ? "over" : ch.under > ch.over ? "under" : null,
    });
    extra[id] = { over: r3(ch.over), under: r3(ch.under), median: r1(median), price: source, ...(line !== espn ? { espnLine: espn } : {}) };
  }
  markets.sort((a, b) => (b.gap ?? -1) - (a.gap ?? -1) || a.id.localeCompare(b.id));
  return { markets, extra };
}
