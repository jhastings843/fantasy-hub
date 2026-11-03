// The fresh pre-lock check on staked props (Jack, 2026-11-02): a staked prop
// is priced from a morning read, and by a night game the price may have moved
// and the edge gone. About an hour before lock, one fresh read per game that
// has a staked prop; each prop is re-judged there by its own section's rule,
// and only a prop that still clears is pushed. Pure; the reads are in fresh.ts.
//
// Timing: a game is due once lock is 75 minutes or less away and more than
// PUSH_CUTOFF_MS off. The pulse runs every 15 minutes, so the read lands 60
// to 75 minutes out; a bet that first qualifies later is read at once.
//
// Re-judging: the board is re-priced at the fresh quote (same line or a moved
// line, new price) with the model's own pricing code (ourNflMarkets,
// ourMarkets, the Anytime TD row's DK price), and the section's collector runs
// again on it. The bet stands only if the collector keeps it there.
//
//   freshDue("19:00Z", 17:50Z) -> true     (70 minutes out)
//   freshVerdict(bet at -110, nothing kept, priced at -150) -> gone, "edge gone at -150"

import { nameKey } from "./grade";
import type { PropMarket, Side } from "./parse";
import { PUSH_CUTOFF_MS, type FreshCheck, type StakedBet } from "./staked-core";
import type { LiveLine } from "@/lib/models/lines";
import { DK_NFL_STAT, ourNflMarkets, type NflMarketExtra } from "@/lib/models/nfl/market";
import { DK_STAT, ourMarkets, type OurMarketExtra } from "@/lib/models/nba/market";
import { ANYTIME_TD, ODDS_MARKET, type OddsRead } from "@/lib/models/nfl/odds-api";
import type { NflParams, NflProjection, NflStat } from "@/lib/models/nfl/props";
import type { NbaParams, NbaStat, Projection } from "@/lib/models/nba/props";
import type { AttdRow } from "@/lib/models/nfl/anytime";

/** The read is due once lock is this close. */
export const FRESH_LEAD_MS = 75 * 60_000;

/** Due for the fresh read: lock 75 minutes or less off and more than 5 minutes off. */
export function freshDue(kickoff: string, now: Date): boolean {
  const ms = Date.parse(kickoff) - now.getTime();
  return ms <= FRESH_LEAD_MS && ms > PUSH_CUTOFF_MS;
}

const etDate = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/New_York" });

/** One read per game per day: the key a game's quote and its claim are kept under. */
export const freshKey = (b: Pick<StakedBet, "sport" | "kickoff"> & { quote?: { event: string } }) => (b.quote ? `${b.sport}|${b.quote.event}|${etDate(b.kickoff)}` : null);

/** What one fresh read must cover for one game. */
export interface FreshGame {
  key: string;
  sport: StakedBet["sport"];
  event: string;
  home: string;
  away: string;
  kickoff: string;
  /** Odds API market keys (NFL) for the game's staked props, sorted; NBA reads ESPN's whole board for free. */
  markets: string[];
}

/** Games due for their fresh read: a staked prop still pending, in the window, and not read today. */
export function freshGames(bets: StakedBet[], now: Date, read: Set<string>): FreshGame[] {
  const out = new Map<string, FreshGame>();
  for (const b of bets) {
    const k = freshKey(b);
    if (!k || !b.quote || b.check?.state !== "pending" || read.has(k) || !freshDue(b.kickoff, now)) continue;
    const g = out.get(k) ?? { key: k, sport: b.sport, event: b.quote.event, home: b.quote.home, away: b.quote.away, kickoff: b.kickoff, markets: [] };
    const m = b.sport === "NFL" ? (b.quote.stat === "anytime" ? ANYTIME_TD : ODDS_MARKET[b.quote.stat as NflStat]) : undefined;
    if (m && !g.markets.includes(m)) g.markets = [...g.markets, m].sort();
    if (Date.parse(b.kickoff) < Date.parse(g.kickoff)) g.kickoff = b.kickoff;
    out.set(k, g);
  }
  return [...out.values()];
}

