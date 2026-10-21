import "server-only";
import { redis } from "@/lib/redis/client";
import { cachedWithFallback } from "@/lib/redis/cached";
import { getSeasonGames } from "@/lib/survivor/odds";
import { getLegPicks } from "@/lib/survivor/sleeper-pool";
import { SEASON } from "@/lib/survivor/report";
import { getPicksCore } from "./report";
import { tiebreakTotal, entryRecords, estimatedPublicHome, gradeTeams, optimizeStandings, type EntryWeek, type LiveGame, type Rival, optimizePool, type EntryPick, type PoolGame, type PoolResult } from "./pool";

// Jack's Sleeper "Weekly payout" pick'em: straight up, no spread, no
// confidence points, a winner each week (ties go to a tiebreaker). Its
// league id is public (it is in the pool's URL); nothing here is a secret.
//
// Inputs, each with its provenance on the page:
//   entrants: entries that scored last week (the rest don't pick);
//   win odds: the market's no-vig moneyline (ESPN), games not yet started;
//   field: the pool's real pick shares when Sleeper lets us read them,
//   otherwise an estimate (people back favorites harder than the odds);
//   tiebreaker: the average of Sam's and David's totals for the week's last
//   game (Jack, 2026-10-17), the market total beside it.

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
  tiebreaker: ({ game: string } & NonNullable<ReturnType<typeof tiebreakTotal>>) | null;
  started: number;
  /** Mid-week: the entry was solved from the real scores and picks so far. */
  standings?: { mine: number; leader: number; rivals: number };
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
async function fieldPicks(
  week: number,
): Promise<{ entries: number; teamShare: Map<string, number>; byEntry: Map<string, Set<string>>; note: string } | null> {
  const res = await getLegPicks(POOL.leagueId, `v1:regular:${week}`, true);
  if (!res.ok) return null;
  const perGame = new Map<string, Map<string, number>>();
  const byEntry = new Map<string, Set<string>>();
  let entries = 0;
  for (const [id, e] of Object.entries(res.data ?? {})) {
    const picks = (e as { picks?: Record<string, { team?: string }> } | null)?.picks ?? {};
    const list = Object.entries(picks);
    byEntry.set(id, new Set(list.flatMap(([, p]) => (p?.team ? [canon(p.team)] : []))));
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
  return { entries, teamShare, byEntry, note: `${entries} entries' real picks for this week` };
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
  // Once a game has started, solve from the real board: everyone's correct
  // picks so far and their actual picks on what's left. Otherwise the entry
  // would re-solve the remaining games as if the week started from zero.
  const live = slate.length > open.length && field ? await standingsInput(slate, games, field.byEntry, now) : null;
  const solved = live ? optimizeStandings(live.games, live.myBase, live.rivals) : null;
  const result = solved
    ? { ...solved, picks: solved.picks.filter((_, i) => !live!.games[i].locked) }
    : optimizePool(games, n);
  const at = new Date().toISOString();
  await saveEntry(week, entryRecords(games, result.picks, at, canon));
  const last = slate.slice().sort((a, b) => b.kickoff.localeCompare(a.kickoff))[0];
  const core = last ? await getPicksCore("nfl").catch(() => null) : null;
  const row = core?.value?.rows.find((r) => canon(r.home) === canon(last.home) && canon(r.away) === canon(last.away));
  const tb = last ? tiebreakTotal(row ? { sam: row.samTotal, david: row.davidTotal } : null, last.overUnder ?? null) : null;
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
    tiebreaker: tb ? { game: `${last.away} at ${last.home}`, ...tb } : null,
    started: slate.length - open.length,
    ...(live ? { standings: { mine: live.myBase, leader: live.leader, rivals: live.rivals.length } } : {}),
    at,
  };
}

