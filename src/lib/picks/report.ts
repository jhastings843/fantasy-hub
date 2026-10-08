import "server-only";
import { redis } from "@/lib/redis/client";
import { cachedWithFallback } from "@/lib/redis/cached";
import {
  type Board,
  type ModelLine,
  type GradedRow,
  type League,
  parseDavidBoard,
  parseSamBoard,
  parseSamRecord,
  parseSheetTabs,
  parseSheetWeek,
  weekOf,
} from "./parse";
import { pemWeeks } from "./pem";
import { type ClvRow, clvTable, summarize } from "./closing";
import { closingLines, currentLines } from "./closing-store";
import { type IssuedWeek, gradeIssued, issuedClv, issuedGames } from "./issued";
import { type UnitReport, unitReport } from "./units";
import { firstSends } from "./update";
import { loadIssued } from "./issued-store";
import { type PemCompareRow, type ResearchRow, pemCompare, researchRows } from "./research";
import { type TotalsBacktest, type TotalsBoardGame, type TotalsSeen, TOTALS_EDGE, totalsBacktest, totalsBoard } from "./totals";
import { archiveTotals, loadTotalsSeen } from "./totals-store";
import type { PemWeek } from "./pem-card";
import {
  type BoardGame,
  type PemLine,
  type RefLine,
  gradeGame,
  type GradedGame,
  type StrategyBoard,
  type SuRecord,
  join,
  key,
  matches,
  strategies,
  suRecords,
  tierBoard,
} from "./engine";

// The Picks tab's data: both models' records joined, the strategies ranked,
// and this week's board tiered by whichever strategy is winning.
//
// Two things are kept in Redis beyond the usual cache, and neither expires:
//
//   Every graded row either site has ever shown. The record pages are the
//   history, and if either one starts trimming old games the backtest would
//   quietly shrink. Merging into a store means it can only grow.
//
//   Each week's board as it last stood (research history). It follows the
//   live board and is NOT the record of what was sent: that is the issued
//   record (issued.ts), written once from the email's own selection. Two
//   snapshots from before issued records existed (NFL Week 5, college Week 6)
//   carry frozen: true; they are kept as they are and graded nowhere.

export const SOURCES = {
  nfl: {
    samBoard: "https://samthemodelman.smmodel.workers.dev/nfl/",
    samRecord: "https://samthemodelman.smmodel.workers.dev/nfl/record.html",
    davidBoard: "https://davidsasser.com/nfl",
  },
  cfb: {
    samBoard: "https://samthemodelman.smmodel.workers.dev/ncaaf/",
    samRecord: "https://samthemodelman.smmodel.workers.dev/ncaaf/record.html",
    davidBoard: "https://davidsasser.com/cfb",
  },
} as const;

const UA = { "user-agent": "fantasy-hub/1.0 (personal fantasy football tool)" };

async function get(url: string): Promise<string> {
  const res = await fetch(url, { cache: "no-store", headers: UA, signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
  return res.text();
}

/** David's history sheet id, read off his board page's "Model history" link. */
function sheetId(boardHtml: string): string | null {
  return boardHtml.match(/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]+)/)?.[1] ?? null;
}

async function davidHistory(league: League, boardHtml: string): Promise<GradedRow[]> {
  const id = sheetId(boardHtml);
  if (!id) throw new Error("David's page no longer links a history sheet");
  const tabs = parseSheetTabs(await get(`https://docs.google.com/spreadsheets/d/${id}/htmlview`));
  const weeks = await Promise.all(
    tabs.map(async (t) =>
      parseSheetWeek(league, t.week, await get(`https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${t.gid}`)),
    ),
  );
  return weeks.flat();
}

// ----------------------------------------------------------------- archives

const archiveKey = (league: League, who: "sam" | "david") => `picks:v1:${league}:rows:${who}`;

