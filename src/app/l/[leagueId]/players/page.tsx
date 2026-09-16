import Link from "next/link";
import { TrendingDown, TrendingUp } from "lucide-react";
import {
  getMovers,
} from "@/lib/rosteraudit/client";
import type { RAMover } from "@/lib/rosteraudit/types";
import {
  getAllPlayers,
  getLeague,
  getLeagueRosters,
  getLeagueUsers,
  getUser,
} from "@/lib/sleeper/client";
import type { SleeperPlayer, SleeperUser } from "@/lib/sleeper/types";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { PlayerLink } from "@/components/PlayerLink";
import { JinglesBadge } from "@/components/JinglesBadge";
import type { LeagueType } from "@/lib/league/types";
import { RefreshButton } from "@/components/RefreshButton";
import { computeTeamSummaries } from "@/lib/dynasty/power-rankings";
import { PlayerSearch, type SearchablePlayer } from "./PlayerSearch";
import { getValuesForProfile } from "@/lib/values";
import { profileFromSleeper } from "@/lib/league/detect";
import { startablePositions } from "@/lib/redraft/draft-board";
import { isStartableIn } from "@/lib/waivers/pool";

export const dynamic = "force-dynamic";

const TRACKED_POSITIONS = ["QB", "RB", "WR", "TE"] as const;

const POSITION_TINT: Record<string, string> = {
  QB: "bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300",
  RB: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
  WR: "bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300",
  TE: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
};

function ConfigError({ message }: { message: string }) {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex max-w-2xl flex-col gap-3">
        <Link
          href="/"
          className="text-sm text-zinc-500 dark:text-zinc-400"
        >
          ‹ Leagues
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">Players</h1>
        <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 dark:bg-red-950/50 dark:text-red-300">
          {message}
        </p>
      </div>
    </main>
  );
}

function nameOf(p: SleeperPlayer): string {
  if (p.full_name) return p.full_name;
  return `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || p.player_id;
}

function PositionChip({ position }: { position: string }) {
  const cls =
    POSITION_TINT[position] ??
    "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
  return (
    <span
      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${cls}`}
    >
      {position}
    </span>
  );
}

function MoverRow({
  m,
  direction,
  rostered,
  ownerName,
  leagueType,
}: {
  m: RAMover;
  direction: "up" | "down";
  rostered: boolean;
  ownerName: string | null;
  leagueType: LeagueType;
}) {
  const trend7 = m.trend7Day;
  const trend30 = m.trend30Day;
  const primaryTrend = trend7 !== 0 ? trend7 : trend30;
  const primaryLabel = trend7 !== 0 ? "7d" : "30d";
  const trendCls =
    primaryTrend > 0
      ? "text-emerald-600 dark:text-emerald-400"
      : primaryTrend < 0
        ? "text-rose-600 dark:text-rose-400"
        : "text-zinc-400 dark:text-zinc-600";
  return (
    <li className="flex items-center gap-2.5 px-3 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
      <PlayerAvatar name={m.name} position={m.position} size="sm" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <PlayerLink
            id={m.sleeperId}
            name={m.name}
            className="truncate text-sm font-medium"
          />
          <PositionChip position={m.position} />
          <JinglesBadge sleeperId={m.sleeperId} leagueType={leagueType} />
          {m.buyLow && (
            <span className="shrink-0 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
              Buy
            </span>
          )}
          {m.sellHigh && (
            <span className="shrink-0 rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
              Sell
            </span>
          )}
          {m.breakout && (
            <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
              Break
            </span>
          )}
        </div>
        <span className="truncate text-xs text-zinc-500 dark:text-zinc-400">
          {m.team ?? "FA"} ·{" "}
          {rostered ? (
            <span className="font-medium text-zinc-700 dark:text-zinc-300">
              {ownerName ?? "rostered"}
            </span>
          ) : (
            <span className="font-medium text-emerald-700 dark:text-emerald-400">
              Available
            </span>
          )}
          {primaryTrend !== 0 && (
            <>
              {" · "}
              <span className={`font-medium tabular-nums ${trendCls}`}>
                {primaryLabel} {primaryTrend > 0 ? "+" : ""}
                {primaryTrend}
              </span>
            </>
          )}
          {primaryTrend === 0 && (
            <>
              {" · "}
              <span className="text-zinc-400 dark:text-zinc-600">
                {direction === "up" ? "rising" : "falling"}
              </span>
            </>
          )}
        </span>
      </div>
      <span className="shrink-0 text-sm font-semibold tabular-nums">
        {m.valueSf.toLocaleString()}
      </span>
    </li>
  );
}

