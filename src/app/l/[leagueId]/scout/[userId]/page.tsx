import Link from "next/link";
import { Compass, Trophy } from "lucide-react";
import {
  getManagerHistory,
  getRosterGrades,
} from "@/lib/rosteraudit/client";
import type { RAGradesByRosterId } from "@/lib/rosteraudit/types";
import {
  getAllPlayers,
  getLeague,
  getLeagueRosters,
  getLeagueUsers,
  getUserLeagues,
} from "@/lib/sleeper/client";
import type { SleeperPlayer, SleeperRoster } from "@/lib/sleeper/types";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { PlayerLink } from "@/components/PlayerLink";
import { RefreshButton } from "@/components/RefreshButton";
import { Chip, Disclosure, Empty, Num, Section, Stat } from "@/components/hh/ui";
import { PopLink } from "@/components/hh/PopLink";
import { TeamEdge } from "@/components/hh/team";
import { teamHref } from "@/app/picks/hrefs";
import { getValuesForProfile } from "@/lib/values";
import { profileFromSleeper } from "@/lib/league/detect";

export const dynamic = "force-dynamic";

interface RouteParams {
  leagueId: string;
  userId: string;
}

function nameOf(p: SleeperPlayer): string {
  if (p.full_name) return p.full_name;
  return `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || p.player_id;
}

function NotFound({ message }: { message: string }) {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex max-w-2xl flex-col gap-3">
        <Link href="/fantasy" className="inline-flex min-h-11 items-center self-start text-sm text-hh-muted hover:text-hh-ink">
          ‹ Leagues
        </Link>
        <h1 className="hh-title">GM Scout</h1>
        <p className="border-l-2 border-hh-neg py-1 pl-3 text-sm text-hh-neg">{message}</p>
      </div>
    </main>
  );
}

export default async function ScoutPage({
  params,
}: {
  params: Promise<RouteParams>;
}) {
  const { leagueId, userId } = await params;
  // "Home" is the league you're scouting from: this manager's roster and
  // record are read out of it, while their other leagues come from Sleeper.
  const homeLeagueId = leagueId;

  // Step 1: their leagues for the current season + our home league context
  const homeLeague = await getLeague(homeLeagueId);
  const season = homeLeague.season ?? new Date().getFullYear().toString();

  const [history, otherLeagues, homeRosters, homeUsers] = await Promise.all([
    getManagerHistory(homeLeagueId, userId),
    getUserLeagues(userId, season).catch(() => []),
    getLeagueRosters(homeLeagueId),
    getLeagueUsers(homeLeagueId),
  ]);

  const targetUser = homeUsers.find((u) => u.user_id === userId);
  if (!targetUser && !history) {
    return <NotFound message={`No data for user ${userId}.`} />;
  }
  const displayName =
    targetUser?.metadata?.team_name ||
    targetUser?.display_name ||
    history?.totals.displayName ||
    userId;
  const homeRoster = homeRosters.find((r) => r.owner_id === userId);

  // Step 2: their rosters across all 2026 leagues (for crushes / fandom)
  const otherLeagueRosters: Array<{
    leagueName: string;
    leagueId: string;
    roster: SleeperRoster | null;
  }> = await Promise.all(
    otherLeagues.map(async (l) => {
      try {
        const rosters = await getLeagueRosters(l.league_id);
        const r = rosters.find((x) => x.owner_id === userId) ?? null;
        return { leagueName: l.name, leagueId: l.league_id, roster: r };
      } catch {
        return { leagueName: l.name, leagueId: l.league_id, roster: null };
      }
    }),
  );

  // Step 3: aggregate player + NFL team distribution
  const playerCounts = new Map<
    string,
    { count: number; leagues: string[] }
  >();
  const teamCounts = new Map<string, number>();
  for (const { leagueName, roster } of otherLeagueRosters) {
    if (!roster?.players) continue;
    for (const id of roster.players) {
      const e = playerCounts.get(id) ?? { count: 0, leagues: [] };
      e.count += 1;
      if (!e.leagues.includes(leagueName)) e.leagues.push(leagueName);
      playerCounts.set(id, e);
    }
  }

  const [allPlayers, raValues, grades] = await Promise.all([
    getAllPlayers(),
    getValuesForProfile(profileFromSleeper(homeLeague), homeLeague).then((r) => r.values),
    getRosterGrades(homeLeagueId, userId).catch(
      (): RAGradesByRosterId => ({}),
    ),
  ]);

  // Tally NFL teams once we have player data
  for (const [playerId] of playerCounts) {
    const p = allPlayers[playerId];
    if (p?.team) {
      teamCounts.set(p.team, (teamCounts.get(p.team) ?? 0) + 1);
    }
  }

  // Crushes: rostered in 2+ leagues
  const crushes = [...playerCounts.entries()]
    .filter(([, e]) => e.count >= 2)
    .map(([id, e]) => ({
      id,
      count: e.count,
      leagues: e.leagues,
      player: allPlayers[id],
      value: raValues[id]?.value ?? 0,
    }))
    .sort((a, b) => b.count - a.count || b.value - a.value)
    .slice(0, 12);

  // Fandom: NFL teams over-represented (3+ players across leagues)
  const fandom = [...teamCounts.entries()]
    .filter(([, n]) => n >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  // Home roster grade
  const homeGrade = homeRoster ? grades[homeRoster.roster_id] : null;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-8">
        <Link
          href={`/l/${leagueId}`}
          className="inline-flex min-h-11 items-center self-start text-sm text-hh-muted hover:text-hh-ink"
        >
          ‹ League
        </Link>

        {/* Header */}
        <header className="-mt-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="hh-label inline-flex items-center gap-1.5">
              <Compass size={13} aria-hidden />
              GM scouting report
            </span>
            <h1 className="hh-title">{displayName}</h1>
            <p className="text-sm text-hh-muted">
              Profile based on cross-league data{" "}
              {otherLeagues.length > 0 ? (
                <>(<Num>{otherLeagues.length}</Num> leagues this season)</>
              ) : (
                "(no other leagues found)"
              )}
            </p>
          </div>
          <div className="shrink-0">
            <RefreshButton leagueId={leagueId} />
          </div>
        </header>

        {/* Career history */}
        {history && (
          <Section label="Career in this league">
            <div className="grid grid-cols-2 gap-x-6 gap-y-5 md:grid-cols-4">
              <Stat
                label="Career record"
                value={`${history.totals.totalWins}-${history.totals.totalLosses}`}
                sub={<><Num>{history.totals.winPct.toFixed(1)}%</Num> win rate</>}
              />
              <Stat label="Seasons" value={history.totals.seasons} sub="in this league" />
              <Stat
                label={
                  <span className="inline-flex items-center gap-1">
                    Championships <Trophy size={12} className="text-hh-gold" aria-hidden />
                  </span>
                }
                value={history.totals.championships}
                tone={history.totals.championships > 0 ? "gold" : undefined}
                sub={
                  <>
                    <Num>{history.totals.runnerUps}</Num> runner-up, <Num>{history.totals.lastPlaces}</Num> last
                  </>
                }
              />
              <Stat
                label="Playoff record"
                value={`${history.totals.playoffWins}-${history.totals.playoffLosses}`}
                sub={<>across <Num>{history.totals.seasons}</Num> seasons</>}
              />
            </div>
          </Section>
        )}

        {/* Current state */}
        {homeGrade && (
          <Section label="Current state in this league">
            <div className="flex flex-wrap items-start gap-x-8 gap-y-3">
              <Stat label="Dynasty grade" value={homeGrade.dynastyGrade || "None"} tone="accent" />
              <div className="flex min-w-0 flex-col gap-1">
                <span className="text-base font-semibold text-hh-ink">
                  Rank <Num>#{homeGrade.dynastyRank}</Num> · <Num>{homeGrade.totalValue.toLocaleString()}</Num> total value
                </span>
                <span className="text-xs text-hh-muted">
                  Contender {homeGrade.contenderGrade} · power <Num>#{homeGrade.powerRank}</Num> · age{" "}
                  <Num>{homeGrade.avgStarterAge.toFixed(1)}</Num>
                </span>
              </div>
              {homeGrade.weakness && (
                <span className="sm:ml-auto">
                  <Chip tone="neg">{homeGrade.weakness}</Chip>
                </span>
              )}
            </div>
          </Section>
        )}

        {/* Crushes */}
        <Section label="Crushes" aside={crushes.length > 0 ? <><Num>{crushes.length}</Num> players</> : undefined}>
          <p className="text-xs text-hh-muted">
            Players this manager rosters in 2 or more of their leagues. They
            value these guys higher than the market.
          </p>
          {otherLeagueRosters.length === 0 ? (
            <Empty>No other leagues found for this user.</Empty>
          ) : crushes.length === 0 ? (
            <Empty>
              No crushes yet. This manager doesn&apos;t double-roster anyone in
              their leagues.
            </Empty>
          ) : (
            <ul className="mt-2 grid gap-x-8 md:grid-cols-2 lg:grid-cols-3">
              {crushes.map((c) => (
                <li key={c.id}>
                  <TeamEdge league="nfl" team={c.player?.team} className="flex min-h-11 items-center gap-3 border-b border-hh-line py-2">
                    <PlayerAvatar
                      name={c.player ? nameOf(c.player) : c.id}
                      position={c.player?.position ?? null}
                      photoUrl={raValues[c.id]?.photoUrl ?? null}
                      size="sm"
                    />
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <PlayerLink
                        id={c.id}
                        name={c.player ? nameOf(c.player) : c.id}
                        className="truncate text-sm font-semibold text-hh-ink"
                      />
                      <span className="text-xs text-hh-muted">
                        {c.player?.team ? <PopLink href={teamHref("nfl", c.player.team)}>{c.player.team}</PopLink> : "FA"}
                        {c.player?.position ? ` · ${c.player.position}` : ""}
                      </span>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-0.5">
                      <Chip tone="accent">
                        <Num>×{c.count}</Num>
                      </Chip>
                      <span className="text-[10px] text-hh-muted">
                        {c.value > 0 ? <Num>{c.value.toLocaleString()}</Num> : "None"}
                      </span>
                    </div>
                  </TeamEdge>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <div className="flex flex-col">
          {/* Fandom */}
          {fandom.length > 0 && (
            <Disclosure summary={<>Fandom (<Num>{fandom.length}</Num> teams)</>}>
              <p className="text-xs text-hh-muted">
                NFL teams over-represented across their rosters (3+ players).
                Likely homer bias.
              </p>
              <ul className="mt-2 flex flex-col">
                {fandom.map(([team, count]) => (
                  <li key={team}>
                    <TeamEdge league="nfl" team={team} className="flex min-h-11 items-center justify-between gap-3 border-b border-hh-line py-2">
                      <PopLink href={teamHref("nfl", team)} className="font-semibold text-hh-ink">
                        {team}
                      </PopLink>
                      <span className="text-sm text-hh-muted">
                        <Num className="font-semibold text-hh-ink">{count}</Num> players
                      </span>
                    </TeamEdge>
                  </li>
                ))}
              </ul>
            </Disclosure>
          )}

          {/* Other leagues */}
          {otherLeagues.length > 0 && (
            <Disclosure summary={<>Their other leagues (<Num>{otherLeagues.length}</Num>)</>}>
              <ul className="grid gap-x-8 md:grid-cols-2 lg:grid-cols-3">
                {otherLeagues.map((l) => (
                  <li key={l.league_id} className="border-b border-hh-line py-2.5">
                    <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-hh-ink">
                      {l.name}
                      {l.league_id === homeLeagueId && <Chip tone="accent">this league</Chip>}
                    </div>
                    <div className="text-xs text-hh-muted">
                      <Num>{l.season}</Num> · {l.status}
                    </div>
                  </li>
                ))}
              </ul>
            </Disclosure>
          )}
        </div>

        <p className="text-xs text-hh-muted">
          Career history via{" "}
          <a
            href="https://rosteraudit.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-hh-accent-ink underline-offset-[3px] hover:underline"
          >
            RosterAudit
          </a>
          . Crushes + fandom computed locally from this manager&apos;s public
          Sleeper rosters across <Num>{otherLeagues.length}</Num> league
          {otherLeagues.length === 1 ? "" : "s"}.
        </p>
      </div>
    </main>
  );
}
