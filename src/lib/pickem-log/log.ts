// The /pickem pick log: every pick the skill makes, and its result once graded.
//
// Pure. The CLI (scripts/pickem-log.mts) owns the files and the ESPN reads;
// this module validates records, grades one pick against a finished game, and
// counts records by split. Format and field meanings: data/pickem/README.md.
//
// Lines are home-side, like the picks engine: -3.5 means the home team gives
// 3.5. A record is never edited by hand; grading only fills `result`.

import { teamKey, type League } from "../picks/parse";
import { clvPoints } from "../picks/closing";

export type Market = "ats" | "su";
export type Side = "home" | "away";
export type Outcome = "W" | "L" | "P";

export interface TeamEntry {
  name: string;
  /** AP or CFP rank at pick time, 1-25; null when unranked or unknown. */
  rank: number | null;
}

export interface LineAt {
  /** Home-side spread. */
  home: number;
  /** Where the number came from: "pool", "DraftKings via ESPN", "Sam's page", ... */
  source: string;
  /** When it was read, ISO time, if known. */
  as_of?: string | null;
}

export interface PickResult {
  graded_at: string;
  final: { home: number; away: number };
  /** Straight-up result of the picked team. */
  su: Outcome;
  /** Against the line we picked at (record.line); null when no line was logged. */
  ats: Outcome | null;
  /** The result that counts for this pick: ats for ATS picks, su for SU picks. */
  graded: Outcome | null;
  /** DraftKings open and close via ESPN's game summary (home-side), when ESPN priced the game. */
  close: { open: number | null; spread: number | null; total_open: number | null; total: number | null } | null;
  /** Points better (+) or worse (-) than the close for the picked side, at record.line. */
  clv_points: number | null;
  /** ESPN's rank for each team on that week's scoreboard (AP, then CFP once it's out). */
  ranks_espn: { home: number | null; away: number | null } | null;
  source: string;
}

export interface PickRecord {
  /** Schema version. */
  v: 1;
  /** Stable per game, market and pool; reruns of a slate share it and the latest logged wins. */
  id: string;
  /** One per skill run, so reruns of a slate can be told apart. */
  run_id: string;
  logged_at: string;
  /** Slate date (YYYY-MM-DD), usually the Saturday. */
  date: string;
  league: League;
  season: number;
  week: number;
  /** ESPN season type: 2 regular season, 3 bowls and playoff. */
  seasontype: 2 | 3;
  pool: string | null;
  market: Market;
  home: TeamEntry;
  away: TeamEntry;
  neutral: boolean;
  rank_source: "AP" | "CFP" | null;
  /** The line the pick was made against (the pool's line when it posts one). Null for SU pools with no line. */
  line: LineAt | null;
  /** The live market line at pick time, when it differs in source from `line`. */
  market_line: LineAt | null;
  total: { value: number; source: string } | null;
  pick: { team: string; side: Side };
  /** Favorite by `line` (else market_line); null on a pick'em line. Derived, not entered. */
  favorite: Side | null;
  /** Pool confidence points, if the pool uses them. */
  confidence: number | null;
  /** Tier, edge or rule label the skill assigned (e.g. "t1", "near-vegas"). */
  tier: string | null;
  /** Points of edge vs the line, if the skill computed one. */
  edge: number | null;
  /** Why this side: "agree", "pem_tiebreak", "david_tiebreak", "market_move", "vegas_favorite", "other". */
  reason: string;
  /** Model lines, home-side, at pick time. */
  models: { sam: number | null; david: number | null; pem: number | null; ours: number | null };
  /** One or two sentences: what the skill said about this game. */
  summary: string;
  result: PickResult | null;
}

/** What the skill passes in per game; the rest is filled by `buildRecord`. */
export type PickInput = Omit<PickRecord, "v" | "id" | "run_id" | "logged_at" | "favorite" | "result" | "seasontype" | "pool" | "neutral" | "rank_source" | "market_line" | "total" | "confidence" | "tier" | "edge" | "models" | "summary"> &
  Partial<Pick<PickRecord, "seasontype" | "pool" | "neutral" | "rank_source" | "market_line" | "total" | "confidence" | "tier" | "edge" | "models" | "summary">>;

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function pickId(r: Pick<PickRecord, "league" | "season" | "week" | "pool" | "market" | "home" | "away">): string {
  const t = (n: string) => slug(teamKey(r.league, n));
  return `${r.league}-${r.season}-w${r.week}-${slug(r.pool ?? "pool") || "pool"}-${r.market}-${t(r.away.name)}@${t(r.home.name)}`;
}

/** Favorite side from a home-side line. */
export function favoriteOf(line: number | null | undefined): Side | null {
  if (line === null || line === undefined || line === 0) return null;
  return line < 0 ? "home" : "away";
}

const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const isNumOrNull = (x: unknown) => x === null || x === undefined || isNum(x);

