import Link from "next/link";
import { Calendar, CheckCircle2, Circle, Compass, Target } from "lucide-react";
import {
  getRosterGrades,
} from "@/lib/rosteraudit/client";
import type { RAGradesByRosterId } from "@/lib/rosteraudit/types";
import {
  getAllPlayers,
  getLeague,
  getLeagueDrafts,
  getLeagueRosters,
  getLeagueUsers,
  getUser,
} from "@/lib/sleeper/client";
import { computeTeamSummaries } from "@/lib/dynasty/power-rankings";
import {
  currentPhase,
  inferTrajectory,
  keyDates,
  trajectoryBlurb,
  trajectoryLabel,
  type Trajectory,
} from "@/lib/dynasty/season-plan";
import { CustomGoals } from "./CustomGoals";
import { RefreshButton } from "@/components/RefreshButton";
import { getValuesForProfile } from "@/lib/values";
import { profileFromSleeper } from "@/lib/league/detect";
import { buildGoals, STRATEGY_SUMMARY, type AutoGoal } from "@/lib/strategy";

export const dynamic = "force-dynamic";

const POSITIONS = ["QB", "RB", "WR", "TE"] as const;

const TRAJECTORY_TINT: Record<Trajectory, string> = {
  contender:
    "bg-amber-500 text-white dark:bg-amber-500",
  compete:
    "bg-emerald-500 text-white dark:bg-emerald-500",
  reload:
    "bg-sky-500 text-white dark:bg-sky-500",
  transition:
    "bg-zinc-500 text-white dark:bg-zinc-500",
  rebuild:
    "bg-rose-500 text-white dark:bg-rose-500",
};

const CATEGORY_LABEL: Record<string, string> = {
  roster: "Roster",
  trade: "Trade",
  draft: "Draft",
  standings: "Standings",
  other: "Other",
};

function GoalRow({ g }: { g: AutoGoal }) {
  const Icon = g.status === "done" ? CheckCircle2 : Circle;
  const iconCls =
    g.status === "done"
      ? "text-emerald-600 dark:text-emerald-400"
      : g.status === "in_progress"
        ? "text-amber-600 dark:text-amber-400"
        : "text-zinc-400 dark:text-zinc-600";
  return (
    <li className="flex items-start gap-3 py-3">
      <Icon size={18} className={`mt-0.5 shrink-0 ${iconCls}`} aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className={`text-sm ${
            g.status === "done"
              ? "text-zinc-500 line-through dark:text-zinc-500"
              : "text-zinc-900 dark:text-zinc-50"
          }`}
        >
          {g.text}
        </span>
        <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
          <span className="font-semibold uppercase tracking-wider">
            {CATEGORY_LABEL[g.category] ?? g.category}
          </span>
          {g.current && <span>· current: {g.current}</span>}
          {g.target && <span>· target: {g.target}</span>}
        </div>
      </div>
    </li>
  );
}

