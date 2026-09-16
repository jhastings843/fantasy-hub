import "server-only";
import { cached, invalidate } from "@/lib/redis/cached";
import type {
  SleeperDraft,
  SleeperDraftPick,
  SleeperLeague,
  SleeperMatchup,
  SleeperPlayer,
  SleeperPlayersById,
  SleeperRoster,
  SleeperTradedPick,
  SleeperUser,
} from "./types";

const SLEEPER_BASE = "https://api.sleeper.app/v1";

const KEY = {
  league: (id: string) => `sleeper:v1:league:${id}`,
  rosters: (id: string) => `sleeper:v3:league:${id}:rosters`,
  users: (id: string) => `sleeper:v1:league:${id}:users`,
  user: (u: string) => `sleeper:v1:user:${u}`,
  playersSlim: () => `sleeper:v2:players:nfl:slim`,
  drafts: (id: string) => `sleeper:v1:league:${id}:drafts`,
  draft: (id: string) => `sleeper:v2:draft:${id}`,
  draftPicks: (id: string) => `sleeper:v1:draft:${id}:picks`,
  tradedPicks: (id: string) => `sleeper:v2:league:${id}:traded_picks`,
  userLeagues: (userId: string, season: string) =>
    `sleeper:v1:user:${userId}:leagues:nfl:${season}`,
  nflState: () => `sleeper:v1:state:nfl`,
  matchups: (id: string, week: number) => `sleeper:v1:league:${id}:matchups:w${week}`,
};

// TTLs are aggressive on anything that responds to live league
// activity (rosters, draft state, traded picks). Slow-moving lookups
// (league settings, NFL player metadata) keep longer windows since
// they barely change between sessions.
const TTL = {
  league: 12 * 60 * 60,
  // Rosters change with every add/drop, trade, and draft pick — keep
  // it fresh enough that a refresh isn't strictly required after most
  // league actions.
  rosters: 5 * 60,
  users: 24 * 60 * 60,
  user: 24 * 60 * 60,
  playersSlim: 24 * 60 * 60,
  drafts: 60 * 60,
  // Draft state (picks board cursor, status) updates during a live draft.
  draft: 15 * 60,
  // Per-pick rows update in real-time during the draft itself.
  draftPicks: 60,
  // Traded picks change at trade events; tighter so post-trade UIs
  // catch up without manual refresh.
  tradedPicks: 60 * 60,
  userLeagues: 6 * 60 * 60,
  // The NFL week only turns over once a week, but a stale week number would
  // point every projection lookup at the wrong slate, so this stays short.
  nflState: 30 * 60,
  // Only completed weeks are read, and those change only on a stat
  // correction, which the NFL issues within a day or two of the game.
  matchups: 60 * 60,
};

async function sleeperFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${SLEEPER_BASE}${path}`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Sleeper request failed: ${res.status} ${res.statusText} (${path})`);
  }
  return (await res.json()) as T;
}

export function getLeague(leagueId: string): Promise<SleeperLeague> {
  return cached(KEY.league(leagueId), TTL.league, () =>
    sleeperFetch<SleeperLeague>(`/league/${leagueId}`),
  );
}

export function getLeagueRosters(leagueId: string): Promise<SleeperRoster[]> {
  return cached(KEY.rosters(leagueId), TTL.rosters, () =>
    sleeperFetch<SleeperRoster[]>(`/league/${leagueId}/rosters`),
  );
}

export function getLeagueUsers(leagueId: string): Promise<SleeperUser[]> {
  return cached(KEY.users(leagueId), TTL.users, () =>
    sleeperFetch<SleeperUser[]>(`/league/${leagueId}/users`),
  );
}

export function getUser(usernameOrId: string): Promise<SleeperUser> {
  return cached(KEY.user(usernameOrId), TTL.user, () =>
    sleeperFetch<SleeperUser>(`/user/${usernameOrId}`),
  );
}

type RawPlayer = Partial<SleeperPlayer> & Record<string, unknown>;

