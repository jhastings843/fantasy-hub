import Link from "next/link";
import { TrendingDown, TrendingUp } from "lucide-react";
import { Chip, Empty, Num, PosBadge, Section } from "@/components/hh/ui";
import { PopLink } from "@/components/hh/PopLink";
import { TeamEdge } from "@/components/hh/team";
import { teamHref } from "@/app/picks/hrefs";
import { moversFromValues } from "@/lib/rosteraudit/movers";
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

function ConfigError({ message }: { message: string }) {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex max-w-2xl flex-col gap-3">
        <Link href="/fantasy" className="inline-flex min-h-11 items-center self-start text-sm text-hh-muted hover:text-hh-ink">
          ‹ Leagues
        </Link>
        <h1 className="hh-title">Players</h1>
        <p className="border-l-2 border-hh-neg py-1 pl-3 text-sm text-hh-neg">{message}</p>
      </div>
    </main>
  );
}

function nameOf(p: SleeperPlayer): string {
  if (p.full_name) return p.full_name;
  return `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || p.player_id;
}

/** An NFL team code that opens the team pop-up; free agents stay text. */
function TeamCode({ team }: { team: string | null | undefined }) {
  if (!team) return <>FA</>;
  return <PopLink href={teamHref("nfl", team)}>{team}</PopLink>;
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
  return (
    <li>
      <TeamEdge league="nfl" team={m.team} className="flex min-h-11 items-center gap-2.5 border-b border-hh-line py-2">
        <PlayerAvatar name={m.name} position={m.position} size="sm" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <PlayerLink id={m.sleeperId} name={m.name} className="truncate text-sm font-medium text-hh-ink" />
            <PosBadge pos={m.position} />
            <JinglesBadge sleeperId={m.sleeperId} leagueType={leagueType} />
            {m.buyLow && <Chip tone="pos">BUY</Chip>}
            {m.sellHigh && <Chip tone="neg">SELL</Chip>}
            {m.breakout && <Chip tone="accent">BREAK</Chip>}
          </div>
          <span className="truncate text-xs text-hh-muted">
            <TeamCode team={m.team} /> ·{" "}
            {rostered ? (
              <span className="font-medium text-hh-ink-2">{ownerName ?? "rostered"}</span>
            ) : (
              <span className="font-medium text-hh-pos">Available</span>
            )}
            {primaryTrend !== 0 && (
              <>
                {" · "}
                <span className={`font-medium ${primaryTrend > 0 ? "text-hh-pos" : "text-hh-neg"}`}>
                  {primaryLabel} <Num>{primaryTrend > 0 ? "+" : ""}{primaryTrend.toLocaleString()}</Num>
                </span>
              </>
            )}
            {primaryTrend === 0 && (
              <>
                {" · "}
                <span>{direction === "up" ? "rising" : "falling"}</span>
              </>
            )}
          </span>
        </div>
        <Num className="shrink-0 text-sm font-semibold text-hh-ink">{m.valueSf.toLocaleString()}</Num>
      </TeamEdge>
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

  const [rosters, users, allPlayers, leagueValues] = await Promise.all([
    getLeagueRosters(leagueId),
    getLeagueUsers(leagueId),
    getAllPlayers(),
    getValuesForProfile(profileFromSleeper(league), league),
  ]);
  const raValues = leagueValues.values;
  const movers = moversFromValues(raValues, leagueValues.source.key, 30);

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

  const fits = waiverFits.length > 0 ? waiverFits : topWaiversOverall;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-2">
          <Link href={`/l/${leagueId}`} className="inline-flex min-h-11 items-center self-start text-sm text-hh-muted hover:text-hh-ink">
            ‹ League
          </Link>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h1 className="hh-title">Players</h1>
            <RefreshButton leagueId={leagueId} />
          </div>
          <p className="max-w-2xl text-[15px] leading-relaxed text-hh-ink-2">
            Search the league, scout the waiver wire, and track value momentum
            across the dynasty market.
          </p>
        </div>

        <Section
          label="Waiver fits for your roster"
          aside={
            myWeakPositions.length > 0
              ? `Targets ${myWeakPositions.join(" + ")} (your weak rooms)`
              : "Top unrostered overall"
          }
        >
          {fits.length === 0 ? (
            <Empty>No unrostered players found with value &gt; 0.</Empty>
          ) : (
            <ul className="grid gap-x-8 sm:grid-cols-2">
              {fits.map((p) => (
                <li key={p.id}>
                  <TeamEdge league="nfl" team={p.team} className="flex min-h-11 items-center gap-3 border-b border-hh-line py-2.5">
                    <PlayerAvatar name={p.name} position={p.position} photoUrl={p.photoUrl} size="sm" />
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <PlayerLink id={p.id} name={p.name} className="truncate text-sm font-medium text-hh-ink" />
                        {p.position && <PosBadge pos={p.position} />}
                      </div>
                      <span className="text-xs text-hh-muted">
                        <TeamCode team={p.team} /> · <span className="font-medium text-hh-pos">Available</span>
                      </span>
                    </div>
                    <Num className="shrink-0 text-sm font-semibold text-hh-ink">{p.value.toLocaleString()}</Num>
                  </TeamEdge>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[11px] text-hh-muted">
            Players not currently on any league roster. Sorted by RA value
            (TE-premium adjusted). Pickups improve depth without a trade.
          </p>
        </Section>

        <div className="grid gap-x-10 gap-y-8 lg:grid-cols-2">
          <Section
            label={
              <span className="inline-flex items-center gap-1.5">
                <TrendingUp size={14} className="text-hh-pos" aria-hidden />
                Risers
              </span>
            }
            aside={<><Num>{movers.risers.length}</Num> players</>}
          >
            <ul className="flex flex-col">
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
                <li><Empty>No risers right now.</Empty></li>
              )}
            </ul>
          </Section>

          <Section
            label={
              <span className="inline-flex items-center gap-1.5">
                <TrendingDown size={14} className="text-hh-neg" aria-hidden />
                Fallers
              </span>
            }
            aside={<><Num>{movers.fallers.length}</Num> players</>}
          >
            <ul className="flex flex-col">
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
                <li><Empty>No fallers right now.</Empty></li>
              )}
            </ul>
          </Section>
        </div>

        {/* Search */}
        <PlayerSearch players={searchablePlayers} />
      </div>
    </main>
  );
}