/** Fifteen minutes fresh; the simulation takes a second or two. */
export function getPoolView() {
  return cachedWithFallback<PoolView | null>({
    key: `picks:v3:pool:${POOL.leagueId}`,
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
    key: `picks:v3:pool:${POOL.leagueId}:shares:w${week}`,
    ttlSeconds: 15 * 60,
    fetcher: async () => {
      const f = await fieldPicks(week);
      return f ? { entries: f.entries, shares: Object.fromEntries(f.teamShare) } : null;
    },
    isComplete: (v) => !!v && v.entries > 0,
    empty: null,
  });
}

/**
 * The entry's pick per game, saved on every refresh until kickoff, so a
 * finished game can be graded on what the entry said. Kept for a season.
 */
const ENTRY_KEY = (week: number) => `picks:v3:pool:${POOL.leagueId}:entry:w${week}`;

async function saveEntry(week: number, picks: Record<string, EntryPick>): Promise<void> {
  if (!Object.keys(picks).length) return;
  try {
    await redis.hset(ENTRY_KEY(week), picks);
    await redis.expire(ENTRY_KEY(week), 200 * 24 * 3600);
  } catch (e) {
    // Grading the entry is a nice-to-have; the entry itself still shows.
    console.warn(`[pool] entry save failed: ${e instanceof Error ? e.message : e}`);
  }
}

/** The saved entry picks for a week, keyed "AWAY@HOME" (Sleeper spelling). */
export async function getPoolEntry(week: number): Promise<Record<string, EntryPick>> {
  return ((await redis.hgetall<Record<string, EntryPick>>(ENTRY_KEY(week))) ?? {}) as Record<string, EntryPick>;
}

export interface PoolWeek {
  week: number;
  /** Jack's real picks from Sleeper, graded from finals. */
  you: EntryWeek | null;
  /** The app's entry, as saved before each kickoff (from Oct 12). */
  entry: EntryWeek | null;
  /** The pool's top score once Sleeper has scored the week. */
  poolBest: number | null;
  /** Jack's place that week (1 = won), once scored. */
  rank: number | null;
}

export interface PoolTrack {
  weeks: PoolWeek[];
  you: { w: number; l: number };
  entry: { w: number; l: number };
}

type PoolRoster = { roster_id?: number; owner_id?: string | null; metadata?: { points_by_leg?: Record<string, number> } };

/** Jack's roster in the pool, found from SLEEPER_USERNAME. */
async function myRosterId(rosters: PoolRoster[]): Promise<string | null> {
  const username = process.env.SLEEPER_USERNAME;
  if (!username) return null;
  const user = await json<{ user_id?: string }>(`https://api.sleeper.app/v1/user/${username}`).catch(() => null);
  const mine = rosters.find((r) => user?.user_id && r.owner_id === user.user_id);
  return mine?.roster_id != null ? String(mine.roster_id) : null;
}

async function buildPoolTrack(): Promise<PoolTrack> {
  const season = await getSeasonGames(SEASON);
  const weeks = [...new Set(season.games.filter((g) => g.completed).map((g) => g.week))].sort((a, b) => a - b);
  const rosters = await json<PoolRoster[]>(`${BASE}/${POOL.leagueId}/rosters`).catch(() => [] as PoolRoster[]);
  const me = await myRosterId(rosters);

  const yours = new Map<number, Set<string>>();
  const entries = new Map<number, Set<string>>();
  await Promise.all(
    weeks.map(async (w) => {
      const e = await getPoolEntry(w).catch(() => ({}) as Record<string, EntryPick>);
      if (Object.keys(e).length) entries.set(w, new Set(Object.values(e).map((p) => p.team)));
      if (!me) return;
      const res = await getLegPicks(POOL.leagueId, `v1:regular:${w}`, true).catch(() => null);
      const picks = res?.ok ? (res.data?.[me] as { picks?: Record<string, { team?: string }> } | undefined)?.picks : undefined;
      const teams = Object.values(picks ?? {}).flatMap((p) => (p?.team ? [canon(p.team)] : []));
      if (teams.length) yours.set(w, new Set(teams));
    }),
  );
  const you = new Map(gradeTeams(yours, season.games, canon).map((x) => [x.week, x]));
  const entry = new Map(gradeTeams(entries, season.games, canon).map((x) => [x.week, x]));

  const scored = (week: number) =>
    rosters.flatMap((r) => {
      const v = r.metadata?.points_by_leg?.[`v1:regular:${week}`];
      return typeof v === "number" ? [{ id: String(r.roster_id), v }] : [];
    });
  const out: PoolWeek[] = weeks
    .filter((w) => you.has(w) || entry.has(w))
    .map((w) => {
      const pts = scored(w);
      const mine = pts.find((p) => p.id === me);
      return {
        week: w,
        you: you.get(w) ?? null,
        entry: entry.get(w) ?? null,
        poolBest: pts.length ? Math.max(...pts.map((p) => p.v)) : null,
        rank: mine ? 1 + pts.filter((p) => p.v > mine.v).length : null,
      };
    });
  const sum = (k: "you" | "entry") => out.reduce((t, x) => ({ w: t.w + (x[k]?.w ?? 0), l: t.l + (x[k]?.l ?? 0) }), { w: 0, l: 0 });
  return { weeks: out, you: sum("you"), entry: sum("entry") };
}

