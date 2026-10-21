// The prop line archive: DraftKings' player prop lines (and prices, when ESPN
// carries them) for every NBA and NFL game, saved on every capture slot, so
// our own models can later be judged against real lines, opening and closing.
// No free archive of prop lines exists anywhere; this one starts 2026-10-21.
//
// Source: ESPN's core odds API, provider 100 (DraftKings), one propBets list
// per event. Each over/under market comes as two rows with the same athlete,
// type and line; the first row is the over (checked 14 of 14 on 2026-10-21
// against the matching "Points Milestones" price, which repeats the over).
// One-sided markets (First Basket, First TD Scorer, Anytime TD) come as one
// row per player with a price and no line. ESPN also carries its own copy of
// DraftKings' opening number per row; we keep that and our own first and last
// snapshot, so open, current and close are all on file.
//
// Pure: no fetches, no Redis. The store is archive.ts.

export type LinesLeague = "nba" | "nfl";

/** The market types worth keeping, by ESPN's type name. Milestones, quarters and team markets are left out. */
export const ARCHIVE_TYPES: { [l in LinesLeague]: string[] } = {
  nba: [
    "Total Points",
    "Total Rebounds",
    "Total Assists",
    "Total 3-Point Field Goals",
    "Total Points, Rebounds, and Assists",
    "Total Points and Rebounds",
    "Total Points and Assists",
    "Total Assists and Rebounds",
    "Total Steals",
    "Total Blocks",
    "To Record a Double Double",
    "First Basket",
  ],
  nfl: [
    "Total Passing Yards (incl. overtime)",
    "Total Rushing Yards (incl. overtime)",
    "Total Receiving Yards (incl. overtime)",
    "Total Receptions (incl. overtime)",
    "Total Passing Attempts (incl. overtime)",
    "Total Pass Completions (incl. overtime)",
    "Total Carries (incl. overtime)",
    "Total Passing Touchdowns (incl. overtime)",
    "Total Rushing Plus Receiving Yards (incl. overtime)",
    "First Touchdown Scorer",
    "Anytime Touchdown Scorer",
  ],
};

/** One price point: the line (null for a yes-only market), and the over/yes and under prices (null when ESPN has none). */
export interface Quote {
  line: number | null;
  over: number | null;
  under: number | null;
}

export interface PropBetRow {
  type?: { name?: string };
  athlete?: { $ref?: string };
  odds?: { american?: { value?: string; open?: string } } | null;
  current?: { target?: { value?: number } };
  open?: { target?: { value?: number } };
  lastUpdated?: string;
}

export interface LiveLine {
  type: string;
  athlete: string;
  current: Quote;
  /** DraftKings' opening number as ESPN keeps it. */
  dkOpen: Quote;
  updated?: string;
}

/** "+568" to 568, "-113" to -113, "EVEN" to 100. Null when absent or unreadable. */
export function american(s: string | undefined): number | null {
  if (!s) return null;
  if (/^even$/i.test(s.trim())) return 100;
  const v = Number(s.replace(/[^\d.+-]/g, ""));
  return Number.isFinite(v) && Math.abs(v) >= 100 ? v : null;
}

const athleteOf = (r: PropBetRow) => r.athlete?.$ref?.match(/athletes\/(\d+)/)?.[1];
const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);

/** A propBets list read into one entry per (athlete, market type), kept types only. */
export function readPropBets(rows: PropBetRow[], league: LinesLeague): Map<string, LiveLine> {
  const keep = new Set(ARCHIVE_TYPES[league]);
  const groups = new Map<string, PropBetRow[]>();
  for (const r of rows) {
    const type = r.type?.name;
    const a = athleteOf(r);
    if (!type || !a || !keep.has(type)) continue;
    const k = `${a}|${type}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const out = new Map<string, LiveLine>();
  for (const [k, rs] of groups) {
    const [athlete, type] = k.split("|");
    const line = num(rs[0].current?.target?.value);
    const openLine = num(rs[0].open?.target?.value);
    // Two rows with a line: over then under. One row, or no line: a yes-only price.
    const pair = line !== null && rs.length >= 2;
    out.set(k, {
      type,
      athlete,
      current: { line, over: american(rs[0].odds?.american?.value), under: pair ? american(rs[1].odds?.american?.value) : null },
      dkOpen: { line: openLine, over: american(rs[0].odds?.american?.open), under: pair ? american(rs[1].odds?.american?.open) : null },
      ...(rs[0].lastUpdated ? { updated: rs[0].lastUpdated } : {}),
    });
  }
  return out;
}

export interface ArchivedMarket {
  type: string;
  athlete: string;
  dkOpen: Quote;
  /** Our first snapshot, and the latest one. Once the game has started the latest is the close. */
  first: Quote & { at: string };
  last: Quote & { at: string };
}

export interface KalshiQuote {
  name: string;
  bid: number | null;
  ask: number | null;
  last: number | null;
}

export interface ArchivedGame {
  league: LinesLeague;
  season: number;
  event: string;
  away: string;
  home: string;
  tip?: string;
  firstAt: string;
  lastAt: string;
  /** Set on the first capture after the game started: `last` is then the closing line. */
  closedAt?: string;
  markets: { [key: string]: ArchivedMarket };
  /** Kalshi's first TD (NFL) or first basket (NBA) prices: first and latest pregame read. */
  kalshi?: { first: { at: string; players: KalshiQuote[] }; last: { at: string; players: KalshiQuote[] } };
}

const sameQuote = (a: Quote, b: Quote) => a.line === b.line && a.over === b.over && a.under === b.under;

/**
 * Fold one pregame read into the saved game. A market seen for the first time
 * gets its first snapshot now; a known one only moves `last`. Markets that
 * disappear (a scratched player) keep what was saved.
 */
export function mergeLines(
  prev: ArchivedGame | undefined,
  base: Omit<ArchivedGame, "firstAt" | "lastAt" | "markets" | "kalshi" | "closedAt">,
  fresh: Map<string, LiveLine>,
  at: string,
  kalshi?: KalshiQuote[],
): ArchivedGame {
  const markets: { [key: string]: ArchivedMarket } = { ...prev?.markets };
  for (const [k, l] of fresh) {
    const old = markets[k];
    markets[k] = old
      ? { ...old, dkOpen: old.dkOpen.line === null && old.dkOpen.over === null ? l.dkOpen : old.dkOpen, last: sameQuote(old.last, l.current) ? old.last : { ...l.current, at } }
      : { type: l.type, athlete: l.athlete, dkOpen: l.dkOpen, first: { ...l.current, at }, last: { ...l.current, at } };
  }
  const k = kalshi?.length ? { at, players: kalshi } : null;
  return {
    ...base,
    firstAt: prev?.firstAt ?? at,
    lastAt: at,
    markets,
    ...(k || prev?.kalshi ? { kalshi: { first: prev?.kalshi?.first ?? k!, last: k ?? prev!.kalshi!.last } } : {}),
  };
}

/** Close the game: nothing after the start is folded in, so `last` stands as the close. */
export function closeLines(g: ArchivedGame, at: string): ArchivedGame {
  return g.closedAt ? g : { ...g, closedAt: at };
}

/** Counts for the run report and the page: markets, and how many carry prices. */
export function lineCounts(g: ArchivedGame): { markets: number; priced: number; moved: number } {
  const ms = Object.values(g.markets);
  return {
    markets: ms.length,
    priced: ms.filter((m) => m.last.over !== null).length,
    moved: ms.filter((m) => !sameQuote(m.first, m.last)).length,
  };
}
