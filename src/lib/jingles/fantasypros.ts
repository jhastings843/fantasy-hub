import "server-only";
import { cached } from "@/lib/redis/cached";
import type { Scoring } from "./parse";

// Reading his rankings from where he actually publishes them now.
//
// On 2026-09-17 he moved off Substack: "Big Fantasy Update: Rankings Are Live".
// He joined the FantasyPros expert platform and the rankings live at
// rankings.jingleslabs.com, which is a FantasyPros widget rather than a written
// post. Nothing in weekly.ts can read that, and nothing ever will again: the
// post it was built for no longer contains rows, only a link.
//
// What replaced it is better in every way that matters here. It is JSON, it
// carries a real published timestamp, it keys every player to a FantasyPros id
// and a Yahoo id, and THREE SCORINGS ARE GENUINELY DIFFERENT LISTS rather than
// one list with a paragraph telling you how to adjust it. That last one closes
// the oldest hole in this app: Dah Chopped is a full-PPR league that has been
// advised off half-PPR rankings all season.
//
// The endpoint is the one the widget itself calls, unauthenticated, with his
// expert id. It is a partner API and not a documented public one, so it is
// treated the way feed.ts treats Substack: hard timeouts, cached, and every
// caller has to survive it returning nothing.

const HOST = "https://partners.fantasypros.com";

/** His expert id on the FantasyPros platform, from the widget on his page. */
const EXPERT_ID = process.env.JINGLES_FP_EXPERT_ID ?? "7717";

const FETCH_TIMEOUT_MS = 12_000;

/**
 * Ten minutes.
 *
 * He edits these through the week ("If something changes Thursday, Friday,
 * Saturday or Sunday morning, the rankings change with it"), and the pulse
 * calls the ingest every fifteen minutes, so this mostly stops a burst of
 * callers inside one tick from each making the same eight requests.
 */
const TTL = 10 * 60;

export type FpScoringCode = "HALF" | "PPR" | "STD";

/** His three lists, in our vocabulary and theirs. */
export const SCORING_CODE: Record<Exclude<Scoring, "unknown">, FpScoringCode> = {
  half_ppr: "HALF",
  full_ppr: "PPR",
  standard: "STD",
};

export const IN_SCORING_ORDER: Exclude<Scoring, "unknown">[] = [
  "half_ppr",
  "full_ppr",
  "standard",
];

/**
 * Positions as FantasyPros names them.
 *
 * OP is the one to understand. It is the superflex list, and it is exactly the
 * union of his QB, RB, WR and TE lists: 32 + 75 + 100 + 32 = 239 players, which
 * is what OP returns, and every player's pos_rank in it equals their rank in
 * the dedicated list. So ONE call to OP carries every positional ranking he
 * publishes, plus the superflex ordering, and the four separate calls it would
 * otherwise take are wasted.
 *
 * FLX is NOT derivable the same way. Dropping the quarterbacks out of OP gives
 * 207 players, the right count, in very slightly the wrong order: he has Juwan
 * Johnson over Kyle Monangai in one and the reverse in the other. Measured, not
 * assumed. The flex list is the only place he ranks positions against each
 * other and it is the whole reason a flex slot can be filled honestly, so it is
 * fetched rather than inferred.
 */
type FpPosition = "ALL" | "OP" | "FLX" | "K" | "DST";

interface FpRaw {
  rank: string;
  pos_rank: string;
  rank_ecr: number | null;
  rank_vs_ecr: number | null;
  player_id: number;
  player_name: string;
  player_team_id: string;
  player_positions: string;
  player_yahoo_id: string | null;
  notes: string | null;
  bye_week: string | null;
  opponent: string | null;
  location: string | null;
  matchup: string | null;
  tier: number | null;
}

export interface FpResponse {
  expert_id: string;
  expert_name: string;
  sport: string;
  type: string;
  year: string;
  week: string;
  position_id: string;
  scoring: string;
  count: number;
  /** "2026-09-17 07:19:57". His own publish stamp, and the freshness signal. */
  published: string;
  players: FpRaw[];
}