/**
 * Background check on the pool strategy: Jack's real picks and the app's
 * saved entry, graded each week, beside the pool's winning score. Fifteen
 * minutes fresh.
 */
export function getPoolTrack() {
  return cachedWithFallback<PoolTrack | null>({
    key: `picks:v3:pool:${POOL.leagueId}:track`,
    ttlSeconds: 15 * 60,
    fetcher: buildPoolTrack,
    isComplete: (v) => !!v,
    empty: null,
  });
}

type SlateGame = Awaited<ReturnType<typeof getSeasonGames>>["games"][number];

/**
 * The mid-week board for `optimizeStandings`: games not yet final (started
 * ones locked to Jack's pick), Jack's correct picks so far, and every other
 * entry that has picked this week with its score and its picks. Null when
 * Jack's entry can't be found (then the plain solver runs).
 */
async function standingsInput(slate: SlateGame[], open: PoolGame[], byEntry: Map<string, Set<string>>, now: number) {
  const rosters = await json<PoolRoster[]>(`${BASE}/${POOL.leagueId}/rosters`).catch(() => [] as PoolRoster[]);
  const me = await myRosterId(rosters);
  if (!me) return null;
  const mine = byEntry.get(me) ?? new Set<string>();
  const done = slate.filter((g) => g.completed && g.homeScore != null && g.awayScore != null && g.homeScore !== g.awayScore);
  const winners = new Set(done.map((g) => canon(g.homeScore! > g.awayScore! ? g.home : g.away)));
  const score = (teams: Set<string>) => [...teams].filter((x) => winners.has(x)).length;
  const openKeys = new Set(open.map((g) => g.key));
  const inPlay = slate
    .filter((g) => !g.completed && !openKeys.has(`${g.away}@${g.home}`) && new Date(g.kickoff).getTime() <= now)
    .map((g) => ({ g, locked: true }));
  const pickOf = (teams: Set<string>, home: string, away: string): "home" | "away" | null => (teams.has(canon(home)) ? "home" : teams.has(canon(away)) ? "away" : null);
  const games: LiveGame[] = [
    ...inPlay.map(({ g }) => ({
      key: `${g.away}@${g.home}`,
      home: g.home,
      away: g.away,
      pHome: g.homeWinProb,
      publicHome: 0.5,
      locked: true,
      mine: pickOf(mine, g.home, g.away),
    })),
    ...open,
  ];
  const rivals: Rival[] = [...byEntry.entries()]
    .filter(([id, teams]) => id !== me && teams.size > 0)
    .map(([, teams]) => ({
      base: score(teams),
      picks: games.map((g) => pickOf(teams, g.home, g.away) ?? (g.locked ? "none" : null)),
    }));
  const myBase = score(mine);
  return { games, myBase, rivals, leader: Math.max(myBase, ...rivals.map((r) => r.base)) };
}
