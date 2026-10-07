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
import type { PemWeek } from "./pem-card";
import {
  type BoardGame,
  type PemLine,
  gradeGame,
  type GradedGame,
  type Record,
  type Result,
  type StrategyBoard,
  type SuRecord,
  grade,
  join,
  key,
  strategies,
  suRecords,
  tally,
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
//   Each week's board as it stood when the Wednesday email went out. That is
//   the line the plays were actually made at, and grading those frozen plays
//   is the only honest record of the rule since it went live. Until the email
//   freezes a week, the snapshot follows the live board.

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
  suConfidence?: string;
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
    side: g.read?.side,
    homeLine: g.read?.side && g.read.line !== undefined ? (g.read.side === "home" ? g.read.line : -g.read.line) : undefined,
    play: g.play,
    suSide: g.su?.side,
    suConfidence: g.su?.confidence,
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

/** Called by the email once it has gone out. */
export async function freezeSnapshot(league: League, season: number, week: number): Promise<void> {
  try {
    const s = await redis.get<Snapshot>(snapKey(league, season, week));
    if (s && !s.frozen) await redis.set(snapKey(league, season, week), { ...s, frozen: true, at: new Date().toISOString() });
  } catch {
    /* Next refresh keeps updating it; the week is graded at a later line. */
  }
}

async function snapshots(league: League, season: number): Promise<Snapshot[]> {
  try {
    const weeks = (await redis.smembers(snapIndex(league, season))).map(Number).sort((a, b) => a - b);
    const snaps = await Promise.all(weeks.map((w) => redis.get<Snapshot>(snapKey(league, season, w))));
    return snaps.filter((s): s is Snapshot => !!s);
  } catch {
    return [];
  }
}

export interface LiveWeek {
  week: number;
  frozen: boolean;
  rule: string | null;
  t1: Record;
  t2: Record;
  su: { w: number; l: number };
  pending: number;
}

/** The plays as they were made, graded against what happened. */
function liveRecord(snaps: Snapshot[], graded: Map<string, { home: number; away: number }>): LiveWeek[] {
  return snaps.map((s) => {
    const res = (tier: "t1" | "t2"): Result[] =>
      s.plays.flatMap((p) => {
        const f = graded.get(key({ week: s.week, home: p.home, away: p.away }));
        return p.tier === tier && f && p.side && p.homeLine !== undefined ? [grade(f, p.homeLine, p.side)] : [];
      });
    let w = 0;
    let l = 0;
    let pending = 0;
    for (const p of s.plays) {
      const f = graded.get(key({ week: s.week, home: p.home, away: p.away }));
      if (!f) {
        if (p.tier === "t1" || p.tier === "t2") pending++;
        continue;
      }
      if (!p.suSide || f.home === f.away) continue;
      if ((p.suSide === "home") === f.home > f.away) w++;
      else l++;
    }
    return { week: s.week, frozen: s.frozen, rule: s.rule, t1: tally(res("t1")), t2: tally(res("t2")), su: { w, l }, pending };
  });
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
  live: LiveWeek[];
  notes: string[];
  errors: string[];
  /** PEM weeks on file (college), and whether each checked out. */
  pem: { week: number; verified: boolean; games: number; source: string }[];
  /** Team key to the name a site printed, for display. NFL keys map to themselves. */
  names: { [key: string]: string };
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
  const rows: { home: string; away: string; sam?: ModelLine; david?: ModelLine; pem?: PemLine }[] = samLive.map((r) => {
    const d = dmap.get(`${r.away}@${r.home}`);
    dmap.delete(`${r.away}@${r.home}`);
    return { home: r.home, away: r.away, sam: r.line, david: d?.line, pem: pemNow(r.home, r.away) };
  });
  for (const d of dmap.values()) rows.push({ home: d.home, away: d.away, sam: undefined, david: d.line, pem: pemNow(d.home, d.away) });
  const board = tierBoard(league, rows, s);

  const season = sb.season ?? db.season ?? seasonNow();
  if (week && board.length) await saveSnapshot(league, season, week, board, s.rule?.label ?? null);
  const finals = new Map(j.graded.map((g) => [key(g), g.final]));
  // Games only one model graded still have a final, and frozen plays on them count.
  for (const r of [...sam, ...david]) if (!finals.has(key(r))) finals.set(key(r), { home: r.homePts, away: r.awayPts });
  const live = liveRecord(await snapshots(league, season), finals);

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