/** Merges this fetch into everything seen before; the newest copy of a game wins. */
async function archive(league: League, who: "sam" | "david", rows: GradedRow[]): Promise<GradedRow[]> {
  let stored: GradedRow[] = [];
  try {
    stored = (await redis.get<GradedRow[]>(archiveKey(league, who))) ?? [];
  } catch {
    return rows;
  }
  const merged = new Map(stored.map((r) => [key(r), r]));
  for (const r of rows) merged.set(key(r), r);
  const all = [...merged.values()];
  if (all.length !== stored.length || rows.length) {
    await redis.set(archiveKey(league, who), all).catch(() => {});
  }
  return all;
}

export interface FrozenPlay {
  home: string;
  away: string;
  tier: BoardGame["tier"];
  side?: "home" | "away";
  /** Home-side line the play was made at. */
  homeLine?: number;
  play: string;
  suSide?: "home" | "away";
  /** Legacy snapshots: "lock" | "solid" | "toss" from the models' average. */
  suConfidence?: string;
  /** Newer snapshots: the selected straight-up method and its margin band. */
  suMethod?: string;
  suBand?: string;
  basis?: BoardGame["basis"];
  ref?: RefLine;
}

export interface Snapshot {
  week: number;
  season: number;
  frozen: boolean;
  at: string;
  rule: string | null;
  plays: FrozenPlay[];
}

const snapKey = (league: League, season: number, week: number) => `picks:v1:${league}:snap:${season}:w${week}`;
const snapIndex = (league: League, season: number) => `picks:v1:${league}:snaps:${season}`;

function toPlays(board: BoardGame[]): FrozenPlay[] {
  return board.map((g) => ({
    home: g.home,
    away: g.away,
    tier: g.tier,
    side: g.side,
    homeLine: g.homeLine,
    play: g.play,
    suSide: g.su?.side,
    suMethod: g.su?.method,
    suBand: g.su?.band,
    basis: g.basis,
    ref: g.ref,
  }));
}

async function saveSnapshot(league: League, season: number, week: number, board: BoardGame[], rule: string | null) {
  try {
    const existing = await redis.get<Snapshot>(snapKey(league, season, week));
    if (existing?.frozen) return;
    const snap: Snapshot = { week, season, frozen: false, at: new Date().toISOString(), rule, plays: toPlays(board) };
    await redis.set(snapKey(league, season, week), snap);
    await redis.sadd(snapIndex(league, season), week);
  } catch {
    /* A missed snapshot costs one week of the live record, not the page. */
  }
}

// ------------------------------------------------------------- posting log

/**
 * When each source first showed this week's board, as this app saw it (to
 * within the report refresh, up to three hours outside the Tuesday send
 * window). Kept so the send schedule can be checked against
 * real posting times over a season rather than one week's observation.
 */
async function notePosted(
  league: League,
  season: number,
  week: number,
  sam: boolean,
  david: boolean,
  pem: boolean,
): Promise<{ [source: string]: string }> {
  const k = `picks:v1:${league}:posted:${season}:w${week}`;
  const now = new Date().toISOString();
  try {
    await Promise.all([
      sam ? redis.hsetnx(k, "sam", now) : null,
      david ? redis.hsetnx(k, "david", now) : null,
      pem ? redis.hsetnx(k, "pem", now) : null,
    ]);
    return ((await redis.hgetall<{ [source: string]: string }>(k)) ?? {}) as { [source: string]: string };
  } catch {
    return {};
  }
}

// ------------------------------------------------------------------ report

