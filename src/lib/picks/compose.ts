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
import { allocate, type Allocation, type Candidate, type Exposure } from "./allocate";
import { BASELINE_POLICY, sourceState, type PicksPolicy } from "./policy";
import { type IssuedRecord, type IssuedWeek, confirmed, gradeIssued, issuedClv } from "./issued";
import { type UnitReport, unitReport } from "./units";
import { firstSends } from "./update";
import { heldUntil } from "./hold";
import type { PriceShadow } from "./price-shadow";
import { kelly, shrunk, sizeAt, wantStakes } from "./staking";
import { type CandidateInfo, type DecisionRecord, type SizingCandidate, recentKeys } from "./learning/replay";
import type { PemCompareRow, ResearchRow } from "./research";
import { type TotalsBacktest, type TotalsBoardGame, totalsBoard } from "./totals";
import {
  type BoardGame,
  type GradedGame,
  type OursRead,
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
  /** John Harris's sheet line, home side (college, verified sheets only). */
  harris?: number;
  samTotal?: number;
  davidTotal?: number;
  /** Our own model's latest saved read on this game (tracked only; straight up and totals use it once promoted). */
  ours?: OursRead;
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
  /** Tracked only: every tier pick at -115 or better, bet or not (price-shadow.ts). */
  priceShadow?: PriceShadow;
  /** When this week's rule was frozen (the Tuesday review), or null while it is provisional. */
  ruleSet?: { at: string; throughWeek: number | null } | null;
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
  allocation: Pick<Allocation, "room" | "used" | "deferred"> & {
    /** Units of the shared weekly budget set aside for the other sport's held plays. */
    rivalHeld: number;
    exposure: Omit<Exposure, "perGame">;
  };
  policy: { id: string; summary: string; staking?: PicksPolicy["staking"] };
  /**
   * What the allocator decided over, for the sizing replay (learning/replay.ts):
   * every eligible, priced, not-yet-bet pick (held ones too) and the other
   * sport's held rivals, with the exposure it saw and the stakes it set. A
   * send records it as a decision; `issuable` is the send's to set.
   */
  sizing: {
    candidates: Omit<SizingCandidate, "issuable">[];
    exposure: DecisionRecord["exposure"];
    live: { [id: string]: number };
    settled: string[];
    /** "league:key" of this sport's recent games final in the core. */
    finals: string[];
  };
  composedAt: string;
}

/** An allocator candidate with what the sizing replay needs to resize it. */
export type SizedCandidate = Candidate & { info?: CandidateInfo };

export interface ComposeInput {
  core: PicksCore;
  quotes: Quotes;
  /** This sport's issued records, this season. */
  issued: IssuedRecord[];
  exposure: Exposure;
  policy?: PicksPolicy;
  now?: Date;
  /**
   * The other sport's plays held for a later game day (heldCandidates). They
   * compete for the shared weekly budget by edge, so this sport can't take
   * room a stronger held play needs; their stakes are not part of this board.
   */
  rivals?: SizedCandidate[];
  /** "league:key" the exposure counted as settled (recorded with a send's decision). */
  settled?: string[];
}

