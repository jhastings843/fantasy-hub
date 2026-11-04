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
import { Chip, Disclosure, Empty, Num, PageHead, Section, Stat, type Tone } from "@/components/hh/ui";
import { PopLink } from "@/components/hh/PopLink";
import { TeamEdge } from "@/components/hh/team";
import { teamHref } from "@/app/picks/hrefs";
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
import { Suspense } from "react";
import { ProjectedStandings } from "./ProjectedStandings";
import { seasonResults } from "@/lib/guillotine/league-state";
import type { WeekResult } from "@/lib/guillotine/results";
import {
  allPlayRecord,
  guillotineStandings,
  type GuillotineRow,
} from "@/lib/guillotine/standings";

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


// One line under a guillotine team: where it finished in its last live week
// and how far clear of the chop, or the week it went.
function ChopLine({ row }: { row: GuillotineRow }) {
  const last = row.last;
  if (row.choppedWeek !== null) {
    return (
      <span className="text-xs font-semibold text-hh-neg">
        Chopped wk <Num>{row.choppedWeek}</Num>
        {last ? (
          <span className="font-normal text-hh-muted">
            {" "}(<Num>{last.score.toFixed(1)}</Num>)
          </span>
        ) : null}
      </span>
    );
  }
  if (!last) return null;
  const ord = (n: number) =>
    `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
  return (
    <span className="text-xs text-hh-muted">
      Wk <Num>{last.week}</Num>: <Num>{last.score.toFixed(1)}</Num>, <Num>{ord(last.rank)}</Num> of <Num>{last.teams}</Num>{" "}
      <Num tone={last.rank >= last.teams - 2 ? "gold" : "pos"} className="font-semibold">
        +{last.margin.toFixed(1)}
      </Num>
    </span>
  );
}

function statusBadge(
  status: string | null | undefined,
): { label: string; tone: Tone } | null {
  if (!status || status === "Active") return null;
  const map: Record<string, { label: string; tone: Tone }> = {
    Out: { label: "OUT", tone: "neg" },
    Questionable: { label: "Q", tone: "gold" },
    Doubtful: { label: "D", tone: "accent" },
    "Injured Reserve": { label: "IR", tone: "neg" },
    IR: { label: "IR", tone: "neg" },
    PUP: { label: "PUP", tone: "muted" },
    Suspended: { label: "SUS", tone: "muted" },
    NA: { label: "NA", tone: "muted" },
  };
  return map[status] ?? { label: status, tone: "muted" };
}

/** An NFL team code that opens the team pop-up; free agents stay text. */
function TeamCode({ team }: { team: string | null | undefined }) {
  if (!team) return <>FA</>;
  return <PopLink href={teamHref("nfl", team)}>{team}</PopLink>;
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
        <h1 className="hh-title">League</h1>
        <p className="border-l-2 border-hh-neg py-1 pl-3 text-sm text-hh-neg">{message}</p>
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

  // A guillotine league has no head-to-head games, so Sleeper leaves every
  // record at 0-0. Its table is rebuilt from the weekly scores instead.
  const isGuillotine = profile.type === "guillotine";

  const [rosters, users, players, fcValues, grades, gradeHistory, lastMatchups, weekResults] =
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
      isGuillotine && scoredWeeks >= 1
        ? seasonResults(leagueId, scoredWeeks)
        : Promise.resolve<WeekResult[]>([]),
    ]);

  const chopTable = isGuillotine
    ? guillotineStandings(
        weekResults,
        rosters.map((r) => r.roster_id),
        new Set(rosters.filter((r) => (r.players ?? []).length === 0).map((r) => r.roster_id)),
      )
    : [];
  const chopRows = new Map<number, GuillotineRow>(chopTable.map((g) => [g.rosterId, g]));
  function recordFor(r: SleeperRoster): string {
    const g = chopRows.get(r.roster_id);
    return g ? allPlayRecord(g) : record(r);
  }

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

  const chopOrder = new Map(chopTable.map((g, i) => [g.rosterId, i]));
  const standings = [...rosters].sort((a, b) => {
    if (isGuillotine) {
      return (chopOrder.get(a.roster_id) ?? 99) - (chopOrder.get(b.roster_id) ?? 99);
    }
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

  const linkBtn =
    "inline-flex min-h-11 items-center justify-center rounded-[4px] border border-hh-line px-3 text-sm font-medium text-hh-ink transition-colors hover:border-hh-muted hover:bg-hh-sunk";

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-8">
        <PageHead
          title={league.name}
          sub={
            <>
              <Num>{league.season}</Num> season · <Num>{rosters.length}</Num> teams
            </>
          }
          aside={
            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              <RefreshButton leagueId={leagueId} />
              <Link href={`/l/${leagueId}/plan`} className={linkBtn}>
                Season plan
              </Link>
              <Link href={`/l/${leagueId}/players`} className={linkBtn}>
                Players
              </Link>
              <Link href={`/l/${leagueId}/draft`} className={linkBtn}>
                Draft
              </Link>
              <Link
                href={`/l/${leagueId}/trade`}
                className="inline-flex min-h-11 items-center justify-center rounded-[4px] bg-hh-accent px-3 text-sm font-semibold text-[var(--hh-on-accent)] transition-opacity hover:opacity-90"
              >
                Trade analyzer →
              </Link>
            </div>
          }
        />

        <div className="grid gap-x-10 gap-y-8 lg:grid-cols-[3fr_2fr]">
        <div className="flex min-w-0 flex-col gap-6">
          <Section
            label="My team"
            aside={
              myRoster ? (
                <>
                  <Num>{recordFor(myRoster)}</Num>{isGuillotine ? " all-play" : ""} · <Num>{totalFpts(myRoster).toFixed(2)}</Num> PF ·{" "}
                  <Num>{teamValue(myRoster).toLocaleString()}</Num> value
                </>
              ) : undefined
            }
          >
            <p className="font-display text-2xl font-semibold leading-tight text-hh-ink">
              {myRoster ? ownerName(myRoster, usersById) : "None"}
            </p>

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
            const gradeTone: Tone =
              gradeKey === "A" ? "pos" : gradeKey === "B" ? "gold" : gradeKey === "C" ? "muted" : gradeKey === "D" ? "accent" : "neg";
            return (
              <div className="mt-4 flex flex-col gap-4">
                <div className="flex flex-wrap items-start gap-x-8 gap-y-3">
                  <Stat label="Dynasty grade" value={g.dynastyGrade || "None"} tone={gradeTone} />
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="text-xs text-hh-muted">Dynasty rank</span>
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-[26px] font-semibold leading-none text-hh-ink">
                        <Num>#{g.dynastyRank}</Num> <span className="text-base font-normal text-hh-muted">of <Num>{rosters.length}</Num></span>
                      </span>
                      {move && (
                        <span title={`Was #${move.previous} on ${formatSnapshotDate(move.previousDate)}`}>
                          <Chip tone={move.delta < 0 ? "neg" : "pos"}>
                            {move.delta < 0 ? <ArrowDown className="size-3" aria-hidden /> : <ArrowUp className="size-3" aria-hidden />}
                            <Num>{Math.abs(move.delta)}</Num> since {formatSnapshotDate(move.previousDate)}
                          </Chip>
                        </span>
                      )}
                    </span>
                    <span className="text-xs text-hh-ink-2">
                      Contender <b className="font-semibold">{g.contenderGrade || "None"}</b>
                      {" · "}power <Num>#{g.powerRank}</Num>
                      {" · "}<Num>{g.projectedPpg.toFixed(1)}</Num> ppg
                    </span>
                    {move && move.delta < 0 && movedPast.length > 0 && (
                      <span className="text-xs text-hh-muted">
                        {movedPast.slice(0, 2).join(", ")}
                        {movedPast.length > 2 ? ` and ${movedPast.length - 2} more` : ""} moved past you
                      </span>
                    )}
                  </div>
                  {g.weakness && (
                    <span className="sm:ml-auto">
                      <Chip tone="neg">{g.weakness}</Chip>
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 border-t border-hh-line sm:grid-cols-4">
                  {(["QB", "RB", "WR", "TE"] as const).map((pos) => {
                    const room = localRooms[pos];
                    if (!room || room.count === 0) {
                      return (
                        <div key={pos} className="flex flex-col gap-0.5 border-b border-hh-line py-2 pr-3">
                          <span className="hh-label">{pos}</span>
                          <span className="text-sm text-hh-muted">None</span>
                        </div>
                      );
                    }
                    const avgAge =
                      room.ages.length > 0
                        ? room.ages.reduce((a, b) => a + b, 0) / room.ages.length
                        : 0;
                    return (
                      <div key={pos} className="flex flex-col gap-0.5 border-b border-hh-line py-2 pr-3">
                        <span className="hh-label">{pos}</span>
                        <Num className="text-sm font-semibold text-hh-ink">{room.value.toLocaleString()}</Num>
                        <span className="text-[11px] text-hh-muted">
                          <Num>{room.count}</Num> player{room.count === 1 ? "" : "s"}
                          {avgAge > 0 ? <> · age <Num>{avgAge.toFixed(1)}</Num></> : ""}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {!myRoster && (
            <p className="mt-3 border-l-2 border-hh-gold py-1 pl-3 text-sm text-hh-gold">
              No roster found in this league for {username}. Check that
              SLEEPER_USERNAME matches an owner in the league.
            </p>
          )}

          {myRoster && myGroups.length === 0 && (
            <Empty>No players on this roster yet.</Empty>
          )}
          </Section>

          {conflicts.length > 0 && (
            <Disclosure
              summary={
                <span className="inline-flex items-center gap-2">
                  <AlertTriangle size={15} className="text-hh-neg" aria-hidden />
                  <span className="font-semibold text-hh-neg">
                    Roster conflicts (<Num>{conflicts.length}</Num>)
                  </span>
                  <span className="text-hh-muted">same NFL team, same position</span>
                </span>
              }
            >
              <p className="text-xs text-hh-muted">Drop the lower-value one.</p>
              <div className="mt-2 grid gap-x-8 md:grid-cols-2">
                {conflicts.map((c) => (
                  <div key={`${c.team}-${c.position}`} className="border-b border-hh-line py-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-semibold text-hh-ink">
                        <TeamCode team={c.team} /> · {c.position}
                      </span>
                      <span className="text-xs text-hh-muted">
                        <Num>{c.players.length}</Num> players
                      </span>
                    </div>
                    <ul className="mt-1 flex flex-col">
                      {c.players.map((p) => {
                        const isDrop = p.id === c.dropCandidate.id;
                        return (
                          <li key={p.id} className="flex min-h-11 items-center gap-2 py-1">
                            <PlayerAvatar name={p.name} position={p.position} photoUrl={p.photoUrl} size="sm" />
                            <PlayerLink id={p.id} name={p.name} className="flex-1 truncate text-sm font-medium text-hh-ink" />
                            <Num className="shrink-0 text-xs font-semibold">{p.value.toLocaleString()}</Num>
                            {isDrop && <Chip tone="neg">Drop</Chip>}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-hh-muted">
                Rule: avoid two players on the same NFL team at the same
                position. They split work or compete for the same job.
              </p>
            </Disclosure>
          )}

          {myGroups.map(([pos, list]) => (
            <Section key={pos} label={pos} aside={<><Num>{list.length}</Num> rostered</>}>
              <ul className="flex flex-col">
                {list.map((p) => {
                  const badge = statusBadge(p.status);
                  const v = fcValues[p.player_id];
                  return (
                    <li key={p.player_id}>
                    <TeamEdge
                      league="nfl"
                      team={p.team ?? undefined}
                      className="flex min-h-11 items-center gap-3 border-b border-hh-line py-2.5"
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
                            className="truncate text-base font-medium text-hh-ink"
                          />
                          {badge && <Chip tone={badge.tone}>{badge.label}</Chip>}
                          {v?.buyLow && <Chip tone="pos">BUY</Chip>}
                          {v?.sellHigh && <Chip tone="neg">SELL</Chip>}
                          {v?.breakout && <Chip tone="accent">BREAK</Chip>}
                          {conflictedIds.has(p.player_id) && (
                            <span title="Same NFL team + position duplicate">
                              <Chip tone={dropIds.has(p.player_id) ? "neg" : "muted"}>
                                {dropIds.has(p.player_id) ? "DROP" : "STACK"}
                              </Chip>
                            </span>
                          )}
                        </div>
                        <span className="text-xs text-hh-muted">
                          <TeamCode team={p.team} />
                          {p.position ? ` · ${p.position}` : ""}
                          {p.age ? <> · age <Num>{p.age}</Num></> : null}
                        </span>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-0.5">
                        {v ? (
                          <>
                            <Num className="text-sm font-semibold text-hh-ink">{v.value.toLocaleString()}</Num>
                            <span className="text-xs text-hh-muted">
                              <Num>#{v.overallRank}</Num> · <Num>{v.position}{v.positionRank}</Num>
                              {v.trend30Day !== 0 && (
                                <Num tone={v.trend30Day > 0 ? "pos" : "neg"} className="ml-1">
                                  {v.trend30Day > 0 ? "+" : ""}
                                  {v.trend30Day}
                                </Num>
                              )}
                            </span>
                          </>
                        ) : (
                          <span className="text-xs text-hh-muted">None</span>
                        )}
                      </div>
                    </TeamEdge>
                    </li>
                  );
                })}
              </ul>
            </Section>
          ))}
        </div>

        <div className="flex min-w-0 flex-col gap-8">
        <Section
          label="Standings"
          aside={
            scoredWeeks >= 1 ? (
              <>
                Through week <Num>{scoredWeeks}</Num>
                {isGuillotine
                  ? ". Record is all-play: a win for every live team you outscored each week"
                  : ""}
                {medianGame ? ", two results a week: your matchup and the league median" : ""}
              </>
            ) : undefined
          }
        >
          <ol className="flex flex-col">
            {standings.map((r, i) => {
              const isMe = r.roster_id === myRoster?.roster_id;
              return (
                <li
                  key={r.roster_id}
                  className={`flex min-h-11 items-center justify-between gap-3 border-b border-hh-line py-2.5 last:border-b-0 ${
                    isMe ? "bg-hh-sunk -mx-2 px-2" : ""
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <Num className="w-5 shrink-0 text-sm text-hh-muted">{i + 1}</Num>
                    {r.owner_id ? (
                      <Link
                        href={`/l/${leagueId}/scout/${r.owner_id}`}
                        className="truncate text-base font-medium text-hh-ink underline-offset-[3px] hover:text-hh-accent-ink hover:underline"
                      >
                        {ownerName(r, usersById)}
                        {isMe ? " (you)" : ""}
                      </Link>
                    ) : (
                      <span className="truncate text-base font-medium text-hh-ink">
                        {ownerName(r, usersById)}
                      </span>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col items-end">
                    <Num className="text-sm font-medium text-hh-ink">{recordFor(r)}</Num>
                    <span className="text-xs text-hh-muted">
                      {isGuillotine && (r.players ?? []).length === 0 ? (
                        "roster released"
                      ) : (
                        <><Num>{teamValue(r).toLocaleString()}</Num> val</>
                      )}
                      {totalFpts(r) > 0 ? <> · <Num>{totalFpts(r).toFixed(0)}</Num> PF</> : ""}
                    </span>
                    {chopRows.has(r.roster_id) ? (
                      <ChopLine row={chopRows.get(r.roster_id)!} />
                    ) : lastWeek.has(r.roster_id) ? (
                      <span className="text-xs text-hh-muted">
                        Wk <Num>{scoredWeeks}</Num>: <Num>{lastWeek.get(r.roster_id)!.points.toFixed(1)}</Num>
                        {lastWeek.get(r.roster_id)!.beat === null ? "" : (
                          <Num tone={lastWeek.get(r.roster_id)!.beat ? "pos" : "neg"} className="font-semibold">
                            {lastWeek.get(r.roster_id)!.beat ? " W" : " L"}
                          </Num>
                        )}
                      </span>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        </Section>
        <Suspense fallback={<div className="h-64 animate-pulse rounded-[4px] bg-hh-sunk" aria-label="Loading projection" />}>
          <ProjectedStandings
            leagueId={leagueId}
            names={Object.fromEntries(rosters.map((r) => [r.roster_id, ownerName(r, usersById)]))}
            myRosterId={myRoster?.roster_id ?? null}
            chopped={chopTable.filter((c) => c.choppedWeek !== null).map((c) => [c.rosterId, c.choppedWeek!])}
          />
        </Suspense>
        </div>
        </div>
      </div>
    </main>
  );
}