export interface PicksReport {
  league: League;
  season: number;
  week: number | null;
  generatedAt: string;
  boardUpdated: { sam: boolean; david: boolean };
  weeksCovered: number[];
  graded: GradedGame[];
  strategies: StrategyBoard;
  su: { methods: SuRecord[]; bands: SuRecord[]; best: SuRecord | null };
  board: BoardGame[];
  /** The issued record: what each picks email actually sent (Tuesday card plus game-day additions), graded. */
  live: IssuedWeek[];
  notes: string[];
  errors: string[];
  /** PEM weeks on file (college), and whether each checked out. */
  pem: { week: number; verified: boolean; games: number; source: string }[];
  /** Team key to the name a site printed, for display. NFL keys map to themselves. */
  names: { [key: string]: string };
  /** Closing-line value: each model and the rule over the record, and the plays as sent. */
  clv: { models: ClvRow[]; plays: ClvRow[]; games: number; matched: number };
  /** Research refinements next to their parents (never eligible to be the rule). */
  research: ResearchRow[];
  /** College: PEM's contribution on the games all three cover, one common line. */
  pemCompare: { rows: PemCompareRow[]; games: number; weeks: number[] } | null;
  /** Where this week's reference line came from, and how many board games have one. */
  reference: { source: string | null; fetchedAt: string | null; priced: number; games: number; problem?: string };
  /** Over/under: Sam-alone history, the forward agreement archive, and this week at one current total. */
  totals: { backtest: TotalsBacktest; board: TotalsBoardGame[]; edge: number; newlyArchived: number; archived: number };
  /** When each source's board for this week was first seen here (ISO). */
  posted: { [source: string]: string };
  /** The bets the emails gave, with stakes: units +/- for this sport. */
  units: UnitReport;
}

function seasonNow(): number {
  const d = new Date();
  return d.getUTCMonth() <= 1 ? d.getUTCFullYear() - 1 : d.getUTCFullYear();
}

