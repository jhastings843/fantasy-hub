import "server-only";
import { cachedWithFallback } from "@/lib/redis/cached";
import { getSeasonGames } from "@/lib/survivor/odds";
import { getLegPicks } from "@/lib/survivor/sleeper-pool";
import { SEASON } from "@/lib/survivor/report";
import { estimatedPublicHome, optimizePool, type PoolGame, type PoolResult } from "./pool";

// Jack's Sleeper "Weekly payout" pick'em: straight up, no spread, no
// confidence points, a winner each week (ties go to a tiebreaker). Its
// league id is public (it is in the pool's URL); nothing here is a secret.
//
// Inputs, each with its provenance on the page:
//   entrants: entries that scored last week (the rest don't pick);
//   win odds: the market's no-vig moneyline (ESPN), games not yet started;
//   field: the pool's real pick shares when Sleeper lets us read them,
//   otherwise an estimate (people back favorites harder than the odds);
//   tiebreaker: the market total of the week's last game.

export const POOL = { leagueId: "1407350265954263040", name: "Weekly payout" } as const;
const BASE = "https://api.sleeper.app/v1/league";

export interface PoolView {
  week: number;
  name: string;
  entrants: number;
  entrantsSource: string;
  fieldSource: "actual" | "estimate";
  fieldNote: string;
  games: (PoolGame & { pick: "home" | "away" })[];
  result: PoolResult;
  tiebreaker: { game: string; total: number } | null;
  started: number;
  at: string;
}

async function json<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Sleeper answered ${res.status}`);
  return (await res.json()) as T;
}

/** Sleeper and ESPN spell a few teams differently. */
const CANON: { [abbr: string]: string } = { WSH: "WAS", LA: "LAR", JAC: "JAX" };
export const canon = (t: string) => CANON[t.toUpperCase()] ?? t.toUpperCase();

/**
 * The field's real picks for a week: per entry, { picks: { gameId: { team } } }.
 * Returns how many entries have picked, and each team's share of the picks
 * on its game (matched to our games by the team picked).
 */
async function fieldPicks(week: number): Promise<{ entries: number; teamShare: Map<string, number>; note: string } | null> {
  const res = await getLegPicks(POOL.leagueId, `v1:regular:${week}`, true);
  if (!res.ok) return null;
  const perGame = new Map<string, Map<string, number>>();
  let entries = 0;
  for (const e of Object.values(res.data ?? {})) {
    const picks = (e as { picks?: Record<string, { team?: string }> } | null)?.picks ?? {};
    const list = Object.entries(picks);
    if (!list.length) continue;
    entries++;
    for (const [gameId, p] of list) {
      if (!p?.team) continue;
      const m = perGame.get(gameId) ?? new Map<string, number>();
      m.set(canon(p.team), (m.get(canon(p.team)) ?? 0) + 1);
      perGame.set(gameId, m);
    }
  }
  if (!entries) return null;
  const teamShare = new Map<string, number>();
  for (const m of perGame.values()) {
    const n = [...m.values()].reduce((a, b) => a + b, 0);
    for (const [team, c] of m) teamShare.set(team, c / n);
  }
  return { entries, teamShare, note: `${entries} entries' real picks for this week` };
}

/**
 * When a game's picks aren't visible, the field is estimated from the market
 * with this lean, fitted to this pool's real picks on 30 games from Weeks 3
 * and 4 (2026-10-09): the pool backs favorites far harder than the odds
 * (a 70% favorite draws about 90-100% of the picks).
 */
export const FITTED_LEAN = 2.7;

export async function buildPoolView(): Promise<PoolView | null> {
  const league = await json<{ metadata?: { current_pickem_leg_id?: string; latest_report_leg_id?: string } }>(`${BASE}/${POOL.leagueId}`);
  const week = Number((league.metadata?.current_pickem_leg_id ?? "").split(":").pop());
  if (!Number.isFinite(week) || week <= 0) return null;
  const rosters = await json<{ metadata?: { points_by_leg?: Record<string, number> } }[]>(`${BASE}/${POOL.leagueId}/rosters`);
  const lastLeg = league.metadata?.latest_report_leg_id;
  const active = lastLeg ? rosters.filter((r) => (r.metadata?.points_by_leg?.[lastLeg] ?? 0) > 0).length : 0;
  const entrants = active || rosters.length;

  const season = await getSeasonGames(SEASON);
  const now = Date.now();
  const slate = season.games.filter((g) => g.week === week);
  const open = slate.filter((g) => !g.completed && new Date(g.kickoff).getTime() > now);
  if (!open.length) return null;

  const field = await fieldPicks(week).catch(() => null);
  let realGames = 0;
  const games: PoolGame[] = open
    .sort((a, b) => a.kickoff.localeCompare(b.kickoff))
    .map((g) => {
      const h = field?.teamShare.get(canon(g.home));
      const a = field?.teamShare.get(canon(g.away));
      const real = h !== undefined ? h : a !== undefined ? 1 - a : null;
      if (real !== null) realGames++;
      return { key: `${g.away}@${g.home}`, home: g.home, away: g.away, pHome: g.homeWinProb, publicHome: real ?? estimatedPublicHome(g.homeWinProb, FITTED_LEAN), kickoff: g.kickoff };
    });
  // Who is actually playing: this week's pickers if visible and not fewer than last week's scorers.
  const n = Math.max(field?.entries ?? 0, entrants);
  const result = optimizePool(games, n);
  const last = slate.slice().sort((a, b) => b.kickoff.localeCompare(a.kickoff))[0];
  return {
    week,
    name: POOL.name,
    entrants: n,
    entrantsSource: field && field.entries >= entrants ? `entries that have picked Week ${week} so far` : active ? `entries that scored in Week ${Number(lastLeg!.split(":").pop())}` : "all entries",
    fieldSource: realGames === games.length ? "actual" : "estimate",
    fieldNote: field
      ? `real picks from ${field.entries} entries on ${realGames} of ${games.length} games${realGames < games.length ? `; the rest estimated from this pool's habit of backing favorites (lean ${FITTED_LEAN}, fitted on Weeks 3-4)` : ""}`
      : `this week's picks aren't visible yet; estimated from this pool's habit of backing favorites (lean ${FITTED_LEAN}, fitted on Weeks 3-4)`,
    games: games.map((g, i) => ({ ...g, pick: result.picks[i] })),
    result,
    tiebreaker: last?.overUnder != null ? { game: `${last.away} at ${last.home}`, total: Math.round(last.overUnder) } : null,
    started: slate.length - open.length,
    at: new Date().toISOString(),
  };
}

/** Fifteen minutes fresh; the simulation takes a second or two. */
export function getPoolView() {
  return cachedWithFallback<PoolView | null>({
    key: `picks:v2:pool:${POOL.leagueId}`,
    ttlSeconds: 15 * 60,
    fetcher: buildPoolView,
    isComplete: (v) => !!v && v.games.length > 0,
    empty: null,
  });
}

/**
 * The pool's pick share for every team this week, games played included, so
 * a finished game can show how much of the pool was on the winner. Real picks
 * only (null when Sleeper won't show them). Fifteen minutes fresh.
 */
export function getPoolShares(week: number) {
  return cachedWithFallback<{ entries: number; shares: Record<string, number> } | null>({
    key: `picks:v2:pool:${POOL.leagueId}:shares:w${week}`,
    ttlSeconds: 15 * 60,
    fetcher: async () => {
      const f = await fieldPicks(week);
      return f ? { entries: f.entries, shares: Object.fromEntries(f.teamShare) } : null;
    },
    isComplete: (v) => !!v && v.entries > 0,
    empty: null,
  });
}
