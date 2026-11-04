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
        <Link
          href="/fantasy"
          className="text-sm text-zinc-500 dark:text-zinc-400"
        >
          ‹ Leagues
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">GM Scout</h1>
        <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 dark:bg-red-950/50 dark:text-red-300">
          {message}
        </p>
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
      <div className="flex flex-col gap-6">
        <Link
          href={`/l/${leagueId}`}
          className="text-sm text-zinc-500 dark:text-zinc-400"
        >
          ‹ League
        </Link>

        {/* Header */}
        <header className="flex flex-col gap-4 rounded-3xl border border-zinc-200/80 bg-white/80 p-5 backdrop-blur dark:border-zinc-800/80 dark:bg-zinc-900/80 sm:flex-row sm:items-center">
          <div className="grid size-16 place-items-center rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 text-2xl font-black text-white shadow-md shadow-amber-500/30">
            <Compass size={26} aria-hidden />
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              GM Scouting Report
            </span>
            <h1 className="text-3xl font-bold tracking-tight">{displayName}</h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Profile based on cross-league data{" "}
              {otherLeagues.length > 0
                ? `(${otherLeagues.length} leagues this season)`
                : "(no other leagues found)"}
            </p>
          </div>
          <div className="sm:ml-auto">
            <RefreshButton leagueId={leagueId} />
          </div>
        </header>

        {/* Career history */}
        {history && (
          <section className="grid gap-3 md:grid-cols-4">
            <div className="flex flex-col gap-1 rounded-2xl border border-zinc-200/80 bg-white/80 p-4 backdrop-blur dark:border-zinc-800/80 dark:bg-zinc-900/80">
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                Career record
              </span>
              <span className="text-2xl font-bold tabular-nums">
                {history.totals.totalWins}-{history.totals.totalLosses}
              </span>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                {history.totals.winPct.toFixed(1)}% win rate
              </span>
            </div>
            <div className="flex flex-col gap-1 rounded-2xl border border-zinc-200/80 bg-white/80 p-4 backdrop-blur dark:border-zinc-800/80 dark:bg-zinc-900/80">
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                Seasons
              </span>
              <span className="text-2xl font-bold tabular-nums">
                {history.totals.seasons}
              </span>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                in this league
              </span>
            </div>
            <div className="flex flex-col gap-1 rounded-2xl border border-zinc-200/80 bg-white/80 p-4 backdrop-blur dark:border-zinc-800/80 dark:bg-zinc-900/80">
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                Championships
              </span>
              <span className="flex items-baseline gap-1 text-2xl font-bold tabular-nums">
                {history.totals.championships}
                <Trophy
                  size={16}
                  className="text-amber-500"
                  aria-hidden
                />
              </span>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                {history.totals.runnerUps} runner-up,{" "}
                {history.totals.lastPlaces} last
              </span>
            </div>
            <div className="flex flex-col gap-1 rounded-2xl border border-zinc-200/80 bg-white/80 p-4 backdrop-blur dark:border-zinc-800/80 dark:bg-zinc-900/80">
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                Playoff record
              </span>
              <span className="text-2xl font-bold tabular-nums">
                {history.totals.playoffWins}-{history.totals.playoffLosses}
              </span>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                across {history.totals.seasons} seasons
              </span>
            </div>
          </section>
        )}

        {/* Current state */}
        {homeGrade && (
          <section className="flex flex-col gap-3">
            <h2 className="text-xl font-semibold tracking-tight">
              Current state in this league
            </h2>
            <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-zinc-200/80 bg-white/80 p-5 backdrop-blur dark:border-zinc-800/80 dark:bg-zinc-900/80">
              <span className="grid size-16 place-items-center rounded-2xl bg-gradient-to-br from-sky-400 to-sky-600 text-2xl font-black text-white shadow-md shadow-sky-500/30">
                {homeGrade.dynastyGrade || "—"}
              </span>
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Dynasty grade
                </span>
                <span className="text-base font-bold">
                  Rank #{homeGrade.dynastyRank} ·{" "}
                  {homeGrade.totalValue.toLocaleString()} total value
                </span>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  Contender {homeGrade.contenderGrade} · power #
                  {homeGrade.powerRank} · age{" "}
                  {homeGrade.avgStarterAge.toFixed(1)}
                </span>
              </div>
              {homeGrade.weakness && (
                <span className="ml-auto rounded-full bg-rose-100 px-3 py-1 text-xs font-semibold text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
                  {homeGrade.weakness}
                </span>
              )}
            </div>
          </section>
        )}

        {/* Crushes */}
        <section className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-xl font-semibold tracking-tight">Crushes</h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Players this manager rosters in 2 or more of their leagues —
              they value these guys higher than the market.
            </p>
          </div>
          {otherLeagueRosters.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-zinc-300 bg-white/40 px-4 py-6 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900/40 dark:text-zinc-400">
              No other leagues found for this user.
            </p>
          ) : crushes.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-zinc-300 bg-white/40 px-4 py-6 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900/40 dark:text-zinc-400">
              No crushes yet — manager doesn&apos;t double-roster anyone in
              their leagues.
            </p>
          ) : (
            <ul className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
              {crushes.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center gap-3 rounded-2xl border border-amber-200/80 bg-amber-50/30 p-3 dark:border-amber-900/60 dark:bg-amber-950/20"
                >
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
                      className="truncate text-sm font-semibold"
                    />
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                      {[c.player?.team ?? "FA", c.player?.position]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </div>
                  <div className="flex shrink-0 flex-col items-end">
                    <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                      ×{c.count}
                    </span>
                    <span className="text-[10px] tabular-nums text-zinc-500 dark:text-zinc-400">
                      {c.value > 0 ? c.value.toLocaleString() : "—"}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Fandom */}
        {fandom.length > 0 && (
          <section className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <h2 className="text-xl font-semibold tracking-tight">Fandom</h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                NFL teams over-represented across their rosters (3+ players)
                — likely homer bias.
              </p>
            </div>
            <ul className="flex flex-wrap gap-2">
              {fandom.map(([team, count]) => (
                <li
                  key={team}
                  className="flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50/60 px-3 py-1.5 text-sm dark:border-sky-900/60 dark:bg-sky-950/30"
                >
                  <span className="font-bold">{team}</span>
                  <span className="rounded-full bg-sky-500 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-white">
                    {count}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Other leagues */}
        {otherLeagues.length > 0 && (
          <section className="flex flex-col gap-3">
            <h2 className="text-xl font-semibold tracking-tight">
              Their other leagues
            </h2>
            <ul className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
              {otherLeagues.map((l) => (
                <li
                  key={l.league_id}
                  className={`rounded-2xl border border-zinc-200/80 bg-white/80 p-3 backdrop-blur dark:border-zinc-800/80 dark:bg-zinc-900/80 ${
                    l.league_id === homeLeagueId
                      ? "ring-2 ring-amber-300 dark:ring-amber-800"
                      : ""
                  }`}
                >
                  <div className="text-sm font-semibold">{l.name}</div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">
                    {l.season} · {l.status}
                    {l.league_id === homeLeagueId ? " · this league" : ""}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Career history via{" "}
          <a
            href="https://rosteraudit.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-amber-700 hover:underline dark:text-amber-400"
          >
            RosterAudit
          </a>
          . Crushes + fandom computed locally from this manager&apos;s public
          Sleeper rosters across {otherLeagues.length} league
          {otherLeagues.length === 1 ? "" : "s"}.
        </p>
      </div>
    </main>
  );
}