export function compose({ core, quotes, issued, exposure, policy = BASELINE_POLICY, now = new Date(), rivals = [], settled = [] }: ComposeInput): PicksReport {
  const nowMs = now.getTime();
  const ageMin = quotes.fetchedAt ? (nowMs - new Date(quotes.fetchedAt).getTime()) / 60000 : Infinity;
  const stale = quotes.fetchedAt !== null && ageMin > QUOTE_MAX_AGE_MIN;
  const lines = new Map(quotes.lines);
  const week = core.week;
  let started = 0;
  const coreFinals = new Map(core.finals);
  const refOf = (home: string, away: string): { ref?: RefLine; lastRef?: RefLine; started?: boolean } => {
    if (!week) return {};
    const ref = lines.get(key({ week, home, away }));
    // A final counts as kicked off even after ESPN drops the game's line.
    if (coreFinals.has(key({ week, home, away })) || (ref?.kickoff && new Date(ref.kickoff).getTime() <= nowMs)) {
      started++;
      // Never a quote to bet at, but the read stays at the last line it was
      // judged at; the sites' own numbers can be days old (Week 9 WKU: Sam's
      // +2.5 against DraftKings' -1.5 doubled the edge at kickoff).
      return ref ? { started: true, lastRef: ref } : { started: true };
    }
    return stale ? {} : { ref };
  };
  const withRefs = core.rows.map((r) => ({ ...r, ...refOf(r.home, r.away) }));
  const s = core.strategies;
  const veto = core.league === "cfb" ? { pem: sourceState(policy, "pem") === "veto", harris: sourceState(policy, "harris") === "veto" } : {};
  const tiered = tierBoard(core.league, withRefs, s, core.su.best?.id ?? "avg", veto);
  const tierRec = (c: { record: { w: number; l: number }; activated?: boolean } | null) =>
    c ? { w: c.record.w, l: c.record.l, activated: c.activated } : undefined;
  const wanted = wantStakes(tiered, { t1: tierRec(s.rule), t2: tierRec(s.second) }, policy.staking);

  // Totals at the same quotes.
  const tb = core.totalsBacktest;
  const tWanted = totalsBoard(
    withRefs.map((r) => ({
      home: r.home,
      away: r.away,
      sam: r.samTotal,
      david: r.davidTotal,
      ours: r.ours?.total,
      ref:
        r.ref?.total !== undefined
          ? { total: r.ref.total, source: r.ref.source, fetchedAt: r.ref.fetchedAt, overPrice: r.ref.overPrice, underPrice: r.ref.underPrice, kickoff: r.ref.kickoff, ...(r.ref.shop ? { shop: { over: r.ref.shop.over, under: r.ref.shop.under } } : {}) }
          : undefined,
    })),
    tb.rule,
  ).map((g) => {
    if (g.tier !== "t1" || !tb.rule || !g.side || !g.ref) return g;
    const quoted = g.side === "over" ? g.ref.overPrice : g.ref.underPrice;
    if (quoted === undefined) return { ...g, p: shrunk(tb.rule.record.w, tb.rule.record.l, policy.staking.priorGames), eligible: false, priceSource: "missing" as const, want: 0 };
    return { ...g, ...sizeAt(tb.rule.record, quoted, policy.staking), price: quoted, priceSource: "quoted" as const };
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
  // For the sizing replay: every eligible, priced pick not already bet, with
  // what a replay needs to resize it under another policy.
  const own: SizedCandidate[] = week
    ? [
        ...wanted.flatMap((g) => {
          const rec = g.tier === "t1" ? tierRec(s.rule) : g.tier === "t2" ? tierRec(s.second) : undefined;
          return g.eligible && rec && g.p !== undefined && g.price !== undefined && g.side && g.homeLine !== undefined && !issuedAts.has(gk(g))
            ? [{ id: `ats:${gk(g)}`, game: gk(g), want: g.want ?? 0, priority: 0, info: { league: core.league, week, key: gk(g), kind: "ats" as const, side: g.side, line: g.homeLine, price: g.price, rec, eligible: true, kickoff: g.ref?.kickoff, held: !!held(g) } }]
            : [];
        }),
        ...tWanted.flatMap((g) =>
          "eligible" in g && g.eligible && tb.rule && g.p !== undefined && g.price !== undefined && g.side && g.line !== undefined && !issuedOu.has(gk(g))
            ? [{ id: `ou:${gk(g)}`, game: gk(g), want: g.want ?? 0, priority: 0, info: { league: core.league, week, key: gk(g), kind: "ou" as const, side: g.side, line: g.line, price: g.price, rec: { w: tb.rule.record.w, l: tb.rule.record.l }, eligible: true, kickoff: g.ref?.kickoff, held: !!held(g) } }]
            : [],
        ),
      ]
    : [];
  // The allocator's input is unchanged by the record above.
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
      ...rivals.filter((c) => c.want > 0).map(({ id, game, want, priority }) => ({ id, game, want, priority })),
    ],
    exposure,
  );
  const rivalIds = new Set(rivals.map((c) => c.id));
  // Why a stake came out under its want: the limit that cut it, for the card.
  const limitedBy = new Map([...alloc.deferred, ...alloc.reduced].map((d) => [d.id, d.reason]));
  const rivalHeld = [...alloc.stakes].reduce((t, [id, u]) => t + (rivalIds.has(id) ? u : 0), 0);
  const closesAll = new Map(core.closes);
  const board: BoardGame[] = wanted.map((g) => {
    const out: BoardGame = {
      ...g,
      stake: alloc.stakes.get(`ats:${gk(g)}`) ?? (g.want !== undefined ? 0 : undefined),
      ...(limitedBy.has(`ats:${gk(g)}`) ? { limited: limitedBy.get(`ats:${gk(g)}`) } : {}),
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
    ...(limitedBy.has(`ou:${gk(g)}`) ? { limited: limitedBy.get(`ou:${gk(g)}`) } : {}),
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
      used: alloc.used - rivalHeld,
      rivalHeld,
      deferred: alloc.deferred.filter((d) => !rivalIds.has(d.id)),
      exposure: { weekly: exposure.weekly, outstanding: exposure.outstanding, reserved: exposure.reserved },
    },
    policy: { id: policy.id, summary: policy.summary, staking: policy.staking },
    sizing: {
      candidates: [
        ...own.flatMap(({ id, game, info }) => (info ? [{ ...info, id, game, rival: false }] : [])),
        ...rivals.flatMap(({ id, game, info }) => (info ? [{ ...info, id, game, rival: true }] : [])),
      ],
      exposure: { weekly: exposure.weekly, outstanding: exposure.outstanding, reserved: exposure.reserved ?? 0, perGame: [...exposure.perGame] },
      live: Object.fromEntries(alloc.stakes),
      settled,
      finals: recentKeys(core.finals.map(([k]) => `${core.league}:${k}`), week),
    },
    composedAt: now.toISOString(),
  };
}

/**
 * What is already on the books: both sports' issued stakes this calendar week
 * (every slot), everything issued and unsettled across both sports, and this
 * sport's per game.
 * Only bets the emails showed, with a stake, count.
 */
/** College week numbers run one ahead of the NFL's in the same calendar week. */
const WEEK_OFFSET: { [k in League]: number } = { nfl: 0, cfb: 1 };

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
        // One weekly budget for both sports. College weeks run one ahead of
        // the NFL's in the same calendar week (parse.ts weekOf).
        if (week !== null && rec.week === week + WEEK_OFFSET[lg] - WEEK_OFFSET[league]) weekly += b.units;
        if (lg === league && rec.week === week) perGame.set(k, (perGame.get(k) ?? 0) + b.units);
      }
    }
  }
  return { weekly, outstanding, perGame };
}

