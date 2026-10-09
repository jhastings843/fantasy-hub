// The live report: the slow model-history core plus fresh quotes. Pure.
//
// Building the core (both sites' boards and records, the backtest, research,
// closing lines) is slow and changes a few times a day, so it is cached for
// three hours. Quotes, kickoffs and exposure change by the minute, so they
// are applied here on every read: a cached core can never make a game look
// bettable after its kickoff, a stale quote is shown as stale rather than
// offered, and every stake is allocated against what has already been
// issued.

import { finishedResults } from "./finished";
import type { League, ModelLine } from "./parse";
import type { ClosingLine } from "./closing";
import { summarize, type ClvRow } from "./closing";
import { allocate, type Allocation, type Exposure } from "./allocate";
import { BASELINE_POLICY, type PicksPolicy } from "./policy";
import { type IssuedRecord, type IssuedWeek, confirmed, gradeIssued, issuedClv } from "./issued";
import { type UnitReport, unitReport } from "./units";
import { firstSends } from "./update";
import { heldUntil } from "./hold";
import { kelly, shrunk, stakeFor, wantStakes } from "./staking";
import type { PemCompareRow, ResearchRow } from "./research";
import { type TotalsBacktest, type TotalsBoardGame, totalsBoard } from "./totals";
import {
  type BoardGame,
  type GradedGame,
  type PemLine,
  type RefLine,
  type StrategyBoard,
  type SuRecord,
  key,
  matches,
  tierBoard,
} from "./engine";

/** Quotes older than this are shown but not offered. */
export const QUOTE_MAX_AGE_MIN = 90;

export interface CoreRow {
  home: string;
  away: string;
  sam?: ModelLine;
  david?: ModelLine;
  pem?: PemLine;
  samTotal?: number;
  davidTotal?: number;
}

/** Everything slow, cached for hours. */
export interface PicksCore {
  league: League;
  season: number;
  week: number | null;
  generatedAt: string;
  boardUpdated: { sam: boolean; david: boolean };
  /** The calendar week has turned over and neither site has posted it yet. */
  awaiting?: boolean;
  weeksCovered: number[];
  graded: GradedGame[];
  strategies: StrategyBoard;
  su: { methods: SuRecord[]; bands: SuRecord[]; best: SuRecord | null };
  rows: CoreRow[];
  notes: string[];
  errors: string[];
  pem: { week: number; verified: boolean; games: number; source: string }[];
  names: { [key: string]: string };
  clvModels: ClvRow[];
  research: ResearchRow[];
  pemCompare: { rows: PemCompareRow[]; games: number; weeks: number[] } | null;
  totalsBacktest: TotalsBacktest;
  totalsEdge: number;
  totalsArchived: number;
  posted: { [source: string]: string };
  finals: [string, { home: number; away: number }][];
  closes: [string, ClosingLine][];
  /** The policy the core's strategies were built under. */
  policyId: string;
}

export interface Quotes {
  fetchedAt: string | null;
  lines: [string, RefLine][];
  problem?: string;
}

export interface PicksReport extends Omit<PicksCore, "rows" | "finals" | "closes" | "clvModels" | "totalsBacktest" | "totalsEdge" | "totalsArchived"> {
  board: BoardGame[];
  live: IssuedWeek[];
  clv: { models: ClvRow[]; plays: ClvRow[]; games: number; matched: number };
  reference: {
    source: string | null;
    fetchedAt: string | null;
    priced: number;
    games: number;
    problem?: string;
    /** The quotes are older than QUOTE_MAX_AGE_MIN: shown, not offered. */
    stale: boolean;
    started: number;
  };
  totals: { backtest: TotalsBacktest; board: TotalsBoardGame[]; edge: number; archived: number };
  units: UnitReport;
  /** What the limits did to this week's wants. */
  allocation: Pick<Allocation, "room" | "used" | "deferred"> & { exposure: Omit<Exposure, "perGame"> };
  policy: { id: string; summary: string };
  composedAt: string;
}

export interface ComposeInput {
  core: PicksCore;
  quotes: Quotes;
  /** This sport's issued records, this season. */
  issued: IssuedRecord[];
  exposure: Exposure;
  policy?: PicksPolicy;
  now?: Date;
}

