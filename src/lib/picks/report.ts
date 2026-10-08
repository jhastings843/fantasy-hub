import "server-only";
import { redis } from "@/lib/redis/client";
import { cachedWithFallback } from "@/lib/redis/cached";
import {
  type Board,
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
import { clvTable } from "./closing";
import { closingLines, currentLines } from "./closing-store";
import { issuedGames } from "./issued";
import { loadIssued, loadIssuedStrict } from "./issued-store";
import { OUTSTANDING_CAP, WEEKLY_CAP } from "./limits";
import { pemCompare, researchRows } from "./research";
import { TOTALS_EDGE, type TotalsSeen, totalsBacktest } from "./totals";
import { archiveTotals, loadTotalsSeen } from "./totals-store";
import type { PemWeek } from "./pem-card";
import { type PicksCore, type PicksReport, type Quotes, compose, exposureFrom } from "./compose";
import { loadActivePolicy } from "./policy-store";
import { activatedFor } from "./report-scope";
import { archiveForecasts } from "./forecasts";
import {
  type BoardGame,
  type PemLine,
  type RefLine,
  gradeGame,
  join,
  key,
  matches,
  strategies,
  suRecords,
} from "./engine";

export type { PicksReport } from "./compose";

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

// Season-aware since 2026-10-09 (the v1 keys had no season; everything in
// them is 2026 and is copied over once, then left as it was).
const archiveKey = (league: League, season: number, who: "sam" | "david") => `picks:v2:${league}:${season}:rows:${who}`;
const legacyArchiveKey = (league: League, who: "sam" | "david") => `picks:v1:${league}:rows:${who}`;

/** Merges this fetch into everything seen this season; the newest copy of a game wins. */
async function archive(league: League, season: number, who: "sam" | "david", rows: GradedRow[]): Promise<GradedRow[]> {
  let stored: GradedRow[] = [];
  try {
    stored = (await redis.get<GradedRow[]>(archiveKey(league, season, who))) ?? [];
    if (!stored.length && season === 2026) stored = (await redis.get<GradedRow[]>(legacyArchiveKey(league, who))) ?? [];
  } catch {
    return rows;
  }
  const merged = new Map(stored.map((r) => [key(r), r]));
  for (const r of rows) merged.set(key(r), r);
  const all = [...merged.values()];
  if (all.length !== stored.length || rows.length) {
    await redis.set(archiveKey(league, season, who), all).catch(() => {});
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

function seasonNow(): number {
  const d = new Date();
  return d.getUTCMonth() <= 1 ? d.getUTCFullYear() - 1 : d.getUTCFullYear();
}

/** The slow part: both sites, the backtest, research, closing lines. Cached for hours. */
export async function buildPicksCore(league: League): Promise<PicksCore> {
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

  const empty: Board = { week: null, season: null, rows: [] };
  const sb = samBoardHtml ? parseSamBoard(league, samBoardHtml) : empty;
  const db = davidBoardHtml ? parseDavidBoard(league, davidBoardHtml) : empty;
  const season = sb.season ?? db.season ?? seasonNow();

  const [sam, david] = await Promise.all([archive(league, season, "sam", samRows), archive(league, season, "david", davidRows)]);
  const joined = join(sam, david);

  // PEM, college only. Only weeks whose card checked out count.
  const pem = league === "cfb" ? await pemWeeks(season) : [];
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
  const policy = await loadActivePolicy();
  const s = strategies(league, j.graded, { activated: activatedFor(league, policy.atsCandidates) });
  const su = suRecords(league, j.graded);

  // The week on the board is whichever site has moved on; a site still
  // showing last week contributes nothing to this one.
  const week = Math.max(sb.week ?? 0, db.week ?? 0) || null;
  const samLive = sb.week === week ? sb.rows : [];
  const davidLive = db.week === week ? db.rows : [];
  const dmap = new Map(davidLive.map((r) => [`${r.away}@${r.home}`, r]));
  const pemNow = (home: string, away: string) => (week ? pemLines.get(key({ week, home, away })) : undefined);
  const posted = week ? await notePosted(league, season, week, sb.week === week, db.week === week, pem.some((w) => w.week === week && w.verified)) : {};
  const rows: PicksCore["rows"] = samLive.map((r) => {
    const d = dmap.get(`${r.away}@${r.home}`);
    dmap.delete(`${r.away}@${r.home}`);
    return { home: r.home, away: r.away, sam: r.line, david: d?.line, pem: pemNow(r.home, r.away), samTotal: r.modelTotal, davidTotal: d?.modelTotal };
  });
  for (const d of dmap.values()) {
    rows.push({ home: d.home, away: d.away, david: d.line, pem: pemNow(d.home, d.away), davidTotal: d.modelTotal });
  }

  const seen = await loadTotalsSeen(league, season);
  const issued = await loadIssued(league, season);
  // Closing lines (and ESPN finals) for every graded game, every issued
  // pick, every archived totals game and Sam's whole record. Only finished
  // games are ever fetched; each is fetched once.
  const { closes, problems: closeProblems } = await closingLines(league, season, [...j.graded, ...issuedGames(issued), ...seen, ...sam]);
  const finals = new Map(j.graded.map((g) => [key(g), g.final]));
  // Games only one model graded still have a final; ESPN fills in the rest,
  // so issued picks and totals grade even when neither site lists the game.
  for (const r of [...sam, ...david]) if (!finals.has(key(r))) finals.set(key(r), { home: r.homePts, away: r.awayPts });
  for (const [k, c] of closes) if (!finals.has(k) && c.final) finals.set(k, c.final);
  const rule = s.rule;
  const points = new Map([...finals].map(([k, f]) => [k, f.home + f.away]));
  const totalsMarket = new Map([...closes].map(([k, c]) => [k, { open: c.totalOpen, close: c.totalClose }]));

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
    league,
    season,
    week,
    generatedAt: new Date().toISOString(),
    boardUpdated: { sam: samLive.length > 0, david: davidLive.length > 0 },
    weeksCovered: [...new Set(j.graded.map((g) => g.week))].sort((a, b) => a - b),
    graded: j.graded,
    strategies: s,
    su,
    rows,
    notes,
    errors,
    pem: pem.map((w: PemWeek) => ({ week: w.week, verified: w.verified, games: w.rows.length, source: w.source })),
    names,
    clvModels: clvTable(j.graded, closes, rule ? { label: rule.label, matches: (g) => matches(g.read, rule.test) } : null),
    research: researchRows(j.graded, s.cuts, closes),
    pemCompare: league === "cfb" && j.graded.some((g) => g.pem) ? pemCompare(j.graded, closes) : null,
    totalsBacktest: totalsBacktest(league, seen, points, sam, totalsMarket, key),
    totalsEdge: TOTALS_EDGE[league],
    totalsArchived: seen.length,
    posted,
    finals: [...finals],
    closes: [...closes],
    policyId: policy.id,
  };
}

const CORE_KEY = (league: League) => `picks:v2:${league}:core`;
const QUOTES_KEY = (league: League, season: number, week: number) => `picks:v2:${league}:quotes:${season}:w${week}`;
/** Current lines are re-read at most this often (the pulse forces a read every run). */
const QUOTES_TTL_S = 10 * 60;

/** The slow core: three hours fresh, a week of last-known-good. */
export function getPicksCore(league: League) {
  return cachedWithFallback<PicksCore | null>({
    key: CORE_KEY(league),
    ttlSeconds: 3 * 60 * 60,
    fetcher: () => buildPicksCore(league),
    isComplete: (r) => !!r && r.graded.length > 0 && r.rows.length > 0 && r.errors.length === 0,
    empty: null,
  });
}

/** This week's quotes: ten minutes fresh; `force` re-reads ESPN now. */
export async function getQuotes(league: League, season: number, week: number | null, force = false): Promise<Quotes> {
  if (!week) return { fetchedAt: null, lines: [] };
  const k = QUOTES_KEY(league, season, week);
  if (!force) {
    const cached = await redis.get<Quotes>(k).catch(() => null);
    if (cached?.fetchedAt && Date.now() - new Date(cached.fetchedAt).getTime() < QUOTES_TTL_S * 1000) return cached;
  }
  try {
    const lines = await currentLines(league, season, week);
    const q: Quotes = { fetchedAt: new Date().toISOString(), lines: [...lines] };
    await redis.set(k, q, { ex: 7 * 24 * 3600 }).catch(() => {});
    return q;
  } catch (e) {
    // Keep showing the last quotes (compose marks them stale by age), and say why.
    const last = await redis.get<Quotes>(k).catch(() => null);
    return { ...(last ?? { fetchedAt: null, lines: [] }), problem: `Current lines unavailable (${e instanceof Error ? e.message : String(e)}).` };
  }
}

const SETTLED_KEY = (season: number) => `picks:v2:settled:${season}`;

/** Marks issued bets whose game has a final, so cross-sport exposure knows what is still open. */
export async function settleIssued(league: League, season: number, finals: Map<string, { home: number; away: number }>): Promise<number> {
  const issued = await loadIssued(league, season);
  const open = issuedGames(issued)
    .map((g) => key(g))
    .filter((k) => finals.has(k));
  if (!open.length) return 0;
  const fields = Object.fromEntries(open.map((k) => [`${league}:${k}`, "1"]));
  await redis.hset(SETTLED_KEY(season), fields);
  return open.length;
}

/**
 * The live report: the cached core plus current quotes and exposure.
 * `reserved` is units another sport's card in the same send has already
 * claimed, so a two-sport card stays inside the outstanding cap.
 */
export async function getPicksReport(
  league: League,
  opts: { forceQuotes?: boolean; reserved?: number } = {},
): Promise<{ value: PicksReport | null; stale: boolean; at: string | null }> {
  const core = await getPicksCore(league);
  if (!core.value) return { value: null, stale: core.stale, at: core.at };
  const c = core.value;
  const [quotes, policy] = await Promise.all([getQuotes(league, c.season, c.week, opts.forceQuotes), loadActivePolicy()]);
  // Exposure must be read, not assumed: if what was issued can't be read,
  // the room is zero and the page says why, rather than treating a failed
  // read as "nothing issued".
  let issuedHere: Awaited<ReturnType<typeof loadIssued>> = [];
  let exposure;
  let exposureProblem: string | undefined;
  try {
    const [nfl, cfb, settled] = await Promise.all([
      loadIssuedStrict("nfl", c.season),
      loadIssuedStrict("cfb", c.season),
      redis.hkeys(SETTLED_KEY(c.season)),
    ]);
    const settledSet = new Set<string>(settled.map(String));
    for (const [k] of c.finals) settledSet.add(`${league}:${k}`);
    issuedHere = league === "nfl" ? nfl : cfb;
    exposure = { ...exposureFrom(league, c.week, [{ league: "nfl", records: nfl }, { league: "cfb", records: cfb }], settledSet), reserved: opts.reserved ?? 0 };
  } catch (e) {
    exposureProblem = `Couldn't read what has already been issued (${e instanceof Error ? e.message : String(e)}), so no new stakes this read.`;
    exposure = { weekly: WEEKLY_CAP, outstanding: OUTSTANDING_CAP, perGame: new Map<string, number>(), reserved: 0 };
  }
  const value = compose({ core: c, quotes: exposureProblem ? { ...quotes, problem: [quotes.problem, exposureProblem].filter(Boolean).join(" ") } : quotes, issued: issuedHere, exposure, policy });
  return { value, stale: core.stale, at: core.at };
}

/** Drops the core cache, re-reads the quotes, and rebuilds. The send paths call this. */
export async function refreshPicks(league: League, opts: { reserved?: number } = {}): Promise<PicksReport | null> {
  await redis.del(CORE_KEY(league)).catch(() => {});
  return (await getPicksReport(league, { forceQuotes: true, reserved: opts.reserved })).value;
}

/**
 * The data operation the pulse runs in the live and hourly tiers, with no
 * page visit needed: re-read quotes, keep the core fresh, archive this
 * week's pregame forecasts and totals (append-only), settle issued bets,
 * snapshot the board. Returns one line for the receipt.
 */
export async function runPicksData(league: League): Promise<string> {
  const r = (await getPicksReport(league, { forceQuotes: true })).value;
  if (!r) throw new Error(`${league} core unavailable`);
  const core = (await getPicksCore(league)).value!;
  const finals = new Map(core.finals);
  const settled = await settleIssued(league, r.season, finals);
  let forecasts = 0;
  let totalsNew = 0;
  if (r.week) {
    forecasts = await archiveForecasts(league, r.season, r.week, r.board, core.rows);
    const meet: TotalsSeen[] = r.totals.board.flatMap((g) =>
      g.sam !== undefined && g.david !== undefined && g.ref
        ? [{ week: r.week as number, home: g.home, away: g.away, sam: g.sam, david: g.david, line: g.ref.total, source: g.ref.source, seenAt: g.ref.fetchedAt }]
        : [],
    );
    totalsNew = await archiveTotals(league, r.season, r.week, meet).catch(() => 0);
    if (r.board.length) await saveSnapshot(league, r.season, r.week, r.board, r.strategies.rule?.label ?? null);
  }
  return `${league} wk ${r.week ?? "?"}: quotes ${r.reference.priced}/${r.reference.games}${r.reference.stale ? " STALE" : ""}, ${forecasts} forecast snapshots, ${totalsNew} totals archived, ${settled} issued games final`;
}

export type { RefLine, BoardGame };