/** Problems with one input, empty when it is fine. */
export function problemsOf(p: Partial<PickInput>): string[] {
  const out: string[] = [];
  if (p.league !== "cfb" && p.league !== "nfl") out.push("league must be cfb or nfl");
  if (!isNum(p.season)) out.push("season missing");
  if (!isNum(p.week)) out.push("week missing");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date ?? "")) out.push("date must be YYYY-MM-DD");
  if (p.market !== "ats" && p.market !== "su") out.push("market must be ats or su");
  if (!p.home?.name || !p.away?.name) out.push("home and away names required");
  for (const t of [p.home, p.away]) if (t && !isNumOrNull(t.rank)) out.push(`rank for ${t.name} must be a number or null`);
  if (!p.pick?.team || (p.pick.side !== "home" && p.pick.side !== "away")) out.push("pick needs team and side (home|away)");
  if (p.market === "ats" && !p.line) out.push("ATS pick needs line");
  if (p.line && !isNum(p.line.home)) out.push("line.home must be a number");
  if (p.line && !p.line.source) out.push("line.source required");
  if (!p.reason) out.push("reason required");
  if (p.pick && p.home && p.away && p.league) {
    const want = p.pick.side === "home" ? p.home.name : p.away.name;
    if (teamKey(p.league, want) !== teamKey(p.league, p.pick.team)) out.push(`pick.team ${p.pick.team} is not the ${p.pick.side} team`);
  }
  return out;
}

export function buildRecord(p: PickInput, runId: string, now: string): PickRecord {
  const base = {
    seasontype: 2 as const,
    pool: null,
    neutral: false,
    rank_source: null,
    market_line: null,
    total: null,
    confidence: null,
    tier: null,
    edge: null,
    summary: "",
    ...p,
    models: { sam: null, david: null, pem: null, ours: null, ...(p.models ?? {}) },
  };
  return {
    v: 1,
    id: pickId(base),
    run_id: runId,
    logged_at: now,
    ...base,
    favorite: favoriteOf(base.line?.home ?? base.market_line?.home),
    result: null,
  };
}

/** The last-logged record per id (a rerun of a slate replaces the earlier pick). */
export function latestPerPick(rs: PickRecord[]): PickRecord[] {
  const m = new Map<string, PickRecord>();
  for (const r of rs) {
    const prev = m.get(r.id);
    if (!prev || r.logged_at >= prev.logged_at) m.set(r.id, r);
  }
  return [...m.values()];
}

/** Picked team's result given a margin for it (positive = it won or covered). */
const outcome = (m: number): Outcome => (m > 0 ? "W" : m < 0 ? "L" : "P");

export interface FinishedGame {
  final: { home: number; away: number };
  close?: { open: number | null; spread: number | null; total_open: number | null; total: number | null } | null;
  ranks?: { home: number | null; away: number | null } | null;
}

export function gradePick(r: PickRecord, g: FinishedGame, now: string, source: string): PickResult {
  const sign = r.pick.side === "home" ? 1 : -1;
  const margin = (g.final.home - g.final.away) * sign;
  const su = outcome(margin);
  const ats = r.line ? outcome(margin + r.line.home * sign) : null;
  const close = g.close ?? null;
  const clv = r.line && close && isNum(close.spread) ? Math.round(clvPoints(r.pick.side, r.line.home, close.spread) * 10) / 10 : null;
  return {
    graded_at: now,
    final: g.final,
    su,
    ats,
    graded: r.market === "ats" ? ats : su,
    close,
    clv_points: clv,
    ranks_espn: g.ranks ?? null,
    source,
  };
}

// ------------------------------------------------------------------ splits

export interface SplitRow {
  split: string;
  group: string;
  w: number;
  l: number;
  p: number;
  /** Wins over decided games, null with none decided. */
  pct: number | null;
  /** Average CLV points over picks with a close. */
  clv: number | null;
}

/** A team counts as ranked if the skill logged a rank, else if ESPN's scoreboard showed one. */
const rankOf = (r: PickRecord, side: Side) => r[side].rank ?? r.result?.ranks_espn?.[side] ?? null;

/** The keys a later session splits on, all from fields on the record. */
export const SPLITS: { [split: string]: (r: PickRecord) => string } = {
  all: () => "all",
  market: (r) => r.market,
  league: (r) => r.league,
  ranked: (r) => {
    const n = [rankOf(r, "home"), rankOf(r, "away")].filter((x) => x !== null && x <= 25).length;
    return n === 2 ? "both ranked" : n === 1 ? "one ranked" : "unranked";
  },
  picked_ranked: (r) => (rankOf(r, r.pick.side) !== null ? "picked ranked team" : "picked unranked team"),
  fav_dog: (r) => (r.favorite === null ? "pick'em line" : r.favorite === r.pick.side ? "favorite" : "underdog"),
  home_away: (r) => (r.neutral ? "neutral" : r.pick.side),
  tier: (r) => r.tier ?? "(none)",
  reason: (r) => r.reason,
};

export function splits(records: PickRecord[]): SplitRow[] {
  const graded = latestPerPick(records).filter((r) => r.result?.graded);
  const rows = new Map<string, SplitRow & { clvs: number[] }>();
  for (const r of graded) {
    for (const [split, fn] of Object.entries(SPLITS)) {
      const group = fn(r);
      const k = `${split}\u0000${group}`;
      const row = rows.get(k) ?? { split, group, w: 0, l: 0, p: 0, pct: null, clv: null, clvs: [] };
      const o = r.result!.graded!;
      if (o === "W") row.w++;
      else if (o === "L") row.l++;
      else row.p++;
      if (r.result!.clv_points !== null) row.clvs.push(r.result!.clv_points);
      rows.set(k, row);
    }
  }
  return [...rows.values()].map(({ clvs, ...row }) => ({
    ...row,
    pct: row.w + row.l ? Math.round((row.w / (row.w + row.l)) * 1000) / 1000 : null,
    clv: clvs.length ? Math.round((clvs.reduce((a, b) => a + b, 0) / clvs.length) * 100) / 100 : null,
  }));
}
