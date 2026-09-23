import "server-only";
import { getSeasonGames } from "./odds";
import { getPublicPicks } from "./ownership";
import { getInjuries } from "./intel";
import { getPool } from "./state";
import { assembleReport } from "./engine";
import { DEFAULT_POOL_ID, POOLS, poolMeta } from "./pools";
import { fetchPickemBoard } from "./sleeper-pickem";
import { currentWeek as weekOf } from "./engine";
import type { Game, InjuryNote, Ownership, PoolConfig, SurvivorReport } from "./types";

export const SEASON = 2026;

/**
 * Everything the engine needs that is NOT pool-specific: the slate, the public
 * distribution, the injury list. Fetched once however many pools are being
 * reported on, which is the point of splitting it out. Two pools priced off two
 * separate pulls could disagree for a reason that has nothing to do with either
 * pool, and that disagreement would look exactly like a real one.
 */
export interface ReportInputs {
  games: Game[];
  publicByWeek: Record<string, Ownership>;
  publicPulledAt: string;
  injuries: InjuryNote[];
  gamesStale?: boolean;
  gamesAt?: string;
  publicStale?: boolean;
  now?: Date;
}

export async function fetchInputs(): Promise<ReportInputs> {
  const [season, injuries, publicPicks] = await Promise.all([
    getSeasonGames(SEASON),
    getInjuries(),
    getPublicPicks(),
  ]);

  return {
    games: season.games,
    gamesStale: season.stale,
    gamesAt: season.at,
    publicByWeek: publicPicks.byWeek,
    publicPulledAt: publicPicks.pulledAt,
    publicStale: publicPicks.stale,
    injuries,
  };
}

/**
 * One report per pool off one set of inputs. Pure, so pool isolation is
 * testable: a team burned in one pool has to stay on the other's board.
 */
export function reportsFrom(
  inputs: ReportInputs,
  pools: { id: string; pool: PoolConfig }[],
): SurvivorReport[] {
  return pools.map(({ id, pool }) =>
    assembleReport({
      season: SEASON,
      poolId: id,
      games: inputs.games,
      gamesStale: inputs.gamesStale,
      gamesAt: inputs.gamesAt,
      publicByWeek: inputs.publicByWeek,
      publicPulledAt: inputs.publicPulledAt,
      publicStale: inputs.publicStale,
      injuries: inputs.injuries,
      pool,
      now: inputs.now,
    }),
  );
}

/**
 * Every pool's report, sharing one fetch. The page and the Thursday email both
 * read this, so the two cannot drift from each other or from /api/survivor.
 */
export async function buildReports(
  poolIds: string[] = POOLS.map((p) => p.id),
  overrides?: Partial<PoolConfig>,
): Promise<SurvivorReport[]> {
  const ids = poolIds.map((id) => poolMeta(id).id);
  const [inputs, ...pools] = await Promise.all([
    fetchInputs(),
    ...ids.map((id) => getPool(SEASON, id)),
  ]);

  const week = weekOf(inputs.games, inputs.now);

  // A pool that can be read is read, every time, rather than kept in step by
  // hand. The rows are not stored: they are the pool's own state and Sleeper
  // is where it lives, so copying them into our config would only create a
  // second version to go stale.
  const boards = await Promise.all(
    ids.map(async (id, i) => {
      const leagueId = { ...pools[i], ...overrides }.sleeperLeagueId;
      if (!leagueId) return null;
      return fetchPickemBoard(leagueId);
    }),
  );

  return reportsFrom(
    inputs,
    ids.map((id, i) => {
      const pool = { ...pools[i], ...overrides };
      const board = boards[i];
      if (!board) return { id, pool };
      return {
        id,
        pool: {
          ...pool,
          entries: board.entries,
          entriesWeek: week,
          entriesSource: "sleeper" as const,
          entriesAlive: board.alive,
          entriesAliveWeek: week,
        },
      };
    }),
  );
}

/** One pool's report. Defaults to the main pool, as every caller did before. */
export async function buildReport(
  poolId: string = DEFAULT_POOL_ID,
  overrides?: Partial<PoolConfig>,
): Promise<SurvivorReport> {
  const [report] = await buildReports([poolId], overrides);
  return report;
}

export { currentWeek, resolveCompleted } from "./engine";
