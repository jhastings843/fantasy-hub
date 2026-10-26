// Our NBA projections set against DraftKings' lines, in the props tracker's
// own shape (PropsGame / PropMarket from lib/props/parse.ts), so grading,
// learning and the page treat our model like any other source.
//
// Per market: `model` is our projected mean, `line` and `books` are DK's,
// `side` is the side whose chance beats DK's break-even at its price by
// minEdge (a model edge, null when neither does), `gap` is that side's chance
// minus DK's no-vig chance, and `lean` is the side we make likelier. From
// 2026-10-26 a gap over maxGap is no edge, and marketW can pull our chance
// toward DK's (blend) once there are enough graded boards to fit it.

import { STAT_LABEL, implied, type PropMarket, type PropsGame, type Side } from "@/lib/props/parse";
import { fullGameLadder, type LiveLine } from "../lines";
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
  /** Our model's own over chance before the pull toward DK (boards from 2026-10-26 on; over/under are blended). */
  raw?: number;
  /** Projected minutes behind the number. */
  min: number;
  /** Games this season behind it (missing on boards saved before 2026-10-21 evening). */
  games?: number;
  /** Set when an alternate line was nearer even money than the main line: the main line it replaced. */
  main?: { line: number; over: number | null; under: number | null };
  /** DK's long-shot rungs on the full-game ladder (+250 and longer, boards from 2026-10-26 on), for the lotto shadow. */
  longs?: LongRung[];
}

/** One "N+" rung DK prices at LONG_MIN or longer: our chance of the over, blended and raw. */
export interface LongRung {
  line: number;
  over: number;
  ours: number;
  raw: number;
}

/** The long-shot band the lotto shadow tracks: +250 to +2000 (Sam's legs ran +300 to +830). */
export const LONG_MIN = 250;
export const LONG_MAX = 2000;

/**
 * Our chance on each long rung of the ladder. DK prices these over-only, so the
 * vig is taken out with the main line's overround, as nearestEven does; that
 * understates the long rungs' bigger hold, so their fair chance reads a touch high.
 *
 *   longRungs([{ line: 19.5, over: 400 }], 1.05, pts mean 14) -> [{ line: 19.5, over: 400, ours, raw }]
 */
export function longRungs(stat: NbaStat, mean: number, ladder: { line: number; over: number }[], round: number | null, p: NbaParams): LongRung[] {
  return ladder
    .filter((r) => r.over >= LONG_MIN && r.over <= LONG_MAX)
    .map((r) => {
      const raw = overUnder(stat, Math.max(mean, 0.01), r.line, p).over;
      const fair = round ? Math.min(0.99, implied(r.over) / round) : null;
      return { line: r.line, over: r.over, ours: r3(blend(raw, fair, p.marketW ?? 1)), raw: r3(raw) };
    });
}

const EVEN = implied(-110);
/** How far a line's price sits from -110: the nearer side on the main line (either can be bet), the over on an alternate. */
const offEven = (over: number | null, under: number | null) =>
  Math.min(over !== null ? Math.abs(implied(over) - EVEN) : 1, under !== null ? Math.abs(implied(under) - EVEN) : 1);

/**
 * Jack (2026-10-21): test against the line priced closest to -110. From DK's
 * main line and its over-only alternates, keep whichever is nearest even
 * money. On an alternate only the over can be bet, and its fair chance is
 * the over's implied chance with the main line's overround taken out.
 */
export function nearestEven(
  main: { line: number; over: number | null; under: number | null },
  alts: { line: number; over: number }[],
): { line: number; over: number | null; under: number | null; fairOver: number | null; alt: boolean } {
  const fairMain = main.over !== null && main.under !== null ? noVig(main.over, main.under).over : null;
  let best = { line: main.line, over: main.over, under: main.under, fairOver: fairMain, alt: false };
  let d = offEven(main.over, main.under);
  const round = main.over !== null && main.under !== null ? implied(main.over) + implied(main.under) : null;
  for (const a of alts) {
    if (a.line === main.line) continue;
    const da = offEven(a.over, null);
    if (da < d) {
      d = da;
      best = { line: a.line, over: a.over, under: null, fairOver: round ? Math.min(0.99, implied(a.over) / round) : null, alt: true };
    }
  }
  return best;
}