export default async function PlayersPage({
  params,
}: {
  params: Promise<{ leagueId: string }>;
}) {
  const { leagueId } = await params;
  const username = process.env.SLEEPER_USERNAME;
  if (!username) {
    return <ConfigError message="Missing SLEEPER_USERNAME in .env.local" />;
  }

  const me = await getUser(username);
  const league = await getLeague(leagueId);
  const leagueType = profileFromSleeper(league).type;
  const startable = startablePositions(profileFromSleeper(league).rosterPositions);

  const [rosters, users, allPlayers, raValues, movers] = await Promise.all([
    getLeagueRosters(leagueId),
    getLeagueUsers(leagueId),
    getAllPlayers(),
    getValuesForProfile(profileFromSleeper(league), league).then((r) => r.values),
    getMovers(30),
  ]);

  const usersById = new Map(users.map((u: SleeperUser) => [u.user_id, u]));
  const myRoster = rosters.find((r) => r.owner_id === me.user_id);

  // Set of every player ID currently rostered by anyone in the league.
  const rosteredIds = new Set<string>();
  const ownerByPlayerId = new Map<string, string>();
  for (const r of rosters) {
    const owner = r.owner_id ? usersById.get(r.owner_id) : null;
    const ownerName =
      owner?.metadata?.team_name ||
      owner?.display_name ||
      owner?.username ||
      `Roster ${r.roster_id}`;
    for (const id of r.players ?? []) {
      rosteredIds.add(id);
      ownerByPlayerId.set(id, ownerName);
    }
  }

  // Compute my weakest positions so we can suggest waiver fits there.
  const teams = computeTeamSummaries(rosters, users, allPlayers, raValues);
  const myTeam = teams.find((t) => t.rosterId === myRoster?.roster_id);
  const myWeakPositions = myTeam
    ? (TRACKED_POSITIONS as readonly string[])
        .map((p) => ({ p, rank: myTeam.positionRanks[p] ?? 99 }))
        .sort((a, b) => b.rank - a.rank)
        .slice(0, 2)
        .map((x) => x.p)
    : [];

  // Build the searchable index across the whole NFL slim set. Skip
  // players with no name or no position (mostly noise rows).
  const searchablePlayers: SearchablePlayer[] = [];
  const waiverPool: SearchablePlayer[] = [];
  for (const p of Object.values(allPlayers)) {
    const name = nameOf(p);
    if (!name) continue;
    const position = p.position ?? null;
    const v = raValues[p.player_id];
    const player: SearchablePlayer = {
      id: p.player_id,
      name,
      position,
      team: p.team ?? null,
      value: v?.value ?? 0,
      photoUrl: v?.photoUrl ?? null,
      rostered: rosteredIds.has(p.player_id),
      ownerName: ownerByPlayerId.get(p.player_id) ?? null,
    };
    // Waivers follow league slots so eligible defenses survive the search restriction.
    if (isStartableIn(position, startable)) waiverPool.push(player);
    if (
      !position ||
      TRACKED_POSITIONS.includes(position as (typeof TRACKED_POSITIONS)[number])
    ) {
      searchablePlayers.push(player);
    }
  }

  // Waiver fits: unrostered, in my weakest positions, sorted by value.
  const waiverFits = waiverPool
    .filter((p) => !p.rostered)
    .filter((p) => p.position && myWeakPositions.includes(p.position))
    .filter((p) => p.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 12);

  // Top waivers overall (any position) as a fallback list.
  const topWaiversOverall = waiverPool
    .filter((p) => !p.rostered)
    .filter((p) => p.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 12);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-1">
          <Link
            href={`/l/${leagueId}`}
            className="text-sm text-zinc-500 dark:text-zinc-400"
          >
            ‹ League
          </Link>
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h1 className="text-3xl font-semibold tracking-tight">Players</h1>
            <RefreshButton leagueId={leagueId} />
          </div>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Search the league, scout the waiver wire, and track value momentum
            across the dynasty market.
          </p>
        </div>

        {/* Waiver fits */}
        <section className="flex flex-col gap-3">
          <header className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-xl font-semibold tracking-tight">
              Waiver fits for your roster
            </h2>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              {myWeakPositions.length > 0
                ? `Targets ${myWeakPositions.join(" + ")} (your weak rooms)`
                : "Top unrostered overall"}
            </span>
          </header>
          {(waiverFits.length > 0 ? waiverFits : topWaiversOverall).length ===
          0 ? (
            <p className="rounded-2xl border border-dashed border-zinc-300 bg-white/40 px-4 py-6 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900/40 dark:text-zinc-400">
              No unrostered players found with value &gt; 0.
            </p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {(waiverFits.length > 0 ? waiverFits : topWaiversOverall).map(
                (p) => (
                  <li
                    key={p.id}
                    className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-white px-3 py-2.5 dark:border-zinc-800 dark:bg-zinc-900"
                  >
                    <PlayerAvatar
                      name={p.name}
                      position={p.position}
                      photoUrl={p.photoUrl}
                      size="sm"
                    />
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <PlayerLink
                          id={p.id}
                          name={p.name}
                          className="truncate text-sm font-medium"
                        />
                        {p.position && (
                          <PositionChip position={p.position} />
                        )}
                      </div>
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">
                        {p.team ?? "FA"} ·{" "}
                        <span className="font-medium text-emerald-700 dark:text-emerald-400">
                          Available
                        </span>
                      </span>
                    </div>
                    <span className="shrink-0 text-sm font-semibold tabular-nums">
                      {p.value.toLocaleString()}
                    </span>
                  </li>
                ),
              )}
            </ul>
          )}
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
            Players not currently on any league roster. Sorted by RA value
            (TE-premium adjusted). Pickups improve depth without a trade.
          </p>
        </section>

        {/* Movers */}
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="flex flex-col gap-3">
            <header className="flex items-baseline justify-between">
              <h2 className="flex items-center gap-2 text-xl font-semibold">
                <TrendingUp size={18} className="text-emerald-600 dark:text-emerald-400" aria-hidden />
                Risers
              </h2>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                {movers.risers.length} players
              </span>
            </header>
            <ul className="flex flex-col divide-y divide-zinc-200 overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
              {movers.risers.map((m) => (
                <MoverRow
                  key={m.sleeperId}
                  m={m}
                  direction="up"
                  rostered={rosteredIds.has(m.sleeperId)}
                  ownerName={ownerByPlayerId.get(m.sleeperId) ?? null}
                  leagueType={leagueType}
                />
              ))}
              {movers.risers.length === 0 && (
                <li className="px-3 py-4 text-sm text-zinc-500 dark:text-zinc-400">
                  No risers right now.
                </li>
              )}
            </ul>
          </section>

          <section className="flex flex-col gap-3">
            <header className="flex items-baseline justify-between">
              <h2 className="flex items-center gap-2 text-xl font-semibold">
                <TrendingDown size={18} className="text-rose-600 dark:text-rose-400" aria-hidden />
                Fallers
              </h2>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                {movers.fallers.length} players
              </span>
            </header>
            <ul className="flex flex-col divide-y divide-zinc-200 overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
              {movers.fallers.map((m) => (
                <MoverRow
                  key={m.sleeperId}
                  m={m}
                  direction="down"
                  rostered={rosteredIds.has(m.sleeperId)}
                  ownerName={ownerByPlayerId.get(m.sleeperId) ?? null}
                  leagueType={leagueType}
                />
              ))}
              {movers.fallers.length === 0 && (
                <li className="px-3 py-4 text-sm text-zinc-500 dark:text-zinc-400">
                  No fallers right now.
                </li>
              )}
            </ul>
          </section>
        </div>

        {/* Search */}
        <PlayerSearch players={searchablePlayers} />

      </div>
    </main>
  );
}
