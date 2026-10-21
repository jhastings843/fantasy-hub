// Our NBA projections set against DraftKings' lines, in the props tracker's
// own shape (PropsGame / PropMarket from lib/props/parse.ts), so grading,
// learning and the page treat our model like any other source.
//
// Per market: `model` is our projected mean, `line` and `books` are DK's,
// `side` is the side whose chance beats DK's break-even at its price (a
// model edge, null when neither does), `gap` is that side's chance minus
// DK's no-vig chance, and `lean` is the side we make likelier.

import { STAT_LABEL, implied, type PropMarket, type PropsGame, type Side } from "@/lib/props/parse";
import type { LiveLine } from "../lines";
import { overUnder, type NbaParams, type NbaStat, type Projection } from "./props";

export const DK_STAT: { [type: string]: NbaStat } = {
  "Total Points": "pts",
  "Total Rebounds": "reb",
  "Total Assists": "ast",
  "Total 3-Point Field Goals": "threes",
};

export interface OurMarketExtra {
  /** Our chance of the over and the under (pushes excluded on whole lines). */
  over: number;
  under: number;
  /** Projected minutes behind the number. */
  min: number;
  /** Games this season behind it (missing on boards saved before 2026-10-21 evening). */
  games?: number;
}

/** DK's chance with the vig taken out (the two sides scaled to sum to 1). */
export function noVig(over: number, under: number): { over: number; under: number } {
  const o = implied(over);
  const u = implied(under);
  return { over: o / (o + u), under: u / (o + u) };
}

const r1 = (x: number) => Math.round(x * 10) / 10;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

export function ourMarkets(
  lines: Map<string, LiveLine>,
  proj: Map<string, Projection>,
  names: Map<string, { name: string; team: string }>,
  p: NbaParams,
  games: Map<string, number> = new Map(),
): { markets: PropMarket[]; extra: { [id: string]: OurMarketExtra } } {
  const markets: PropMarket[] = [];
  const extra: { [id: string]: OurMarketExtra } = {};
  for (const l of lines.values()) {
    const stat = DK_STAT[l.type];
    const pr = proj.get(l.athlete);
    const who = names.get(l.athlete);
    const { line, over, under } = l.current;
    if (!stat || !pr || !who || line === null) continue;
    const mean = pr.mean[stat];
    const ch = overUnder(stat, Math.max(mean, 0.01), line, p);
    const fair = over !== null && under !== null ? noVig(over, under) : null;
    // A side is a model edge when its chance beats DK's break-even at its own price.
    const ev = (s: Side) => {
      const price = s === "over" ? over : under;
      return price === null ? -1 : ch[s] - implied(price);
    };
    const side: Side | null = ev("over") > 0 && ev("over") >= ev("under") ? "over" : ev("under") > 0 ? "under" : null;
    const lean: Side | null = ch.over > ch.under ? "over" : ch.under > ch.over ? "under" : null;
    const id = `${stat}|${who.name}`;
    markets.push({
      id,
      stat,
      statLabel: STAT_LABEL[stat],
      player: who.name,
      team: who.team,
      model: r1(mean),
      line,
      gap: side && fair ? r3(ch[side] - fair[side]) : null,
      clears: side !== null,
      weight: null,
      books: [{ book: "DraftKings", line, over, under, win: side !== null }],
      consensus: line,
      side,
      lean,
    });
    extra[id] = { over: r3(ch.over), under: r3(ch.under), min: r1(pr.min), ...(games.has(l.athlete) ? { games: games.get(l.athlete)! } : {}) };
  }
  markets.sort((a, b) => (b.gap ?? -1) - (a.gap ?? -1) || a.id.localeCompare(b.id));
  return { markets, extra };
}

export function ourGame(meta: { season: number; week: number; event: string; away: string; home: string }, markets: PropMarket[]): PropsGame {
  return { season: meta.season, week: meta.week, slug: meta.event, away: meta.away, home: meta.home, breakEven: null, favorites: [], markets };
}
