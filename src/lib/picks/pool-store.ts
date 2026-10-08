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

/** Real pick shares per game key ("AWAY@HOME"), when Sleeper serves them; null when it won't. */
async function fieldShares(week: number): Promise<{ shares: Map<string, number> | null; note: string }> {
  const res = await getLegPicks(POOL.leagueId, `v1:regular:${week}`);
  if (!res.ok) return { shares: null, note: `Sleeper won't share the pool's picks (${res.error})` };
  // Shape: { [rosterOrUser]: { [gameOrMatchup]: "TEAM" } } or arrays of picks. Read loosely.
  const counts = new Map<string, Map<string, number>>();
  const add = (game: string, team: string) => {
    const m = counts.get(game) ?? new Map<string, number>();
    m.set(team, (m.get(team) ?? 0) + 1);
    counts.set(game, m);
  };
  for (const entry of Object.values(res.data ?? {})) {
    if (entry && typeof entry === "object") {
      for (const [game, pick] of Object.entries(entry as Record<string, unknown>)) {
        const team = typeof pick === "string" ? pick : Array.isArray(pick) ? String(pick[0] ?? "") : typeof pick === "object" && pick ? String((pick as { pick?: unknown; team?: unknown }).pick ?? (pick as { team?: unknown }).team ?? "") : "";
        if (team) add(game, team.toUpperCase());
      }
    }
  }
  if (!counts.size) return { shares: null, note: "Sleeper returned no picks for this week yet (they may stay hidden until each game locks)" };
  const shares = new Map<string, number>();
  for (const [game, m] of counts) {
    const total = [...m.values()].reduce((a, b) => a + b, 0);
    for (const [team, n] of m) shares.set(`${game}|${team}`, n / total);
  }
  return { shares, note: `Real picks from ${Object.keys(res.data ?? {}).length} entries` };
}

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

  const field = await fieldShares(week);
  const games: PoolGame[] = open
    .sort((a, b) => a.kickoff.localeCompare(b.kickoff))
    .map((g) => {
      const real = field.shares?.get(`${g.away}@${g.home}|${g.home}`) ?? null;
      return { key: `${g.away}@${g.home}`, home: g.home, away: g.away, pHome: g.homeWinProb, publicHome: real ?? estimatedPublicHome(g.homeWinProb), kickoff: g.kickoff };
    });
  const result = optimizePool(games, entrants);
  const last = slate.slice().sort((a, b) => b.kickoff.localeCompare(a.kickoff))[0];
  return {
    week,
    name: POOL.name,
    entrants,
    entrantsSource: active ? `entries that scored in Week ${Number(lastLeg!.split(":").pop())}` : "all entries",
    fieldSource: field.shares ? "actual" : "estimate",
    fieldNote: field.shares ? field.note : `${field.note}; using an estimate: the field backs favorites harder than the odds`,
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
