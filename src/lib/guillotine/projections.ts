import "server-only";
import { cached } from "@/lib/redis/cached";
import { redis } from "@/lib/redis/client";
import { scoreStatLine, type ScoringSettings } from "./scoring";

// Sleeper's projection feed, scored under one league's settings.
//
// The raw feed is large (every player, every stat, a few megabytes a week) and
// the useful part of it is one number per player. So the cache holds the scored
// result keyed by league and week rather than the feed itself: a payload small
// enough to store, and one that cannot go stale against a scoring change
// because the scoring is baked into the key's meaning.

const PROJECTION_BASE = "https://api.sleeper.app/projections/nfl";

/** Positions this app ever starts. Kickers and defences are excluded upstream. */
const POSITIONS = ["QB", "RB", "WR", "TE"];

const TTL_WEEK = 6 * 60 * 60;
const TTL_SEASON = 24 * 60 * 60;

interface RawProjectionRow {
  player_id?: string;
  week?: number;
  team?: string | null;
  opponent?: string | null;
  stats?: Record<string, number>;
  player?: {
    first_name?: string;
    last_name?: string;
    position?: string | null;
    team?: string | null;
    injury_status?: string | null;
  };
}

export interface ProjectedPlayer {
  playerId: string;
  name: string;
  position: string;
  team: string | null;
  points: number;
  injuryStatus: string | null;
}

export type ProjectionsByPlayer = Record<string, ProjectedPlayer>;

function positionQuery(): string {
  return POSITIONS.map((p) => `position[]=${p}`).join("&");
}

async function fetchRows(path: string): Promise<RawProjectionRow[]> {
  const res = await fetch(`${PROJECTION_BASE}${path}`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Sleeper projections failed: ${res.status} ${res.statusText} (${path})`);
  }
  return (await res.json()) as RawProjectionRow[];
}

function toProjected(row: RawProjectionRow, scoring: ScoringSettings): ProjectedPlayer | null {
  const playerId = row.player_id;
  const position = row.player?.position ?? null;
  if (!playerId || !position || !POSITIONS.includes(position)) return null;

  const name = [row.player?.first_name, row.player?.last_name].filter(Boolean).join(" ").trim();

  return {
    playerId,
    name: name || playerId,
    position,
    team: row.player?.team ?? row.team ?? null,
    points: scoreStatLine(row.stats ?? {}, scoring),
    // Sleeper reports "Active" as a status on plenty of healthy players; only a
    // status worth acting on is worth carrying into the report.
    injuryStatus:
      row.player?.injury_status && row.player.injury_status !== "Active"
        ? row.player.injury_status
        : null,
  };
}

/**
 * Drop every cached week projection.
 *
 * This is the only live source of a player's injury status in the app, which
 * is not obvious and was worth finding out: getAllPlayers is slimmed and drops
 * injury_status entirely, so the lineup's status field falls through to this
 * feed. At a six hour TTL a player ruled out at 11:30 on a Sunday would still
 * read as questionable at kickoff, and the alarm built to catch exactly that
 * would say nothing.
 *
 * Scanned rather than keyed, because the caller knows neither which leagues
 * nor which week are cached, and the keyspace here is a handful of entries.
 */
export async function revalidateProjections(): Promise<number> {
  let cursor = "0";
  let dropped = 0;
  do {
    const [next, keys] = await redis.scan(cursor, {
      match: "guillotine:v1:proj:*",
      count: 200,
    });
    cursor = String(next);
    if (keys.length > 0) {
      await redis.del(...keys);
      dropped += keys.length;
    }
  } while (cursor !== "0");
  return dropped;
}

/** Projected points for one week, scored under this league's settings. */
export function getWeekProjections(
  leagueId: string,
  season: string,
  week: number,
  scoring: ScoringSettings,
): Promise<ProjectionsByPlayer> {
  return cached(
    `guillotine:v1:proj:${leagueId}:${season}:w${week}`,
    TTL_WEEK,
    async () => {
      const rows = await fetchRows(
        `/${season}/${week}?season_type=regular&${positionQuery()}`,
      );
      const out: ProjectionsByPlayer = {};
      for (const row of rows) {
        const p = toProjected(row, scoring);
        if (p) out[p.playerId] = p;
      }
      return out;
    },
  );
}

/**
 * Season-long projections divided by the season's length, giving a points per
 * week rate. Used for "would this player still start in the endgame", which is
 * a question about a player's level rather than about one matchup.
 */
export function getSeasonRates(
  leagueId: string,
  season: string,
  scoring: ScoringSettings,
): Promise<ProjectionsByPlayer> {
  return cached(
    `guillotine:v1:rate:${leagueId}:${season}`,
    TTL_SEASON,
    async () => {
      const rows = await fetchRows(`/${season}?season_type=regular&${positionQuery()}`);
      const out: ProjectionsByPlayer = {};
      for (const row of rows) {
        const p = toProjected(row, scoring);
        if (p) out[p.playerId] = { ...p, points: p.points / REGULAR_SEASON_WEEKS };
      }
      return out;
    },
  );
}

const REGULAR_SEASON_WEEKS = 17;

/** How many weeks ahead byes are worth knowing about. */
const BYE_LOOKAHEAD = 3;

/**
 * Bye weeks by NFL team, derived rather than hardcoded.
 *
 * A team on bye has no projected players that week, so the weeks a team is
 * missing from the feed are its byes. This costs a few extra fetches and is
 * worth it: a hardcoded bye table is wrong every season, and silently.
 */
export function getByeWeeks(
  leagueId: string,
  season: string,
  fromWeek: number,
  scoring: ScoringSettings,
): Promise<Record<string, number>> {
  return cached(
    `guillotine:v1:byes:${leagueId}:${season}:from${fromWeek}`,
    TTL_WEEK,
    async () => {
      const weeks = Array.from({ length: BYE_LOOKAHEAD }, (_, i) => fromWeek + i + 1).filter(
        (w) => w <= REGULAR_SEASON_WEEKS,
      );

      const perWeek = await Promise.all(
        weeks.map(async (week) => {
          const projections = await getWeekProjections(leagueId, season, week, scoring);
          const teams = new Set<string>();
          for (const p of Object.values(projections)) {
            if (p.team) teams.add(p.team);
          }
          return { week, teams };
        }),
      );

      // A team present in some lookahead week but absent from another is on bye
      // in the week it is missing. Teams absent from all of them are not on
      // bye, they are outside the horizon.
      const everSeen = new Set<string>();
      for (const { teams } of perWeek) {
        for (const t of teams) everSeen.add(t);
      }

      const byes: Record<string, number> = {};
      for (const team of everSeen) {
        const missing = perWeek.find(({ teams }) => !teams.has(team));
        if (missing) byes[team] = missing.week;
      }
      return byes;
    },
  );
}
