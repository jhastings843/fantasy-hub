import "server-only";
import { getLeague, getLeagueRosters, getLeagueUsers, getNflState, getUser } from "@/lib/sleeper/client";
import { profileFromSleeper } from "@/lib/league/detect";
import { getMyLeagues } from "@/lib/league/discover";
import { thisWeeksClaims } from "@/lib/waivers/settled";
import { getWeekTransactions } from "./league-state";
import { getWeekProjections } from "./projections";
import { UNAVAILABLE } from "./report";
import { reviewWaivers, type ReviewTransaction, type WaiverReview } from "./waiver-review";
import type { RoomCandidate } from "./room-claims";

// Sleeper's side of the Wednesday review. The grading is in waiver-review.ts;
// this only fetches. Scored with this week's projections, because the question
// is what the claims do to Sunday, not what they would have done last week.

export async function buildWaiverReview(leagueId: string, now = new Date()): Promise<WaiverReview | null> {
  const league = await getLeague(leagueId);
  const profile = profileFromSleeper(league);
  if (profile.type !== "guillotine" || profile.status !== "in_season") return null;

  const username = process.env.SLEEPER_USERNAME;
  if (!username) return null;

  const [nflState, rosters, users, me] = await Promise.all([
    getNflState(),
    getLeagueRosters(leagueId),
    getLeagueUsers(leagueId),
    getUser(username),
  ]);
  const week = nflState.week ?? 1;

  // Sleeper files Wednesday's run under the week just played.
  const run = thisWeeksClaims(
    await Promise.all([week - 1, week].map((w) => getWeekTransactions(leagueId, w).catch(() => []))),
    now,
  ) as ReviewTransaction[];
  if (!run.some((t) => t.type === "waiver")) return null;

  const projections = await getWeekProjections(leagueId, profile.season, week, league.scoring_settings ?? {});
  const players: Record<string, RoomCandidate> = {};
  for (const p of Object.values(projections)) {
    players[p.playerId] = {
      playerId: p.playerId,
      name: p.name,
      position: p.position,
      points: UNAVAILABLE.has(p.injuryStatus ?? "") ? 0 : p.points,
    };
  }

  const nameOf = (ownerId: string | null) => {
    const user = users.find((u) => u.user_id === ownerId);
    return user?.metadata?.team_name || user?.display_name || user?.username || "Unknown";
  };
  const budget = profile.faab ?? 0;
  const teams = rosters
    .filter((r) => (r.players?.length ?? 0) > 0)
    .map((r) => ({
      rosterId: r.roster_id,
      name: nameOf(r.owner_id),
      isMine: r.owner_id === me.user_id,
      faabLeft: budget - (r.settings?.waiver_budget_used ?? 0),
      players: (r.players ?? []).map((id) => players[id]).filter((p): p is RoomCandidate => p != null),
    }));

  return reviewWaivers({
    leagueName: profile.name,
    week,
    run,
    teams,
    players,
    rosterPositions: profile.rosterPositions,
  });
}

/** Every guillotine league Jack is in. One failing costs that league only. */
export async function buildWaiverReviews(): Promise<WaiverReview[]> {
  const leagues = (await getMyLeagues()).filter((l) => l.source !== "manual");
  const results = await Promise.allSettled(leagues.map((l) => buildWaiverReview(l.id)));
  return results.flatMap((r) => (r.status === "fulfilled" && r.value ? [r.value] : []));
}