export interface FpRow {
  /** Rank within the list this row came from. */
  rank: number;
  name: string;
  /** Sleeper's code: QB, RB, WR, TE, DEF, K. */
  position: string;
  /** His rank for the player among their own position. */
  positionRank: number;
  team: string;
  opponent: string;
  home: boolean;
  bye: number | null;
  /** Expert consensus rank, where FantasyPros has one. */
  ecrRank: number | null;
  /**
   * Consensus rank minus his rank. POSITIVE MEANS HE IS HIGHER on the player
   * than the field, which is the direction his own post describes: he has
   * Parker Washington 15th where consensus has him 17th, and this reads +2.
   */
  vsEcr: number | null;
  fantasyProsId: string;
  /** Present on most rows, and the only key Jack's Yahoo league could join on. */
  yahooId: string | null;
  note: string | null;
}

/** His D/ST is DST; Sleeper's position is DEF, and resolve.ts keys on DEF. */
function sleeperPosition(fp: string): string {
  const p = fp.toUpperCase();
  return p === "DST" || p === "D/ST" ? "DEF" : p;
}

/** "RB12" -> 12. Falls back to the row's own rank when the label is missing. */
function positionRankOf(posRank: string | null, rank: number): number {
  const m = (posRank ?? "").match(/(\d+)\s*$/);
  return m ? Number(m[1]) : rank;
}

function toNumberOrNull(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Turn one API response into rows.
 *
 * Pure, so the shape of a real payload can be tested without the network.
 */
export function rowsFrom(response: FpResponse): FpRow[] {
  const rows: FpRow[] = [];

  for (const p of response.players ?? []) {
    const rank = toNumberOrNull(p.rank);
    if (rank === null) continue;

    const name = (p.player_name ?? "").trim();
    const team = (p.player_team_id ?? "").trim().toUpperCase();
    if (!name) continue;

    // "at BUF" / "vs. DET". The location field says the same thing without
    // parsing, so it is preferred and the matchup string is only a fallback.
    const location = (p.location ?? "").toLowerCase();
    const home = location ? location === "home" : !/^\s*at\b/i.test(p.matchup ?? "");

    rows.push({
      rank,
      name,
      position: sleeperPosition(p.player_positions ?? ""),
      positionRank: positionRankOf(p.pos_rank, rank),
      team,
      opponent: (p.opponent ?? "").trim().toUpperCase(),
      home,
      bye: toNumberOrNull(p.bye_week),
      ecrRank: toNumberOrNull(p.rank_ecr),
      vsEcr: toNumberOrNull(p.rank_vs_ecr),
      fantasyProsId: String(p.player_id ?? ""),
      yahooId: p.player_yahoo_id ? String(p.player_yahoo_id) : null,
      note: p.notes?.trim() ? p.notes.trim() : null,
    });
  }

  return rows;
}

async function get(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        accept: "application/json",
        "user-agent": "fantasy-hub/1.0 (personal fantasy football tool)",
      },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

interface ListQuery {
  year: string;
  week: number;
  position: FpPosition;
  scoring: FpScoringCode;
  /** "weekly" for this week's list, "draft" for his season-long one. */
  type: "weekly" | "draft";
}

export function listUrl(q: ListQuery): string {
  const params = new URLSearchParams({
    sport: "NFL",
    year: q.year,
    week: String(q.week),
    id: EXPERT_ID,
    position: q.position,
    type: q.type,
    scoring: q.scoring,
  });
  return `${HOST}/api/v1/expert-rankings.php?${params}`;
}

/**
 * One list, cached.
 *
 * A week he has not published yet answers 200 with an empty player list rather
 * than an error, so "no rows" is a normal answer and never an exception.
 */
export async function fetchList(q: ListQuery): Promise<FpResponse | null> {
  const key = `jingles:v2:fp:${q.type}:${q.year}:w${q.week}:${q.position}:${q.scoring}`;
  return cached<FpResponse | null>(key, TTL, async () => {
    const raw = await get(listUrl(q));
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as FpResponse;
      return Array.isArray(parsed?.players) ? parsed : null;
    } catch {
      return null;
    }
  });
}

export interface WeeklyBoard {
  season: string;
  week: number;
  scoring: Exclude<Scoring, "unknown">;
  /** His publish stamp, the newest of the lists that make up this board. */
  publishedAt: string | null;
  /** QB, RB, WR, TE, K, DEF. */
  positional: Record<string, FpRow[]>;
  flex: FpRow[];
  /** His superflex ordering: quarterbacks ranked against everyone else. */
  superflex: FpRow[];
}

