import Link from "next/link";
import {
  getAllPlayers,
  getLeague,
  getLeagueMatchups,
  getLeagueRosters,
  getLeagueUsers,
  getUser,
} from "@/lib/sleeper/client";
import type { SleeperMatchup } from "@/lib/sleeper/types";
import type {
  SleeperPlayer,
  SleeperPlayersById,
  SleeperRoster,
  SleeperUser,
} from "@/lib/sleeper/types";
import {
  getRosterGrades,
} from "@/lib/rosteraudit/client";
import type { RAGradesByRosterId } from "@/lib/rosteraudit/types";
import type { GradeSnapshot } from "@/lib/history/grades";
import {
  detectRosterConflicts,
  conflictedPlayerIds,
  dropCandidateIds,
  type ConflictPlayer,
} from "@/lib/dynasty/roster-conflicts";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { PlayerLink } from "@/components/PlayerLink";
import { RefreshButton } from "@/components/RefreshButton";
import { AlertTriangle, ArrowDown, ArrowUp } from "lucide-react";
import { getValuesForProfile } from "@/lib/values";
import { profileFromSleeper } from "@/lib/league/detect";
import {
  formatSnapshotDate,
  getGradeHistory,
  rankMove,
  recordGradeSnapshot,
  withCurrent,
} from "@/lib/history/grades";
import { after } from "next/server";

export const dynamic = "force-dynamic";

const POSITION_ORDER = ["QB", "RB", "WR", "TE", "K", "DEF"];

function ownerName(roster: SleeperRoster, usersById: Map<string, SleeperUser>) {
  const u = roster.owner_id ? usersById.get(roster.owner_id) : null;
  if (!u) return "Unowned";
  return u.metadata?.team_name || u.display_name || u.username || u.user_id;
}

function totalFpts(r: SleeperRoster): number {
  const i = r.settings?.fpts ?? 0;
  const d = r.settings?.fpts_decimal ?? 0;
  return i + d / 100;
}

function record(r: SleeperRoster): string {
  const s = r.settings ?? {};
  const w = s.wins ?? 0;
  const l = s.losses ?? 0;
  const t = s.ties ?? 0;
  return t > 0 ? `${w}-${l}-${t}` : `${w}-${l}`;
}

function statusBadge(
  status: string | null | undefined,
): { label: string; className: string } | null {
  if (!status || status === "Active") return null;
  const red = "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300";
  const yellow = "bg-yellow-100 text-yellow-800 dark:bg-yellow-950/50 dark:text-yellow-300";
  const orange = "bg-orange-100 text-orange-800 dark:bg-orange-950/50 dark:text-orange-300";
  const gray = "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
  const map: Record<string, { label: string; className: string }> = {
    Out: { label: "OUT", className: red },
    Questionable: { label: "Q", className: yellow },
    Doubtful: { label: "D", className: orange },
    "Injured Reserve": { label: "IR", className: red },
    IR: { label: "IR", className: red },
    PUP: { label: "PUP", className: gray },
    Suspended: { label: "SUS", className: gray },
    NA: { label: "NA", className: gray },
  };
  return map[status] ?? { label: status, className: gray };
}

function playerName(p: SleeperPlayer): string {
  if (p.full_name) return p.full_name;
  const f = p.first_name ?? "";
  const l = p.last_name ?? "";
  return `${f} ${l}`.trim() || p.player_id;
}

function primaryPosition(p: SleeperPlayer): string {
  return p.fantasy_positions?.[0] ?? p.position ?? "FLEX";
}

function groupRoster(playerIds: string[], players: SleeperPlayersById) {
  const groups = new Map<string, SleeperPlayer[]>();
  for (const id of playerIds) {
    const p = players[id];
    if (!p) continue;
    const pos = primaryPosition(p);
    const list = groups.get(pos) ?? [];
    list.push(p);
    groups.set(pos, list);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => playerName(a).localeCompare(playerName(b)));
  }
  const ordered: Array<[string, SleeperPlayer[]]> = [];
  for (const pos of POSITION_ORDER) {
    if (groups.has(pos)) ordered.push([pos, groups.get(pos)!]);
  }
  for (const [pos, list] of [...groups.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (!POSITION_ORDER.includes(pos)) ordered.push([pos, list]);
  }
  return ordered;
}

