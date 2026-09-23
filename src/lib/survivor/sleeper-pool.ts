import "server-only";

// Sleeper's survivor pools, through the API its own app uses.
//
// There is no documented endpoint for this. The public v1 API covers leagues,
// rosters, matchups and drafts, and returns 404 for anything pool shaped. What
// the app itself talks to is a GraphQL endpoint at sleeper.app/graphql, and
// that schema does carry pools: get_user_pools, get_user_pool_by_id, and
// get_pickem_picks_for_league, which is the one that matters because it
// returns every entry's picks for a week rather than just yours.
//
// Two things follow from it being undocumented. It needs a session token,
// which lives in Vercel and nowhere else, and it can change shape without
// notice, so every read here is defensive and a failure degrades to the
// modelled field rather than breaking the page.

const ENDPOINT = "https://sleeper.app/graphql";

export interface GraphQlResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export function sleeperTokenConfigured(): boolean {
  return Boolean(process.env.SLEEPER_TOKEN);
}

/**
 * One GraphQL call.
 *
 * The token is sent exactly as the app sends it. Sleeper accepts it bare on
 * the authorization header rather than with a Bearer prefix, and a wrong shape
 * comes back as an `unauthorized` error inside a 200, not as a 401, which is
 * why the errors array is checked rather than the status alone.
 */
export async function sleeperGraphQl<T>(query: string): Promise<GraphQlResult<T>> {
  const token = process.env.SLEEPER_TOKEN;
  if (!token) return { ok: false, error: "SLEEPER_TOKEN is not set." };

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: token.replace(/^Bearer\s+/i, ""),
      },
      body: JSON.stringify({ query }),
      cache: "no-store",
    });

    const body = (await res.json()) as { data?: T; errors?: { message?: string }[] };

    if (body.errors?.length) {
      const message = body.errors.map((e) => e.message).filter(Boolean).join("; ");
      return {
        ok: false,
        error: /unauthor/i.test(message)
          ? "Sleeper rejected the token. It has expired or was copied wrong; replace SLEEPER_TOKEN."
          : message || "Sleeper returned an error.",
      };
    }

    if (!res.ok) return { ok: false, error: `Sleeper returned HTTP ${res.status}.` };
    return { ok: true, data: body.data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "The call failed." };
  }
}

export interface UserPool {
  pool_id: string;
  pool_type: string | null;
  sport: string | null;
  status: string | null;
  created: number | null;
  metadata: Record<string, unknown> | null;
}

/** Every pool this account is in, newest first. */
export async function listPools(limit = 25): Promise<GraphQlResult<UserPool[]>> {
  const res = await sleeperGraphQl<{ get_user_pools: UserPool[] }>(
    `{ get_user_pools(sport: "nfl", limit: ${limit}, offset: 0) {
        pool_id pool_type sport status created metadata
      } }`,
  );
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, data: res.data?.get_user_pools ?? [] };
}

/** One pool, including whatever its metadata carries. */
export async function getPoolById(poolId: string): Promise<GraphQlResult<UserPool | null>> {
  const res = await sleeperGraphQl<{ get_user_pool_by_id: UserPool | null }>(
    `{ get_user_pool_by_id(pool_id: "${poolId}") {
        pool_id pool_type sport status created metadata
      } }`,
  );
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, data: res.data?.get_user_pool_by_id ?? null };
}

/**
 * Every entry's picks for one week of one pool.
 *
 * `leg_id` is Sleeper's word for the week within a pickem season. The response
 * is an untyped Map in their schema, so it is returned raw and read by the
 * caller rather than trusted into a shape here.
 */
export async function getLegPicks(
  leagueId: string,
  legId: string,
): Promise<GraphQlResult<Record<string, unknown>>> {
  const res = await sleeperGraphQl<{ get_pickem_picks_for_league: Record<string, unknown> }>(
    `{ get_pickem_picks_for_league(league_id: "${leagueId}", leg_id: "${legId}", include_tiebreaker: false) }`,
  );
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, data: res.data?.get_pickem_picks_for_league ?? {} };
}