/**
 * A report's plays held for a later game day, as allocation candidates for
 * the other sport's board (ids and games namespaced so they never collide).
 */
export function heldCandidates(league: League, r: PicksReport): SizedCandidate[] {
  const k = (g: { home: string; away: string }) => `${league}:${g.away}@${g.home}`;
  type G = { home: string; away: string; held?: string; want?: number; eligible?: boolean; p?: number; price?: number; issued?: unknown; side?: CandidateInfo["side"]; ref?: { kickoff?: string } };
  const one = (kind: "ats" | "ou", g: G, line: number | undefined, rec: { w: number; l: number; activated?: boolean } | undefined): SizedCandidate[] =>
    // Eligible held plays, including ones this policy sizes under 1u (recorded
    // for the sizing replay; compose passes only the 1u+ ones to the allocator).
    g.held && !g.issued && (g.want || g.eligible) && g.p !== undefined && g.price !== undefined
      ? [{
          id: `rival:${kind}:${k(g)}`,
          game: `rival:${k(g)}`,
          want: g.want ?? 0,
          priority: kelly(g.p, g.price),
          // Only when the replay can resize it faithfully; otherwise the decision records it as missing.
          ...(r.week && rec && g.side && line !== undefined
            ? { info: { league, week: r.week, key: key({ week: r.week, home: g.home, away: g.away }), kind, side: g.side, line, price: g.price, rec, eligible: true, kickoff: g.ref?.kickoff, held: true } }
            : {}),
        }]
      : [];
  const rec = (c: { record: { w: number; l: number }; activated?: boolean } | null) => (c ? { w: c.record.w, l: c.record.l, activated: c.activated } : undefined);
  const totalsRec = r.totals.backtest.rule ? { w: r.totals.backtest.rule.record.w, l: r.totals.backtest.rule.record.l } : undefined;
  return [
    ...r.board.flatMap((g) => one("ats", g, g.homeLine, g.tier === "t1" ? rec(r.strategies.rule) : g.tier === "t2" ? rec(r.strategies.second) : undefined)),
    ...r.totals.board.flatMap((g) => one("ou", g as G, g.line, totalsRec)),
  ];
}