/** Kickers and defences are one list each, whatever the league's scoring. */
async function fetchScoringIndependent(
  year: string,
  week: number,
): Promise<{ K: FpRow[]; DEF: FpRow[]; published: string | null }> {
  const [k, dst] = await Promise.all([
    fetchList({ year, week, position: "K", scoring: "HALF", type: "weekly" }),
    fetchList({ year, week, position: "DST", scoring: "HALF", type: "weekly" }),
  ]);
  return {
    K: k ? rowsFrom(k) : [],
    DEF: dst ? rowsFrom(dst) : [],
    published: k?.published ?? dst?.published ?? null,
  };
}

function newest(stamps: (string | null | undefined)[]): string | null {
  const real = stamps.filter((s): s is string => Boolean(s));
  if (real.length === 0) return null;
  return real.sort().slice(-1)[0];
}

/**
 * His whole board for one week in one scoring.
 *
 * Two requests per scoring plus the two shared lists. Returns null when he has
 * not published that week, which is a normal state on a Monday.
 */
export async function fetchWeeklyBoard(
  season: string,
  week: number,
  scoring: Exclude<Scoring, "unknown">,
  shared?: Awaited<ReturnType<typeof fetchScoringIndependent>>,
): Promise<WeeklyBoard | null> {
  const code = SCORING_CODE[scoring];

  const [op, flx, common] = await Promise.all([
    fetchList({ year: season, week, position: "OP", scoring: code, type: "weekly" }),
    fetchList({ year: season, week, position: "FLX", scoring: code, type: "weekly" }),
    shared ? Promise.resolve(shared) : fetchScoringIndependent(season, week),
  ]);

  const superflex = op ? rowsFrom(op) : [];
  const flex = flx ? rowsFrom(flx) : [];

  // Nothing to file. He has not posted this week yet, or the endpoint is down,
  // and those look the same from here on purpose: neither is worth storing.
  if (superflex.length === 0 && flex.length === 0) return null;

  // The positional lists, rebuilt out of the superflex list. Sorted by HIS
  // position rank rather than by superflex order, because they are the same
  // ordering and the position rank is the one the caller asked for.
  const positional: Record<string, FpRow[]> = {};
  for (const row of superflex) {
    (positional[row.position] ??= []).push(row);
  }
  for (const list of Object.values(positional)) {
    list.sort((a, b) => a.positionRank - b.positionRank);
  }
  if (common.K.length) positional.K = common.K;
  if (common.DEF.length) positional.DEF = common.DEF;

  return {
    season,
    week,
    scoring,
    publishedAt: newest([op?.published, flx?.published, common.published]),
    positional,
    flex,
    superflex,
  };
}

/** Every scoring's board for one week, sharing the two lists that do not vary. */
export async function fetchAllWeeklyBoards(
  season: string,
  week: number,
): Promise<WeeklyBoard[]> {
  const shared = await fetchScoringIndependent(season, week);
  const boards = await Promise.all(
    IN_SCORING_ORDER.map((scoring) => fetchWeeklyBoard(season, week, scoring, shared)),
  );
  return boards.filter((b): b is WeeklyBoard => b !== null);
}

export interface SeasonBoard {
  season: string;
  scoring: Exclude<Scoring, "unknown">;
  publishedAt: string | null;
  rows: FpRow[];
}

/**
 * His season-long list, which is what the Lab 300 became.
 *
 * Same endpoint with type=draft. Worth having for the same reason as the weekly
 * board: he now publishes a real full-PPR and a real standard ordering, where
 * the ingested Lab 300 only ever existed in half PPR and everything else read
 * it with an apology attached.
 *
 * ALL, not OP, and the difference is not cosmetic. On the season-long list OP
 * is his SUPERFLEX board: it opens Josh Allen, Lamar Jackson, Drake Maye and
 * drops kickers and defences entirely. ALL is the overall ordering that the Lab
 * 300 was, opening Jahmyr Gibbs and Bijan Robinson. Handing a superflex board
 * to a one-quarterback league would move every passer about thirty picks too
 * high, and nothing downstream would have said a word.
 */
export async function fetchSeasonBoard(
  season: string,
  scoring: Exclude<Scoring, "unknown">,
): Promise<SeasonBoard | null> {
  const res = await fetchList({
    year: season,
    week: 0,
    position: "ALL",
    scoring: SCORING_CODE[scoring],
    type: "draft",
  });
  if (!res) return null;

  const rows = rowsFrom(res);
  if (rows.length === 0) return null;

  return { season, scoring, publishedAt: res.published ?? null, rows };
}