function ConfigError({ message }: { message: string }) {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex max-w-2xl flex-col gap-3">
        <Link
          href="/fantasy"
          className="text-sm text-zinc-500 dark:text-zinc-400"
        >
          ‹ Leagues
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">Season plan</h1>
        <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 dark:bg-red-950/50 dark:text-red-300">
          {message}
        </p>
      </div>
    </main>
  );
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default async function SeasonPlanPage({
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

  const [drafts, rosters, users, players, fcValues, grades] =
    await Promise.all([
      getLeagueDrafts(leagueId),
      getLeagueRosters(leagueId),
      getLeagueUsers(leagueId),
      getAllPlayers(),
      getValuesForProfile(profileFromSleeper(league), league).then((r) => r.values),
      getRosterGrades(leagueId, me.user_id).catch(
        (): RAGradesByRosterId => ({}),
      ),
    ]);

  const myRoster = rosters.find((r) => r.owner_id === me.user_id);
  if (!myRoster) {
    return (
      <ConfigError message={`No roster found for ${username} in this league.`} />
    );
  }

  const teams = computeTeamSummaries(rosters, users, players, fcValues);
  const myTeam = teams.find((t) => t.rosterId === myRoster.roster_id);
  if (!myTeam) {
    return (
      <ConfigError message="Could not compute your team summary." />
    );
  }

  const grade = grades[myRoster.roster_id] ?? null;
  const trajectory = inferTrajectory(grade);

  const draft = drafts[0] ?? null;
  const draftStart = draft?.start_time ? new Date(draft.start_time) : null;
  const draftSlot = draft?.draft_order?.[me.user_id] ?? null;

  const profile = profileFromSleeper(league);
  const phase = currentPhase(new Date(), draftStart, profile.type);

  // Sort positions by league-relative rank (higher rank number = weaker)
  // rather than raw roster value, so what surfaces matches how power
  // rankings work elsewhere on the site.
  const sortedByRank = [...POSITIONS].sort(
    (a, b) =>
      (myTeam.positionRanks[b] ?? 99) - (myTeam.positionRanks[a] ?? 99),
  );
  const weakestPositions = sortedByRank.slice(0, 2);
  const strongestPositions = sortedByRank.slice(-2).reverse();

  const settings = myRoster.settings ?? {};
  const record = {
    wins: settings.wins ?? 0,
    losses: settings.losses ?? 0,
    ties: settings.ties ?? 0,
    pointsFor: (settings.fpts ?? 0) + (settings.fpts_decimal ?? 0) / 100,
    pointsAgainst:
      (settings.fpts_against ?? 0) + (settings.fpts_against_decimal ?? 0) / 100,
  };

  // Standings rank by wins, then points for, matching how the league itself
  // breaks ties.
  const standingRank =
    [...rosters]
      .sort((a, b) => {
        const w = (b.settings?.wins ?? 0) - (a.settings?.wins ?? 0);
        if (w !== 0) return w;
        return (b.settings?.fpts ?? 0) - (a.settings?.fpts ?? 0);
      })
      .findIndex((r) => r.roster_id === myRoster.roster_id) + 1;

  const faabBudget =
    typeof league.settings?.waiver_budget === "number"
      ? league.settings.waiver_budget
      : null;
  const faabRemaining =
    faabBudget != null ? faabBudget - (settings.waiver_budget_used ?? 0) : null;

  const autoGoals = buildGoals({
    profile,
    myTeam,
    totalTeams: rosters.length,
    grade,
    trajectory,
    draftSlot,
    draftRounds: draft?.settings?.rounds ?? 0,
    weakestPositions,
    strongestPositions,
    record,
    standingRank,
    scoringRank: null,
    week: null,
    faabRemaining,
    faabBudget,
    playoffTeams:
      typeof league.settings?.playoff_teams === "number"
        ? league.settings.playoff_teams
        : Math.floor(rosters.length / 2),
    // Playoffs start at playoff_week_start, so the regular season is the week
    // before it.
    regularSeasonWeeks:
      typeof league.settings?.playoff_week_start === "number"
        ? league.settings.playoff_week_start - 1
        : 14,
  });

  const season = Number(league.season ?? new Date().getFullYear());
  const dates = keyDates(season, draftStart, profile.type);
  const now = new Date();

  // Before a redraft league's draft every roster is empty, so team value and
  // position ranks are all zero and any ordering of them is noise. Say the
  // roster is empty instead of publishing a made-up rank.
  const rosterEmpty = myTeam.totalValue === 0;

  const myStandingRank =
    [...teams].sort((a, b) => b.totalValue - a.totalValue).findIndex(
      (t) => t.rosterId === myTeam.rosterId,
    ) + 1;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-2">
          <Link
            href={`/l/${leagueId}`}
            className="text-sm text-zinc-500 dark:text-zinc-400"
          >
            ‹ League
          </Link>
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Season plan
            </h1>
            <RefreshButton leagueId={leagueId} />
          </div>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {league.name} · {league.season} · {rosters.length}-team{" "}
            {profile.superflex ? "superflex" : "one QB"} ·{" "}
            {profile.ppr === 1
              ? "PPR"
              : profile.ppr === 0.5
                ? "half PPR"
                : "standard"}
            {profile.tePremium > 0 ? " with TE premium" : ""}
          </p>
        </div>

        {/* How this format is played. The goals below follow from it. */}
        <p className="max-w-2xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
          {STRATEGY_SUMMARY[profile.type]}
        </p>

        {/* Trajectory + phase hero. Trajectory is a dynasty concept: it reads
            RosterAudit's dynasty grades and age curves, neither of which means
            anything in a league that resets each year. */}
        <div className="grid gap-4 lg:grid-cols-2">
          {profile.type === "dynasty" && (
          <div className="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-center gap-3">
              <Compass
                size={18}
                className="shrink-0 text-zinc-500 dark:text-zinc-400"
                aria-hidden
              />
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                Team trajectory
              </span>
            </div>
            <div className="flex items-baseline gap-3">
              <span
                className={`rounded-lg px-3 py-1.5 text-sm font-bold uppercase tracking-wide ${TRAJECTORY_TINT[trajectory]}`}
              >
                {trajectoryLabel(trajectory)}
              </span>
              {grade && (
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  Dynasty {grade.dynastyGrade} · Contender{" "}
                  {grade.contenderGrade} · age{" "}
                  {grade.avgStarterAge.toFixed(1)}
                </span>
              )}
            </div>
            <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
              {trajectoryBlurb(trajectory)}
            </p>
          </div>
          )}

          <div className="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-center gap-3">
              <Calendar
                size={18}
                className="shrink-0 text-zinc-500 dark:text-zinc-400"
                aria-hidden
              />
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                Current phase
              </span>
            </div>
            <span className="rounded-lg bg-amber-100 px-3 py-1.5 text-sm font-bold uppercase tracking-wide text-amber-800 dark:bg-amber-950/50 dark:text-amber-300 self-start">
              {phase.label}
            </span>
            <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
              {phase.blurb}
            </p>
          </div>
        </div>

        {/* Live progress */}
        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold tracking-tight">Live progress</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="flex flex-col gap-0.5 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                Team value
              </span>
              <span className="text-2xl font-semibold tabular-nums">
                {rosterEmpty ? "—" : myTeam.totalValue.toLocaleString()}
              </span>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                {rosterEmpty
                  ? "empty until the draft"
                  : `rank #${myStandingRank} of ${rosters.length}`}
              </span>
            </div>
            {/* RosterAudit grades dynasty rosters only, so a redraft league
                would show a permanent em dash here. Before its draft the
                useful number is where you pick; after it, your record. */}
            {profile.type === "dynasty" ? (
              <div className="flex flex-col gap-0.5 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Dynasty rank
                </span>
                <span className="text-2xl font-semibold tabular-nums">
                  {grade ? `#${grade.dynastyRank}` : "—"}
                </span>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {grade ? grade.dynastyGrade : "via RosterAudit"}
                </span>
              </div>
            ) : profile.status === "pre_draft" ? (
              <div className="flex flex-col gap-0.5 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Draft slot
                </span>
                <span className="text-2xl font-semibold tabular-nums">
                  {draftSlot ? `#${draftSlot}` : "TBD"}
                </span>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {draftStart
                    ? draftStart.toLocaleDateString("en-US", {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                      })
                    : "not scheduled"}
                </span>
              </div>
            ) : (
              <div className="flex flex-col gap-0.5 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Record
                </span>
                <span className="text-2xl font-semibold tabular-nums">
                  {record.wins}-{record.losses}
                  {record.ties > 0 ? `-${record.ties}` : ""}
                </span>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  #{standingRank} of {rosters.length} ·{" "}
                  {record.pointsFor.toFixed(1)} PF
                </span>
              </div>
            )}
            <div className="flex flex-col gap-0.5 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                Weakest spot
              </span>
              <span className="text-2xl font-semibold">
                {rosterEmpty ? "—" : weakestPositions[0]}
              </span>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                {rosterEmpty
                  ? "nothing drafted yet"
                  : `#${myTeam.positionRanks[weakestPositions[0]] ?? "—"} of ${rosters.length}`}
              </span>
            </div>
            <div className="flex flex-col gap-0.5 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                Strongest spot
              </span>
              <span className="text-2xl font-semibold">
                {rosterEmpty ? "—" : strongestPositions[0]}
              </span>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                {rosterEmpty
                  ? "nothing drafted yet"
                  : `#${myTeam.positionRanks[strongestPositions[0]] ?? "—"} of ${rosters.length}`}
              </span>
            </div>
          </div>
        </section>

        {/* Auto goals */}
        <section className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Target
              size={18}
              className="text-zinc-500 dark:text-zinc-400"
              aria-hidden
            />
            <h2 className="text-xl font-semibold tracking-tight">
              Auto goals
            </h2>
          </div>
          <div className="rounded-2xl border border-zinc-200 bg-white px-4 dark:border-zinc-800 dark:bg-zinc-900">
            <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
              {autoGoals.map((g) => (
                <GoalRow key={g.id} g={g} />
              ))}
            </ul>
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {profile.type === "dynasty"
              ? "Auto goals derive from your trajectory + RosterAudit data and update every page load."
              : "Auto goals derive from this league's standings, roster, and draft state, and update every page load."}
          </p>
        </section>

        {/* Custom goals */}
        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold tracking-tight">Custom goals</h2>
          <CustomGoals />
        </section>

        {/* Key dates */}
        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold tracking-tight">Key dates</h2>
          <ol className="flex flex-col divide-y divide-zinc-200 overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
            {dates
              .sort((a, b) => a.date.getTime() - b.date.getTime())
              .map((d) => {
                const past = d.date.getTime() < now.getTime();
                return (
                  <li
                    key={d.label}
                    className={`flex items-center gap-3 px-4 py-3 ${
                      past ? "opacity-60" : ""
                    }`}
                  >
                    <span className="w-44 shrink-0 text-xs font-semibold tabular-nums text-zinc-500 dark:text-zinc-400">
                      {formatDate(d.date)}
                    </span>
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-sm font-medium">{d.label}</span>
                      {d.blurb && (
                        <span className="text-xs text-zinc-500 dark:text-zinc-400">
                          {d.blurb}
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
          </ol>
        </section>

      </div>
    </main>
  );
}