function slimPlayer(raw: RawPlayer): SleeperPlayer {
  return {
    player_id: String(raw.player_id ?? ""),
    full_name: typeof raw.full_name === "string" ? raw.full_name : undefined,
    first_name: typeof raw.first_name === "string" ? raw.first_name : undefined,
    last_name: typeof raw.last_name === "string" ? raw.last_name : undefined,
    position: typeof raw.position === "string" ? raw.position : null,
    team: typeof raw.team === "string" ? raw.team : null,
    age: typeof raw.age === "number" ? raw.age : null,
    status: typeof raw.status === "string" ? raw.status : null,
    fantasy_positions: Array.isArray(raw.fantasy_positions)
      ? (raw.fantasy_positions as string[])
      : null,
    years_exp:
      typeof raw.years_exp === "number" ? raw.years_exp : null,
  };
}

function slimAllPlayers(raw: Record<string, RawPlayer>): SleeperPlayersById {
  const out: SleeperPlayersById = {};
  for (const [id, p] of Object.entries(raw)) {
    if (!p || typeof p !== "object") continue;
    if (!p.position && !Array.isArray(p.fantasy_positions)) continue;
    out[id] = slimPlayer(p);
  }
  return out;
}

export function getAllPlayers(): Promise<SleeperPlayersById> {
  return cached(KEY.playersSlim(), TTL.playersSlim, async () => {
    const raw = await sleeperFetch<Record<string, RawPlayer>>(`/players/nfl`);
    return slimAllPlayers(raw);
  });
}

export async function revalidateLeague(leagueId: string): Promise<void> {
  await invalidate(
    KEY.league(leagueId),
    KEY.rosters(leagueId),
    KEY.users(leagueId),
    KEY.tradedPicks(leagueId),
    // The drafts list carries draft_order and start time. A commissioner who
    // sets the order an hour before the draft should show up on refresh, not
    // whenever the list's own TTL happens to lapse.
    KEY.drafts(leagueId),
  );
}

export async function revalidateAllPlayers(): Promise<void> {
  await invalidate(KEY.playersSlim());
}

/**
 * Drops the cached league list for an account. Without this, joining a league
 * leaves it invisible for up to the userLeagues TTL, since every page reads the
 * list through the cache and Sleeper is never asked again.
 */
export async function revalidateUserLeagues(
  userId: string,
  season: string,
): Promise<void> {
  await invalidate(KEY.userLeagues(userId, season));
}

// --- Drafts ---

export function getLeagueDrafts(leagueId: string): Promise<SleeperDraft[]> {
  return cached(KEY.drafts(leagueId), TTL.drafts, () =>
    sleeperFetch<SleeperDraft[]>(`/league/${leagueId}/drafts`),
  );
}

export function getDraft(draftId: string): Promise<SleeperDraft> {
  return cached(KEY.draft(draftId), TTL.draft, () =>
    sleeperFetch<SleeperDraft>(`/draft/${draftId}`),
  );
}

export function getDraftPicks(draftId: string): Promise<SleeperDraftPick[]> {
  return cached(KEY.draftPicks(draftId), TTL.draftPicks, () =>
    sleeperFetch<SleeperDraftPick[]>(`/draft/${draftId}/picks`),
  );
}

export async function revalidateDraft(draftId: string): Promise<void> {
  await invalidate(KEY.draft(draftId), KEY.draftPicks(draftId));
}

export function getTradedPicks(
  leagueId: string,
): Promise<SleeperTradedPick[]> {
  return cached(KEY.tradedPicks(leagueId), TTL.tradedPicks, () =>
    sleeperFetch<SleeperTradedPick[]>(`/league/${leagueId}/traded_picks`),
  );
}

export function getUserLeagues(
  userId: string,
  season: string,
): Promise<SleeperLeague[]> {
  return cached(KEY.userLeagues(userId, season), TTL.userLeagues, () =>
    sleeperFetch<SleeperLeague[]>(`/user/${userId}/leagues/nfl/${season}`),
  );
}

export interface SleeperNflState {
  week: number;
  season: string;
  season_type: string;
  display_week?: number;
  season_start_date?: string;
}

/** The current NFL week and season, straight from Sleeper. */
export function getNflState(): Promise<SleeperNflState> {
  return cached(KEY.nflState(), TTL.nflState, () =>
    sleeperFetch<SleeperNflState>(`/state/nfl`),
  );
}

/** Every roster's score for one week. Sleeper returns [] for a week not yet played. */
export function getLeagueMatchups(
  leagueId: string,
  week: number,
): Promise<SleeperMatchup[]> {
  return cached(KEY.matchups(leagueId, week), TTL.matchups, () =>
    sleeperFetch<SleeperMatchup[]>(`/league/${leagueId}/matchups/${week}`),
  );
}