export async function buildPicksReport(league: League): Promise<PicksReport> {
  const src = SOURCES[league];
  const errors: string[] = [];
  const settle = async <T>(label: string, p: Promise<T>, fallback: T): Promise<T> => {
    try {
      return await p;
    } catch (e) {
      errors.push(`${label}: ${e instanceof Error ? e.message : String(e)}`);
      return fallback;
    }
  };

  const [samBoardHtml, davidBoardHtml, samRecordHtml] = await Promise.all([
    settle("Sam's board", get(src.samBoard), ""),
    settle("David's board", get(src.davidBoard), ""),
    settle("Sam's record", get(src.samRecord), ""),
  ]);
  const davidRows = davidBoardHtml ? await settle("David's history sheet", davidHistory(league, davidBoardHtml), []) : [];
  const samRows = samRecordHtml ? parseSamRecord(league, samRecordHtml, (d) => weekOf(league, d)) : [];

  const [sam, david] = await Promise.all([archive(league, "sam", samRows), archive(league, "david", davidRows)]);
  const joined = join(sam, david);

  // PEM, college only. Only weeks whose card checked out count.
  const seasonGuess = seasonNow();
  const pem = league === "cfb" ? await pemWeeks(seasonGuess) : [];
  const pemLines = new Map<string, PemLine>();
  for (const w of pem.filter((x) => x.verified)) {
    for (const r of w.rows) pemLines.set(key({ week: w.week, home: r.home, away: r.away }), { model: r.model, market: r.market });
  }
  const j = {
    ...joined,
    graded: joined.graded.map((g) => {
      const p = pemLines.get(key(g));
      return p ? gradeGame({ ...g, pem: p }) : g;
    }),
  };
  const s = strategies(league, j.graded);
  const su = suRecords(league, j.graded);

  const empty: Board = { week: null, season: null, rows: [] };
  const sb = samBoardHtml ? parseSamBoard(league, samBoardHtml) : empty;
  const db = davidBoardHtml ? parseDavidBoard(league, davidBoardHtml) : empty;
  // The week on the board is whichever site has moved on; a site still
  // showing last week contributes nothing to this one.
  const week = Math.max(sb.week ?? 0, db.week ?? 0) || null;
  const samLive = sb.week === week ? sb.rows : [];
  const davidLive = db.week === week ? db.rows : [];
  const dmap = new Map(davidLive.map((r) => [`${r.away}@${r.home}`, r]));
  const pemNow = (home: string, away: string) => (week ? pemLines.get(key({ week, home, away })) : undefined);
  const season = sb.season ?? db.season ?? seasonNow();
  const posted = week ? await notePosted(league, season, week, sb.week === week, db.week === week, pem.some((w) => w.week === week && w.verified)) : {};

  // One current quote per game, every model judged against it.
  let refs = new Map<string, RefLine>();
  let refProblem: string | undefined;
  if (week) {
    try {
      refs = await currentLines(league, season, week);
    } catch (e) {
      refProblem = `Current lines unavailable (${e instanceof Error ? e.message : String(e)}); the board shows source-line research signals only.`;
    }
  }
  const refNow = (home: string, away: string) => (week ? refs.get(key({ week, home, away })) : undefined);
  const rows: { home: string; away: string; sam?: ModelLine; david?: ModelLine; pem?: PemLine; ref?: RefLine }[] =
    samLive.map((r) => {
      const d = dmap.get(`${r.away}@${r.home}`);
      dmap.delete(`${r.away}@${r.home}`);
      return { home: r.home, away: r.away, sam: r.line, david: d?.line, pem: pemNow(r.home, r.away), ref: refNow(r.home, r.away) };
    });
  for (const d of dmap.values()) {
    rows.push({ home: d.home, away: d.away, sam: undefined, david: d.line, pem: pemNow(d.home, d.away), ref: refNow(d.home, d.away) });
  }
  const board = tierBoard(league, rows, s, su.best?.id ?? "avg");
  if (week && board.length) await saveSnapshot(league, season, week, board, s.rule?.label ?? null);
  // Totals: this week's model totals at the one current total, and the
  // forward archive of games where both models and a quote first met.
  const totalRows = rows.map((r) => ({
    home: r.home,
    away: r.away,
    sam: samLive.find((x) => x.home === r.home && x.away === r.away)?.modelTotal,
    david: davidLive.find((x) => x.home === r.home && x.away === r.away)?.modelTotal,
    ref:
      r.ref?.total !== undefined
        ? {
            total: r.ref.total,
            source: r.ref.source,
            fetchedAt: r.ref.fetchedAt,
            overPrice: r.ref.overPrice,
            underPrice: r.ref.underPrice,
            kickoff: r.ref.kickoff,
          }
        : undefined,
  }));
  let newlyArchived = 0;
  if (week) {
    const meet: TotalsSeen[] = totalRows.flatMap((r) =>
      r.sam !== undefined && r.david !== undefined && r.ref
        ? [{ week, home: r.home, away: r.away, sam: r.sam, david: r.david, line: r.ref.total, source: r.ref.source, seenAt: r.ref.fetchedAt }]
        : [],
    );
    newlyArchived = await archiveTotals(league, season, week, meet).catch(() => 0);
  }
  const seen = await loadTotalsSeen(league, season);
  const issued = await loadIssued(league, season);

  // Closing lines (and ESPN finals) for every graded game, every issued
  // pick, every archived totals game and Sam's whole record. Only finished
  // games are ever fetched; each is fetched once.
  const { closes, problems: closeProblems } = await closingLines(league, season, [
    ...j.graded,
    ...issuedGames(issued),
    ...seen,
    ...sam,
  ]);
  const finals = new Map(j.graded.map((g) => [key(g), g.final]));
  // Games only one model graded still have a final; ESPN fills in the rest,
  // so issued picks and totals grade even when neither site lists the game.
  for (const r of [...sam, ...david]) if (!finals.has(key(r))) finals.set(key(r), { home: r.homePts, away: r.awayPts });
  for (const [k, c] of closes) if (!finals.has(k) && c.final) finals.set(k, c.final);
  const live = gradeIssued(issued, finals);
  const rule = s.rule;
  const sent = issuedClv(issued, closes);
  const clv = {
    models: clvTable(j.graded, closes, rule ? { label: rule.label, matches: (g) => matches(g.read, rule.test) } : null),
    plays: [
      summarize("t1", "Tier 1 as sent", sent.t1),
      summarize("t2", "Tier 2 as sent", sent.t2),
      summarize("ou", "Totals as sent (vs closing total)", sent.totals),
    ],
    games: j.graded.length,
    matched: j.graded.filter((g) => closes.get(key(g))?.close != null).length,
  };
  const research = researchRows(j.graded, s.cuts, closes, league);
  const pemCmp = league === "cfb" && j.graded.some((g) => g.pem) ? pemCompare(j.graded, closes) : null;
  const priced = board.filter((g) => g.basis === "reference");
  const points = new Map([...finals].map(([k, f]) => [k, f.home + f.away]));
  const totalsMarket = new Map([...closes].map(([k, c]) => [k, { open: c.totalOpen, close: c.totalClose }]));
  const tb = totalsBacktest(league, seen, points, sam, totalsMarket, key);
  const totals = {
    backtest: tb,
    board: totalsBoard(totalRows, tb.rule),
    edge: TOTALS_EDGE[league],
    newlyArchived,
    archived: seen.length,
  };

  const notes = [...j.scoreMismatches.map((m) => `Final scores differ: ${m}. Sam's is used.`)];
  if (j.onlySam || j.onlyDavid) {
    notes.push(
      `${j.onlyDavid} graded game${j.onlyDavid === 1 ? "" : "s"} only David has and ${j.onlySam} only Sam has are left out of the agreement backtest (mostly weeks one site does not cover).`,
    );
  }
  for (const w of pem.filter((x) => !x.verified)) {
    notes.push(`PEM Week ${w.week} card didn't pass its check and is left out: ${w.problems.slice(0, 3).join("; ")}.`);
  }
  if (pem.length && week) {
    const unmatched = (pem.find((w) => w.week === week && w.verified)?.rows ?? []).filter(
      (r) => !rows.some((x) => x.home === r.home && x.away === r.away),
    );
    if (unmatched.length) notes.push(`PEM games not matched to the board (team names): ${unmatched.map((r) => `${r.awayName} at ${r.homeName}`).join(", ")}.`);
  }
  if (closeProblems.length) notes.push(`Some closing lines could not be read from ESPN this time (${closeProblems.join("; ")}).`);
  if (sb.week !== db.week && sb.week && db.week) {
    notes.push(`The sites are on different weeks (Sam ${sb.week}, David ${db.week}); only Week ${week} games are on the board.`);
  }

  const names: { [key: string]: string } = {};
  for (const r of [...sam, ...david, ...samLive, ...davidLive]) {
    if (r.homeName) names[r.home] ??= league === "nfl" ? r.home : r.homeName;
    if (r.awayName) names[r.away] ??= league === "nfl" ? r.away : r.awayName;
  }

  return {
    pem: pem.map((w: PemWeek) => ({ week: w.week, verified: w.verified, games: w.rows.length, source: w.source })),
    names,
    clv,
    research,
    pemCompare: pemCmp,
    totals,
    posted,
    units: unitReport(firstSends(issued), finals),
    reference: {
      source: priced[0]?.ref?.source ?? null,
      fetchedAt: priced[0]?.ref?.fetchedAt ?? null,
      priced: priced.length,
      games: board.length,
      problem: refProblem,
    },
    league,
    season,
    week,
    generatedAt: new Date().toISOString(),
    boardUpdated: { sam: samLive.length > 0, david: davidLive.length > 0 },
    weeksCovered: [...new Set(j.graded.map((g) => g.week))].sort((a, b) => a - b),
    graded: j.graded,
    strategies: s,
    su,
    board,
    live,
    notes,
    errors,
  };
}

const CACHE_KEY = (league: League) => `picks:v1:${league}:report`;

/** The page and email read this. Three hours fresh, a week of last-known-good. */
export function getPicksReport(league: League) {
  return cachedWithFallback<PicksReport | null>({
    key: CACHE_KEY(league),
    ttlSeconds: 3 * 60 * 60,
    fetcher: () => buildPicksReport(league),
    isComplete: (r) => !!r && r.graded.length > 0 && r.board.length > 0 && r.errors.length === 0,
    empty: null,
  });
}

/** Drops the cache and rebuilds. The pulse calls this. */
export async function refreshPicks(league: League): Promise<PicksReport | null> {
  await redis.del(CACHE_KEY(league)).catch(() => {});
  return (await getPicksReport(league)).value;
}