/** A saved fresh read: The Odds API's for NFL, ESPN's DK feed for NBA, or why there is none. */
export type FreshQuote =
  | { ok: true; at: string; sport: "NFL"; read: OddsRead; markets: string[]; cost?: number }
  | { ok: true; at: string; sport: "NBA"; lines: [string, LiveLine][]; alts: [string, { line: number; over: number }[][]][] }
  | { ok: false; at: string; why: string };

// ------------------------------------------------------------- re-pricing

type Board<X> = { game: { slug: string; markets: PropMarket[] }; extra?: { [id: string]: X } };
const empty = { line: null, over: null, under: null };
const typeOf = (table: { [t: string]: string }, stat: string) => Object.keys(table).find((t) => table[t] === stat);

/**
 * Our NFL board re-priced at a fresh Odds API read: every market the read
 * prices and that has our mean saved, at DK's fresh line and prices, through
 * ourNflMarkets itself. Markets the read doesn't price are left out, so
 * nothing is confirmed at the old price.
 */
export function repriceNfl<B extends Board<NflMarketExtra>>(board: B, read: OddsRead, p: NflParams): B {
  const markets: PropMarket[] = [];
  const extra: { [id: string]: NflMarketExtra } = {};
  for (const m of board.game.markets) {
    const ex = board.extra?.[m.id];
    const type = m.stat ? typeOf(DK_NFL_STAT, m.stat) : undefined;
    const q = m.stat ? read.props[`${nameKey(m.player)}|${m.stat}`] : undefined;
    if (!q || !type || ex?.mean === undefined) continue;
    const r = ourNflMarkets(
      new Map([["x", { type, athlete: "x", current: { line: q.line, over: null, under: null }, dkOpen: empty }]]),
      new Map([["x", { mean: { [m.stat as NflStat]: ex.mean } } as NflProjection]]),
      new Map([["x", { name: m.player, team: m.team }]]),
      () => ({ over: q.over, under: q.under, source: "odds-api" as const }),
      p,
    );
    const nm = r.markets[0];
    if (!nm) continue;
    markets.push(nm);
    extra[nm.id] = { ...ex, ...r.extra[nm.id] };
  }
  return { ...board, game: { ...board.game, markets }, extra };
}

/** Our NBA board re-priced at a fresh ESPN read, through ourMarkets itself (nearest-even line, blend, edge floor). */
export function repriceNba<B extends Board<OurMarketExtra>>(board: B, lines: Map<string, LiveLine>, alts: Map<string, { line: number; over: number }[][]>, p: NbaParams): B {
  const markets: PropMarket[] = [];
  const extra: { [id: string]: OurMarketExtra } = {};
  for (const m of board.game.markets) {
    const ex = board.extra?.[m.id];
    const type = m.stat ? typeOf(DK_STAT, m.stat) : undefined;
    if (!type || !ex?.athlete || ex.mean === undefined) continue;
    const k = `${ex.athlete}|${type}`;
    const l = lines.get(k);
    if (!l) continue;
    const r = ourMarkets(
      new Map([[k, l]]),
      new Map([[ex.athlete, { min: ex.min, mean: { [m.stat as NbaStat]: ex.mean } } as Projection]]),
      new Map([[ex.athlete, { name: m.player, team: m.team }]]),
      p,
      ex.games !== undefined ? new Map([[ex.athlete, ex.games]]) : new Map(),
      alts.has(k) ? new Map([[k, alts.get(k)!]]) : new Map(),
    );
    const nm = r.markets[0];
    if (!nm) continue;
    markets.push(nm);
    extra[nm.id] = { ...ex, ...r.extra[nm.id] };
  }
  return { ...board, game: { ...board.game, markets }, extra };
}