function ConfigError({ message }: { message: string }) {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex max-w-2xl flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">League</h1>
        <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 dark:bg-red-950/50 dark:text-red-300">
          {message}
        </p>
      </div>
    </main>
  );
}

export default async function LeaguePage({
  params,
}: {
  params: Promise<{ leagueId: string }>;
}) {
  const { leagueId } = await params;
  const username = process.env.SLEEPER_USERNAME;
  if (!username) {
    return <ConfigError message="Missing SLEEPER_USERNAME in .env.local" />;
  }

  const league = await getLeague(leagueId);
  const me = await getUser(username);
  const profile = profileFromSleeper(league);
  // Grades and their history come from RosterAudit, which is dynasty-only.
  // Asking for a redraft league answers 400, so don't ask.
  const tracksGrades = profile.type === "dynasty";
  // Sleeper's own count of scored weeks. The record on each roster is the
  // sum of those weeks, and in a league with a median game each week adds
  // two results, so the page says which weeks the record covers.
  const scoredWeeks = Number(league.settings?.last_scored_leg ?? 0) || 0;
  const medianGame = league.settings?.league_average_match === 1;

  const [rosters, users, players, fcValues, grades, gradeHistory, lastMatchups] =
    await Promise.all([
      getLeagueRosters(leagueId),
      getLeagueUsers(leagueId),
      getAllPlayers(),
      getValuesForProfile(profile, league).then((r) => r.values),
      tracksGrades
        ? getRosterGrades(leagueId, me.user_id).catch(
            (): RAGradesByRosterId => ({}),
          )
        : Promise.resolve<RAGradesByRosterId>({}),
      tracksGrades
        ? getGradeHistory(leagueId).catch((): GradeSnapshot[] => [])
        : Promise.resolve<GradeSnapshot[]>([]),
      scoredWeeks >= 1
        ? getLeagueMatchups(leagueId, scoredWeeks).catch((): SleeperMatchup[] => [])
        : Promise.resolve<SleeperMatchup[]>([]),
    ]);

  // Last week, per roster: what they scored and whether they beat the team
  // they were paired with. The median game, where the league runs one, is
  // folded into the record already and is not repeated here.
  const lastWeek = new Map<number, { points: number; beat: boolean | null }>();
  for (const m of lastMatchups) {
    const opponent = lastMatchups.find(
      (o) => o.matchup_id != null && o.matchup_id === m.matchup_id && o.roster_id !== m.roster_id,
    );
    lastWeek.set(m.roster_id, {
      points: m.points ?? 0,
      beat: opponent ? (m.points ?? 0) > (opponent.points ?? 0) : null,
    });
  }

  // Log today's grades once the page has been sent, so tomorrow's visit can
  // say what moved. Never let a logging failure surface as a page error.
  if (tracksGrades) {
    after(async () => {
      try {
        await recordGradeSnapshot(leagueId, grades);
      } catch (e) {
        console.warn(
          `[history] snapshot failed for ${leagueId}: ${e instanceof Error ? e.message : e}`,
        );
      }
    });
  }

  const usersById = new Map(users.map((u) => [u.user_id, u]));
  const myRoster = rosters.find((r) => r.owner_id === me.user_id) ?? null;

  function teamValue(r: SleeperRoster): number {
    return (r.players ?? []).reduce(
      (sum, id) => sum + (fcValues[id]?.value ?? 0),
      0,
    );
  }

  const standings = [...rosters].sort((a, b) => {
    const aw = a.settings?.wins ?? 0;
    const bw = b.settings?.wins ?? 0;
    if (aw !== bw) return bw - aw;
    const at = a.settings?.ties ?? 0;
    const bt = b.settings?.ties ?? 0;
    if (at !== bt) return bt - at;
    return totalFpts(b) - totalFpts(a);
  });

  const myGroups = myRoster ? groupRoster(myRoster.players ?? [], players) : [];

  // Detect same-NFL-team + same-position conflicts on the user's roster.
  const conflictPlayers: ConflictPlayer[] = (myRoster?.players ?? [])
    .map((id): ConflictPlayer | null => {
      const p = players[id];
      const v = fcValues[id];
      if (!p || !p.team || !p.position) return null;
      return {
        id,
        name: playerName(p),
        team: p.team,
        position: p.position,
        value: v?.value ?? 0,
        age: typeof p.age === "number" ? p.age : null,
        photoUrl: v?.photoUrl ?? null,
      };
    })
    .filter((x): x is ConflictPlayer => x !== null);
  const conflicts = detectRosterConflicts(conflictPlayers);
  const conflictedIds = conflictedPlayerIds(conflicts);
  const dropIds = dropCandidateIds(conflicts);

  // Compute per-position roster summary locally so deep-bench players
  // not in RA's ranked set still get counted.
  type LocalRoom = { count: number; value: number; ages: number[] };
  const localRooms: Record<string, LocalRoom> = {
    QB: { count: 0, value: 0, ages: [] },
    RB: { count: 0, value: 0, ages: [] },
    WR: { count: 0, value: 0, ages: [] },
    TE: { count: 0, value: 0, ages: [] },
  };
  for (const id of myRoster?.players ?? []) {
    const p = players[id];
    if (!p?.position || !(p.position in localRooms)) continue;
    const room = localRooms[p.position];
    room.count += 1;
    room.value += fcValues[id]?.value ?? 0;
    if (typeof p.age === "number") room.ages.push(p.age);
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-1">
            <h1 className="text-3xl font-semibold tracking-tight">
              {league.name}
            </h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {league.season} season · {rosters.length} teams
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <RefreshButton leagueId={leagueId} />
            <Link
              href={`/l/${leagueId}/plan`}
              className="inline-flex items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800"
            >
              Season plan
            </Link>
            <Link
              href={`/l/${leagueId}/players`}
              className="inline-flex items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800"
            >
              Players
            </Link>
            <Link
              href={`/l/${leagueId}/draft`}
              className="inline-flex items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800"
            >
              Draft
            </Link>
            <Link
              href={`/l/${leagueId}/trade`}
              className="inline-flex items-center justify-center rounded-xl bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 dark:bg-amber-500 dark:hover:bg-amber-400"
            >
              Trade analyzer →
            </Link>
          </div>
        </div>

        <div className="grid gap-8 lg:grid-cols-[3fr_2fr]">
        <section className="flex flex-col gap-4">
          <header className="flex flex-col gap-0.5">
            <h2 className="text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              My Team
            </h2>
            <p className="text-lg font-semibold">
              {myRoster ? ownerName(myRoster, usersById) : "—"}
            </p>
            {myRoster && (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                {record(myRoster)} · {totalFpts(myRoster).toFixed(2)} PF ·{" "}
                {teamValue(myRoster).toLocaleString()} value
              </p>
            )}
          </header>

          {myRoster && grades[myRoster.roster_id] && (() => {
            const g = grades[myRoster.roster_id];
            const gradeKey = (g.dynastyGrade || "C")[0].toUpperCase();
            const move = rankMove(
              withCurrent(gradeHistory, grades),
              myRoster.roster_id,
            );
            const movedPast = (move?.passedBy ?? [])
              .map((id) => rosters.find((r) => String(r.roster_id) === id))
              .filter((r): r is SleeperRoster => Boolean(r))
              .map((r) => ownerName(r, usersById));
            const tileTint =
              gradeKey === "A"
                ? {
                    tile: "from-emerald-400 to-emerald-600",
                    shadow: "shadow-emerald-500/30",
                    bg: "to-emerald-50/40 dark:to-emerald-950/10",
                    eyebrow: "text-emerald-700 dark:text-emerald-400",
                  }
                : gradeKey === "B"
                  ? {
                      tile: "from-sky-400 to-sky-600",
                      shadow: "shadow-sky-500/30",
                      bg: "to-sky-50/40 dark:to-sky-950/10",
                      eyebrow: "text-sky-700 dark:text-sky-400",
                    }
                  : gradeKey === "C"
                    ? {
                        tile: "from-zinc-400 to-zinc-600",
                        shadow: "shadow-zinc-500/20",
                        bg: "to-zinc-100/40 dark:to-zinc-800/30",
                        eyebrow: "text-zinc-600 dark:text-zinc-400",
                      }
                    : gradeKey === "D"
                      ? {
                          tile: "from-amber-400 to-orange-500",
                          shadow: "shadow-amber-500/30",
                          bg: "to-amber-50/40 dark:to-amber-950/10",
                          eyebrow: "text-amber-700 dark:text-amber-400",
                        }
                      : {
                          tile: "from-rose-400 to-rose-600",
                          shadow: "shadow-rose-500/30",
                          bg: "to-rose-50/40 dark:to-rose-950/10",
                          eyebrow: "text-rose-700 dark:text-rose-400",
                        };
            return (
              <div
                className={`relative flex flex-col gap-4 overflow-hidden rounded-3xl border border-zinc-200/80 bg-gradient-to-br from-white via-white p-5 shadow-sm dark:border-zinc-800/80 dark:from-zinc-900 dark:via-zinc-900 ${tileTint.bg}`}
              >
                <div className="flex flex-wrap items-center gap-5">
                  <div className="flex items-center gap-4">
                    <span
                      className={`grid size-20 place-items-center rounded-2xl bg-gradient-to-br text-4xl font-black tracking-tighter text-white shadow-lg ${tileTint.tile} ${tileTint.shadow}`}
                    >
                      {g.dynastyGrade || "—"}
                    </span>
                    <div className="flex flex-col gap-0.5">
                      <span
                        className={`text-[10px] font-bold uppercase tracking-wider ${tileTint.eyebrow}`}
                      >
                        Dynasty grade
                      </span>
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-2xl font-bold tracking-tight">
                          #{g.dynastyRank} of {rosters.length}
                        </span>
                        {move && (
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                              move.delta < 0
                                ? "bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300"
                                : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                            }`}
                            title={`Was #${move.previous} on ${formatSnapshotDate(move.previousDate)}`}
                          >
                            {move.delta < 0 ? (
                              <ArrowDown className="size-3" />
                            ) : (
                              <ArrowUp className="size-3" />
                            )}
                            {Math.abs(move.delta)} since{" "}
                            {formatSnapshotDate(move.previousDate)}
                          </span>
                        )}
                      </span>
                      <span className="text-xs text-zinc-600 dark:text-zinc-400">
                        Contender{" "}
                        <span className="font-semibold">
                          {g.contenderGrade || "—"}
                        </span>
                        {" · "}power #{g.powerRank}
                        {" · "}
                        <span className="tabular-nums">
                          {g.projectedPpg.toFixed(1)}
                        </span>{" "}
                        ppg
                      </span>
                      {move && move.delta < 0 && movedPast.length > 0 && (
                        <span className="text-xs text-zinc-500 dark:text-zinc-500">
                          {movedPast.slice(0, 2).join(", ")}
                          {movedPast.length > 2
                            ? ` and ${movedPast.length - 2} more`
                            : ""}{" "}
                          moved past you
                        </span>
                      )}
                    </div>
                  </div>
                  {g.weakness && (
                    <span className="ml-auto rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700 shadow-sm dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
                      {g.weakness}
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {(["QB", "RB", "WR", "TE"] as const).map((pos) => {
                    const room = localRooms[pos];
                    if (!room || room.count === 0) {
                      return (
                        <div
                          key={pos}
                          className="flex flex-col gap-0.5 rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800"
                        >
                          <span className="text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                            {pos}
                          </span>
                          <span className="text-sm text-zinc-400 dark:text-zinc-600">
                            —
                          </span>
                        </div>
                      );
                    }
                    const avgAge =
                      room.ages.length > 0
                        ? room.ages.reduce((a, b) => a + b, 0) / room.ages.length
                        : 0;
                    return (
                      <div
                        key={pos}
                        className="flex flex-col gap-0.5 rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800"
                      >
                        <span className="text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                          {pos}
                        </span>
                        <span className="text-sm font-semibold tabular-nums">
                          {room.value.toLocaleString()}
                        </span>
                        <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                          {room.count} player{room.count === 1 ? "" : "s"}
                          {avgAge > 0 ? ` · age ${avgAge.toFixed(1)}` : ""}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {!myRoster && (
            <p className="rounded-xl bg-yellow-50 px-4 py-3 text-sm text-yellow-800 dark:bg-yellow-950/50 dark:text-yellow-300">
              No roster found in this league for {username}. Check that
              SLEEPER_USERNAME matches an owner in the league.
            </p>
          )}

          {myRoster && myGroups.length === 0 && (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              No players on this roster yet.
            </p>
          )}

          {myGroups.map(([pos, list]) => (
            <div key={pos} className="flex flex-col gap-2">
              <div className="text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                {pos} · {list.length}
              </div>
              <ul className="flex flex-col divide-y divide-zinc-200 overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
                {list.map((p) => {
                  const badge = statusBadge(p.status);
                  const v = fcValues[p.player_id];
                  return (
                    <li
                      key={p.player_id}
                      className="flex items-center gap-3 px-4 py-3"
                    >
                      <PlayerAvatar
                        name={playerName(p)}
                        position={p.position ?? null}
                        photoUrl={v?.photoUrl ?? null}
                        size="md"
                      />
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <PlayerLink
                            id={p.player_id}
                            name={playerName(p)}
                            className="truncate text-base font-medium"
                          />
                          {badge && (
                            <span
                              className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${badge.className}`}
                            >
                              {badge.label}
                            </span>
                          )}
                          {v?.buyLow && (
                            <span className="shrink-0 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                              Buy
                            </span>
                          )}
                          {v?.sellHigh && (
                            <span className="shrink-0 rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
                              Sell
                            </span>
                          )}
                          {v?.breakout && (
                            <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
                              Break
                            </span>
                          )}
                          {conflictedIds.has(p.player_id) && (
                            <span
                              className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                                dropIds.has(p.player_id)
                                  ? "bg-rose-500 text-white"
                                  : "bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300"
                              }`}
                              title="Same NFL team + position duplicate"
                            >
                              {dropIds.has(p.player_id) ? "Drop" : "Stack"}
                            </span>
                          )}
                        </div>
                        <span className="text-xs text-zinc-500 dark:text-zinc-400">
                          {[
                            p.team ?? "FA",
                            p.position,
                            p.age ? `age ${p.age}` : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-0.5">
                        {v ? (
                          <>
                            <span className="text-sm font-semibold tabular-nums">
                              {v.value.toLocaleString()}
                            </span>
                            <span className="text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                              <span>
                                #{v.overallRank} · {v.position}
                                {v.positionRank}
                              </span>
                              {v.trend30Day !== 0 && (
                                <span
                                  className={`ml-1 ${
                                    v.trend30Day > 0
                                      ? "text-emerald-600 dark:text-emerald-400"
                                      : "text-rose-600 dark:text-rose-400"
                                  }`}
                                >
                                  {v.trend30Day > 0 ? "+" : ""}
                                  {v.trend30Day}
                                </span>
                              )}
                            </span>
                          </>
                        ) : (
                          <span className="text-xs text-zinc-400 dark:text-zinc-600">
                            —
                          </span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </section>

        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h2 className="text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Standings
            </h2>
            {scoredWeeks >= 1 ? (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Through week {scoredWeeks}
                {medianGame ? ", two results a week: your matchup and the league median" : ""}
              </p>
            ) : null}
          </div>
          <ol className="flex flex-col divide-y divide-zinc-200 overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
            {standings.map((r, i) => {
              const isMe = r.roster_id === myRoster?.roster_id;
              return (
                <li
                  key={r.roster_id}
                  className={`flex items-center justify-between gap-3 px-4 py-3 ${
                    isMe ? "bg-zinc-50 dark:bg-zinc-800/50" : ""
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="w-5 shrink-0 text-sm font-medium tabular-nums text-zinc-500 dark:text-zinc-400">
                      {i + 1}
                    </span>
                    {r.owner_id ? (
                      <Link
                        href={`/l/${leagueId}/scout/${r.owner_id}`}
                        className="truncate text-base font-medium hover:text-amber-700 hover:underline dark:hover:text-amber-400"
                      >
                        {ownerName(r, usersById)}
                        {isMe ? " (you)" : ""}
                      </Link>
                    ) : (
                      <span className="truncate text-base font-medium">
                        {ownerName(r, usersById)}
                      </span>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col items-end">
                    <span className="text-sm font-medium tabular-nums">
                      {record(r)}
                    </span>
                    <span className="text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                      {teamValue(r).toLocaleString()} val
                      {totalFpts(r) > 0 ? ` · ${totalFpts(r).toFixed(0)} PF` : ""}
                    </span>
                    {lastWeek.has(r.roster_id) ? (
                      <span className="text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                        Wk {scoredWeeks}: {lastWeek.get(r.roster_id)!.points.toFixed(1)}
                        {lastWeek.get(r.roster_id)!.beat === null ? "" : (
                          <span
                            className={
                              lastWeek.get(r.roster_id)!.beat
                                ? " font-semibold text-emerald-600 dark:text-emerald-400"
                                : " font-semibold text-rose-600 dark:text-rose-400"
                            }
                          >
                            {lastWeek.get(r.roster_id)!.beat ? " W" : " L"}
                          </span>
                        )}
                      </span>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
        </div>

        {conflicts.length > 0 && (
          <section className="flex flex-col gap-3 rounded-2xl border border-rose-200/80 bg-gradient-to-br from-rose-50/60 to-white p-5 dark:border-rose-900/60 dark:from-rose-950/30 dark:to-zinc-900">
            <header className="flex items-center gap-2">
              <AlertTriangle
                size={18}
                className="text-rose-600 dark:text-rose-400"
                aria-hidden
              />
              <h2 className="text-base font-bold tracking-tight">
                Roster conflicts ({conflicts.length})
              </h2>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                same NFL team, same position — drop the lower-value one
              </span>
            </header>
            <ul className="grid gap-3 md:grid-cols-2">
              {conflicts.map((c) => (
                <li
                  key={`${c.team}-${c.position}`}
                  className="flex flex-col gap-2 rounded-xl border border-rose-200/60 bg-white/80 p-3 backdrop-blur dark:border-rose-900/60 dark:bg-zinc-900/80"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-bold">
                      {c.team} · {c.position}
                    </span>
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                      {c.players.length} players
                    </span>
                  </div>
                  <ul className="flex flex-col gap-1">
                    {c.players.map((p) => {
                      const isDrop = p.id === c.dropCandidate.id;
                      return (
                        <li
                          key={p.id}
                          className={`flex items-center gap-2 rounded-md px-2 py-1.5 ${
                            isDrop
                              ? "bg-rose-100/60 dark:bg-rose-950/30"
                              : ""
                          }`}
                        >
                          <PlayerAvatar
                            name={p.name}
                            position={p.position}
                            photoUrl={p.photoUrl}
                            size="sm"
                          />
                          <PlayerLink
                            id={p.id}
                            name={p.name}
                            className="flex-1 truncate text-sm font-medium"
                          />
                          <span className="shrink-0 text-xs font-semibold tabular-nums">
                            {p.value.toLocaleString()}
                          </span>
                          {isDrop && (
                            <span className="shrink-0 rounded-full bg-rose-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                              Drop
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
              Rule: avoid two players on the same NFL team at the same
              position — they split work or compete for the same job.
            </p>
          </section>
        )}

      </div>
    </main>
  );
}