export function compose({ core, quotes, issued, exposure, policy = BASELINE_POLICY, now = new Date() }: ComposeInput): PicksReport {
  const nowMs = now.getTime();
  const ageMin = quotes.fetchedAt ? (nowMs - new Date(quotes.fetchedAt).getTime()) / 60000 : Infinity;
  const stale = quotes.fetchedAt !== null && ageMin > QUOTE_MAX_AGE_MIN;
  const lines = new Map(quotes.lines);
  const week = core.week;
  let started = 0;
  const coreFinals = new Map(core.finals);
  const refOf = (home: string, away: string): { ref?: RefLine; started?: boolean } => {
    if (!week) return {};
    const ref = lines.get(key({ week, home, away }));
    // A final counts as kicked off even after ESPN drops the game's line.
    if (coreFinals.has(key({ week, home, away })) || (ref?.kickoff && new Date(ref.kickoff).getTime() <= nowMs)) {
      started++;
      return { started: true };
    }
    return stale ? {} : { ref };
  };
  const withRefs = core.rows.map((r) => ({ ...r, ...refOf(r.home, r.away) }));
  const s = core.strategies;
  const tiered = tierBoard(core.league, withRefs, s, core.su.best?.id ?? "avg");
  const wanted = wantStakes(tiered, { t1: s.rule?.record, t2: s.second?.record }, policy.staking);

  // Totals at the same quotes.
  const tb = core.totalsBacktest;
  const tWanted = totalsBoard(
    withRefs.map((r) => ({
      home: r.home,
      away: r.away,
      sam: r.samTotal,
      david: r.davidTotal,
      ref:
        r.ref?.total !== undefined
          ? { total: r.ref.total, source: r.ref.source, fetchedAt: r.ref.fetchedAt, overPrice: r.ref.overPrice, underPrice: r.ref.underPrice, kickoff: r.ref.kickoff }
          : undefined,
    })),
    tb.rule,
  ).map((g) => {
    if (g.tier !== "t1" || !tb.rule || !g.side || !g.ref) return g;
    const p = shrunk(tb.rule.record.w, tb.rule.record.l, policy.staking.priorGames);
    const quoted = g.side === "over" ? g.ref.overPrice : g.ref.underPrice;
    if (quoted === undefined) return { ...g, p, priceSource: "missing" as const, want: 0 };
    return { ...g, p, price: quoted, priceSource: "quoted" as const, want: stakeFor(p, quoted, policy.staking) };
  });

  // One allocation for spreads and totals together. Games already issued
  // this week (any send) are not candidates again: their stake is already in
  // the exposure, and re-allocating them would crowd out new qualifiers.
  const gk = (g: { home: string; away: string }) => (week ? key({ week, home: g.home, away: g.away }) : `${g.away}@${g.home}`);
  const thisWeek = issued.filter((r) => r.week === week && r.status !== "unconfirmed");
  const issuedAts = new Map(
    thisWeek.flatMap((r) => r.plays.filter((p) => p.shownInEmail && p.units).map((p) => [gk(p), { units: p.units!, price: p.price, homeLine: p.homeLine, side: p.side }] as const)),
  );
  const issuedOu = new Map(
    thisWeek.flatMap((r) => (r.totals ?? []).filter((p) => p.shownInEmail && p.units).map((p) => [gk(p), { units: p.units!, price: p.price, line: p.line, side: p.side }] as const)),
  );
  // Held games (before 9am ET on their game day, hold.ts) are early looks.
  // They are still allocated, by edge, so their stake is a reservation: a
  // thinner earlier game can't take room a stronger later one needs. They are
  // never issued until released.
  const held = (g: { ref?: { kickoff?: string } }) => heldUntil(core.league, g.ref?.kickoff, now);
  const alloc = allocate(
    [
      ...wanted.flatMap((g) =>
        g.want && g.p !== undefined && g.price !== undefined && !issuedAts.has(gk(g))
          ? [{ id: `ats:${gk(g)}`, game: gk(g), want: g.want, priority: kelly(g.p, g.price) }]
          : [],
      ),
      ...tWanted.flatMap((g) =>
        "want" in g && g.want && g.p !== undefined && g.price !== undefined && !issuedOu.has(gk(g))
          ? [{ id: `ou:${gk(g)}`, game: gk(g), want: g.want, priority: kelly(g.p, g.price) }]
          : [],
      ),
    ],
    exposure,
  );
  const closesAll = new Map(core.closes);
  const board: BoardGame[] = wanted.map((g) => {
    const out: BoardGame = {
      ...g,
      stake: alloc.stakes.get(`ats:${gk(g)}`) ?? (g.want !== undefined ? 0 : undefined),
      ...(issuedAts.has(gk(g)) ? { issued: issuedAts.get(gk(g)) } : held(g) ? { held: held(g)! } : {}),
    };
    const final = coreFinals.get(gk(g));
    if (!final) return out;
    const c = closesAll.get(gk(g));
    return {
      ...out,
      final,
      results: finishedResults(out, final),
      cuts: out.read ? s.cuts.filter((cut) => matches(out.read!, cut.test)).map((cut) => cut.id) : [],
      ...(c ? { close: { open: c.open, close: c.close, totalOpen: c.totalOpen, totalClose: c.totalClose } } : {}),
    };
  });
  const totalsBoardOut: TotalsBoardGame[] = tWanted.map((g) => ({
    ...g,
    ...("want" in g && g.want !== undefined ? { stake: alloc.stakes.get(`ou:${gk(g)}`) ?? 0 } : {}),
    ...(issuedOu.has(gk(g)) ? { issued: issuedOu.get(gk(g)) } : held(g) ? { held: held(g)! } : {}),
  }));

  const finals = new Map(core.finals);
  const closes = new Map(core.closes);
  const sent = issuedClv(issued, closes);
  const priced = board.filter((g) => g.basis === "reference");
  const { rows: _rows, finals: _f, closes: _c, clvModels, totalsBacktest, totalsEdge, totalsArchived, ...rest } = core;
  void _rows;
  void _f;
  void _c;
  return {
    ...rest,
    board,
    live: gradeIssued(issued, finals),
    clv: {
      models: clvModels,
      plays: [
        summarize("t1", "Tier 1 as sent", sent.t1),
        summarize("t2", "Tier 2 as sent", sent.t2),
        summarize("ou", "Totals as sent (vs closing total)", sent.totals),
      ],
      games: core.graded.length,
      matched: core.graded.filter((g) => closes.get(key(g))?.close != null).length,
    },
    reference: {
      source: priced[0]?.ref?.source ?? null,
      fetchedAt: quotes.fetchedAt,
      priced: priced.length,
      games: board.length,
      problem: quotes.problem,
      stale,
      started,
    },
    totals: { backtest: totalsBacktest, board: totalsBoardOut, edge: totalsEdge, archived: totalsArchived },
    units: unitReport(firstSends(confirmed(issued)), finals),
    allocation: {
      room: alloc.room,
      used: alloc.used,
      deferred: alloc.deferred,
      exposure: { weekly: exposure.weekly, outstanding: exposure.outstanding, reserved: exposure.reserved },
    },
    policy: { id: policy.id, summary: policy.summary },
    composedAt: now.toISOString(),
  };
}

/**
 * What is already on the books: this sport's issued stakes this week (every
 * slot), everything issued and unsettled across both sports, and per game.
 * Only bets the emails showed, with a stake, count.
 */
export function exposureFrom(
  league: League,
  week: number | null,
  issuedBySport: { league: League; records: IssuedRecord[] }[],
  settled: Set<string>,
): Exposure {
  let weekly = 0;
  let outstanding = 0;
  const perGame = new Map<string, number>();
  for (const { league: lg, records } of issuedBySport) {
    for (const rec of firstSends(records)) {
      const bets = [
        ...rec.plays.filter((p) => p.shownInEmail && p.units).map((p) => ({ home: p.home, away: p.away, units: p.units! })),
        ...(rec.totals ?? []).filter((p) => p.shownInEmail && p.units).map((p) => ({ home: p.home, away: p.away, units: p.units! })),
      ];
      for (const b of bets) {
        const k = key({ week: rec.week, home: b.home, away: b.away });
        if (!settled.has(`${lg}:${k}`)) outstanding += b.units;
        if (lg === league && rec.week === week) {
          weekly += b.units;
          perGame.set(k, (perGame.get(k) ?? 0) + b.units);
        }
      }
    }
  }
  return { weekly, outstanding, perGame };
}