/** DK's chance with the vig taken out (the two sides scaled to sum to 1). */
export function noVig(over: number, under: number): { over: number; under: number } {
  const o = implied(over);
  const u = implied(under);
  return { over: o / (o + u), under: u / (o + u) };
}

/**
 * Our chance pulled toward DK's: log-odds of DK's no-vig chance plus `w` times
 * our disagreement with it. Without DK's two-sided price there is nothing to
 * lean on and our own chance stands.
 *
 *   blend(0.70, 0.50, 0.3) -> 0.563   // a 20-point disagreement keeps 6.3 of it
 *   blend(0.70, null, 0.3) -> 0.70
 */
export function blend(ours: number, dk: number | null, w: number): number {
  if (dk === null || w >= 1) return ours;
  const lo = (x: number) => Math.log(x / (1 - x));
  const c = (x: number) => Math.min(0.999, Math.max(0.001, x));
  return 1 / (1 + Math.exp(-(lo(c(dk)) + w * (lo(c(ours)) - lo(c(dk))))));
}

const r1 = (x: number) => Math.round(x * 10) / 10;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

export function ourMarkets(
  lines: Map<string, LiveLine>,
  proj: Map<string, Projection>,
  names: Map<string, { name: string; team: string }>,
  p: NbaParams,
  games: Map<string, number> = new Map(),
  alts: Map<string, { line: number; over: number }[][]> = new Map(),
): { markets: PropMarket[]; extra: { [id: string]: OurMarketExtra } } {
  const markets: PropMarket[] = [];
  const extra: { [id: string]: OurMarketExtra } = {};
  for (const l of lines.values()) {
    const stat = DK_STAT[l.type];
    const pr = proj.get(l.athlete);
    const who = names.get(l.athlete);
    if (!stat || !pr || !who || l.current.line === null) continue;
    const ladder = fullGameLadder(alts.get(`${l.athlete}|${l.type}`) ?? [], l.current as { line: number; over: number | null });
    const pick = nearestEven({ line: l.current.line, over: l.current.over, under: l.current.under }, ladder);
    const { line, over, under } = pick;
    const mean = pr.mean[stat];
    const round = l.current.over !== null && l.current.under !== null ? implied(l.current.over) + implied(l.current.under) : null;
    const longs = longRungs(stat, mean, ladder, round, p);
    const raw = overUnder(stat, Math.max(mean, 0.01), line, p);
    const fair = pick.fairOver !== null ? { over: pick.fairOver, under: 1 - pick.fairOver } : null;
    const bo = blend(raw.over, fair?.over ?? null, p.marketW ?? 1);
    const ch = { over: bo, under: 1 - bo };
    const wild = fair !== null && p.maxGap !== undefined && Math.abs(raw.over - fair.over) > p.maxGap;
    // A side is a model edge when its blended chance beats DK's break-even at its own price by minEdge.
    const ev = (s: Side) => {
      const price = s === "over" ? over : under;
      return price === null ? -1 : ch[s] - implied(price);
    };
    const floor = p.minEdge ?? 0;
    const side: Side | null = wild ? null : ev("over") > floor && ev("over") >= ev("under") ? "over" : ev("under") > floor ? "under" : null;
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
    extra[id] = {
      over: r3(ch.over),
      under: r3(ch.under),
      ...(ch.over !== raw.over ? { raw: r3(raw.over) } : {}),
      min: r1(pr.min),
      ...(games.has(l.athlete) ? { games: games.get(l.athlete)! } : {}),
      ...(pick.alt ? { main: { line: l.current.line, over: l.current.over, under: l.current.under } } : {}),
      ...(longs.length ? { longs } : {}),
    };
  }
  markets.sort((a, b) => (b.gap ?? -1) - (a.gap ?? -1) || a.id.localeCompare(b.id));
  return { markets, extra };
}

export function ourGame(meta: { season: number; week: number; event: string; away: string; home: string }, markets: PropMarket[]): PropsGame {
  return { season: meta.season, week: meta.week, slug: meta.event, away: meta.away, home: meta.home, breakEven: null, favorites: [], markets };
}