/** An Anytime TD board at the fresh DK price: rows the read prices, nothing else. */
export function repriceAttd<B extends { attd?: { at: string; rows: AttdRow[] } }>(board: B, read: OddsRead): B {
  if (!board.attd) return board;
  const rows = board.attd.rows.flatMap((r) => (read.anytime?.[r.key] !== undefined ? [{ ...r, dk: read.anytime[r.key] }] : []));
  return { ...board, attd: { ...board.attd, rows } };
}

/** The fresh line and price of each priced side, by the collector's line-free id. */
export type Priced = Map<string, { line?: number; price: number | null }>;

/** Our props boards' fresh prices, keyed as ourPropsStaked keys its bets. */
export function pricedProps(section: string, boards: Board<unknown>[]): Priced {
  const out: Priced = new Map();
  for (const b of boards)
    for (const m of b.game.markets)
      for (const side of ["over", "under"] as Side[]) {
        const bk = m.books[0];
        if (bk) out.set(`${section}|${b.game.slug}|${m.id}|${side}`, { line: bk.line, price: bk[side] });
      }
  return out;
}

/** Anytime TD boards' fresh prices, keyed as attdStakedBets keys its bets. */
export function pricedAttd(section: string, boards: { game: { slug: string }; attd?: { rows: AttdRow[] } }[]): Priced {
  const out: Priced = new Map();
  for (const b of boards) for (const r of b.attd?.rows ?? []) out.set(`${section}|${b.game.slug}|${r.key}`, { price: r.dk ?? null });
  return out;
}

// --------------------------------------------------------------- verdicts

const am = (p: number) => (p > 0 ? `+${p}` : `${p}`);

/**
 * One staked prop against its fresh quote. `fresh` is the same bet as the
 * collector gives it on the re-priced board (undefined: it no longer keeps
 * it); `priced` is the fresh line and price of its side (null: not in the read).
 *
 *   no quote yet               -> pending
 *   quote failed               -> failed, its reason
 *   not in the read            -> failed, "not in the fresh read"
 *   still kept                 -> checked, at the fresh line and price
 *   not kept, same line        -> gone, "edge gone at -150"
 *   not kept, line moved       -> gone, "line moved 27.5 to 29.5, no edge at -110"
 */
export function freshVerdict(bet: StakedBet, q: FreshQuote | undefined, fresh: StakedBet | undefined, priced: { line?: number; price: number | null } | undefined): StakedBet {
  const set = (check: FreshCheck): StakedBet => ({ ...bet, check });
  if (!q) return set({ state: "pending" });
  if (!q.ok) return set({ state: "failed", at: q.at, note: `no fresh price (${q.why})` });
  if (!priced || priced.price === null) return set({ state: "failed", at: q.at, note: "not in the fresh read" });
  if (fresh) {
    return { ...bet, pick: fresh.pick, line: fresh.line, price: fresh.price, book: fresh.book, priceText: fresh.priceText, check: { state: "checked", at: q.at } };
  }
  const moved = priced.line !== undefined && bet.line !== undefined && priced.line !== bet.line;
  return set({ state: "gone", at: q.at, note: moved ? `line moved ${bet.line} to ${priced.line}, no edge at ${am(priced.price)}` : `edge gone at ${am(priced.price)}` });
}

/**
 * Today's staked bets with the fresh check laid on. Bets without a quote
 * target are props this check can't re-judge (state none) or NBA picks
 * (left alone).
 */
export function applyFresh(bets: StakedBet[], quotes: Map<string, FreshQuote>, fresh: StakedBet[], priced: Priced): StakedBet[] {
  const byId = new Map(fresh.map((b) => [b.src ?? b.id, b]));
  return bets.map((b) => {
    const k = freshKey(b);
    if (!k) return b.section === "nba-picks" ? b : { ...b, check: { state: "none" } };
    const src = b.src ?? b.id;
    return freshVerdict(b, quotes.get(k), byId.get(src), priced.get(src));
  });
}
