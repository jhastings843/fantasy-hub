import Link from "next/link";
import { CheckCircle2, Circle } from "lucide-react";
import { Chip, Disclosure, Num, Section, Spotlight, Stat, type Tone } from "@/components/hh/ui";
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

const TRAJECTORY_TONE: Record<Trajectory, Tone> = {
  contender: "accent",
  compete: "pos",
  reload: "gold",
  transition: "muted",
  rebuild: "neg",
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
      ? "text-hh-pos"
      : g.status === "in_progress"
        ? "text-hh-accent-ink"
        : "text-hh-muted";
  return (
    <li className="flex min-h-11 items-start gap-3 border-b border-hh-line py-3 last:border-b-0">
      <Icon size={18} className={`mt-0.5 shrink-0 ${iconCls}`} aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className={`text-sm ${
            g.status === "done" ? "text-hh-muted line-through" : "text-hh-ink"
          }`}
        >
          {g.text}
        </span>
        <div className="flex flex-wrap items-center gap-x-2 text-xs text-hh-muted">
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
        <Link href="/fantasy" className="inline-flex min-h-11 items-center text-sm text-hh-muted hover:text-hh-ink">
          ‹ Leagues
        </Link>
        <h1 className="hh-title">Season plan</h1>
        <p className="border-l-2 border-hh-neg py-1 pl-3 text-sm text-hh-neg">{message}</p>
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

  // The one action: the phase you are in, and the first goal still open.
  const openGoals = autoGoals.filter((g) => g.status !== "done");
  const doneGoals = autoGoals.filter((g) => g.status === "done");
  const topGoal = openGoals[0] ?? null;
  const sortedDates = [...dates].sort((a, b) => a.date.getTime() - b.date.getTime());
  const nextDate = sortedDates.find((d) => d.date.getTime() >= now.getTime()) ?? null;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-2">
          <Link
            href={`/l/${leagueId}`}
            className="inline-flex min-h-11 items-center self-start text-sm text-hh-muted hover:text-hh-ink"
          >
            ‹ League
          </Link>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h1 className="hh-title">Season plan</h1>
            <RefreshButton leagueId={leagueId} />
          </div>
          <p className="text-sm text-hh-muted">
            {league.name} · <Num>{league.season}</Num> · <Num>{rosters.length}</Num>-team{" "}
            {profile.superflex ? "superflex" : "one QB"} ·{" "}
            {profile.ppr === 1
              ? "PPR"
              : profile.ppr === 0.5
                ? "half PPR"
                : "standard"}
            {profile.tePremium > 0 ? " with TE premium" : ""}
          </p>
          {/* How this format is played. The goals below follow from it. */}
          <p className="max-w-2xl text-[15px] leading-relaxed text-hh-ink-2">
            {STRATEGY_SUMMARY[profile.type]}
          </p>
        </div>

        {/* The one spotlight: the phase you are in, and the top goal still open. */}
        <Spotlight
          label="Current phase"
          aside={
            nextDate ? (
              <>
                Next: {nextDate.label}, <Num>{formatDate(nextDate.date)}</Num>
              </>
            ) : undefined
          }
        >
          <p className="font-display text-2xl font-bold uppercase tracking-wide text-hh-ink">
            {phase.label}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-hh-ink-2">{phase.blurb}</p>
          {topGoal && (
            <p className="mt-3 text-[15px] leading-snug text-hh-ink-2">
              <b className="font-semibold text-hh-ink">Top goal:</b> {topGoal.text}
              {topGoal.current ? <span className="text-hh-muted"> (current: {topGoal.current}{topGoal.target ? `, target: ${topGoal.target}` : ""})</span> : null}
            </p>
          )}
        </Spotlight>

        {/* Trajectory is a dynasty concept: it reads RosterAudit's dynasty
            grades and age curves, neither of which means anything in a league
            that resets each year. */}
        {profile.type === "dynasty" && (
          <Section label="Team trajectory">
            <div className="flex flex-wrap items-center gap-3">
              <Chip tone={TRAJECTORY_TONE[trajectory]}>
                <span className="uppercase tracking-wide">{trajectoryLabel(trajectory)}</span>
              </Chip>
              {grade && (
                <span className="text-xs text-hh-muted">
                  Dynasty {grade.dynastyGrade} · Contender {grade.contenderGrade} · age{" "}
                  <Num>{grade.avgStarterAge.toFixed(1)}</Num>
                </span>
              )}
            </div>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-hh-ink-2">
              {trajectoryBlurb(trajectory)}
            </p>
          </Section>
        )}

        <Section label="Live progress">
          <div className="grid grid-cols-2 gap-x-6 gap-y-5 md:grid-cols-4">
            <Stat
              label="Team value"
              value={rosterEmpty ? "None" : myTeam.totalValue.toLocaleString()}
              sub={rosterEmpty ? "empty until the draft" : <>rank <Num>#{myStandingRank}</Num> of <Num>{rosters.length}</Num></>}
            />
            {/* RosterAudit grades dynasty rosters only, so a redraft league
                would show a permanent blank here. Before its draft the
                useful number is where you pick; after it, your record. */}
            {profile.type === "dynasty" ? (
              <Stat
                label="Dynasty rank"
                value={grade ? `#${grade.dynastyRank}` : "None"}
                sub={grade ? grade.dynastyGrade : "via RosterAudit"}
              />
            ) : profile.status === "pre_draft" ? (
              <Stat
                label="Draft slot"
                value={draftSlot ? `#${draftSlot}` : "TBD"}
                sub={
                  draftStart
                    ? draftStart.toLocaleDateString("en-US", {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                      })
                    : "not scheduled"
                }
              />
            ) : (
              <Stat
                label="Record"
                value={`${record.wins}-${record.losses}${record.ties > 0 ? `-${record.ties}` : ""}`}
                sub={
                  <>
                    <Num>#{standingRank}</Num> of <Num>{rosters.length}</Num> · <Num>{record.pointsFor.toFixed(1)}</Num> PF
                  </>
                }
              />
            )}
            <Stat
              label="Weakest spot"
              value={rosterEmpty ? "None" : weakestPositions[0]}
              tone={rosterEmpty ? undefined : "neg"}
              sub={
                rosterEmpty ? "nothing drafted yet" : (
                  <>
                    <Num>#{myTeam.positionRanks[weakestPositions[0]] ?? "?"}</Num> of <Num>{rosters.length}</Num>
                  </>
                )
              }
            />
            <Stat
              label="Strongest spot"
              value={rosterEmpty ? "None" : strongestPositions[0]}
              tone={rosterEmpty ? undefined : "pos"}
              sub={
                rosterEmpty ? "nothing drafted yet" : (
                  <>
                    <Num>#{myTeam.positionRanks[strongestPositions[0]] ?? "?"}</Num> of <Num>{rosters.length}</Num>
                  </>
                )
              }
            />
          </div>
        </Section>

        <Section
          label="Auto goals"
          aside={
            <>
              <Num>{openGoals.length}</Num> open · <Num>{doneGoals.length}</Num> done
            </>
          }
        >
          {openGoals.length > 0 ? (
            <ul className="flex flex-col">
              {openGoals.map((g) => (
                <GoalRow key={g.id} g={g} />
              ))}
            </ul>
          ) : (
            <p className="py-2 text-sm text-hh-muted">Every auto goal is done.</p>
          )}
          {doneGoals.length > 0 && (
            <Disclosure summary={<>Completed (<Num>{doneGoals.length}</Num>)</>} className="mt-2">
              <ul className="flex flex-col">
                {doneGoals.map((g) => (
                  <GoalRow key={g.id} g={g} />
                ))}
              </ul>
            </Disclosure>
          )}
          <p className="mt-2 text-xs text-hh-muted">
            {profile.type === "dynasty"
              ? "Auto goals derive from your trajectory + RosterAudit data and update every page load."
              : "Auto goals derive from this league's standings, roster, and draft state, and update every page load."}
          </p>
        </Section>

        <Section label="Custom goals">
          <CustomGoals />
        </Section>

        <Disclosure summary={<>Key dates (<Num>{sortedDates.length}</Num>)</>}>
          <ol className="flex flex-col">
            {sortedDates.map((d) => {
              const past = d.date.getTime() < now.getTime();
              return (
                <li
                  key={d.label}
                  className={`flex min-h-11 flex-col gap-1 border-b border-hh-line py-2.5 last:border-b-0 sm:flex-row sm:items-center sm:gap-3 ${
                    past ? "opacity-60" : ""
                  }`}
                >
                  <Num className="shrink-0 text-xs font-semibold text-hh-muted sm:w-44">
                    {formatDate(d.date)}
                  </Num>
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-sm font-medium text-hh-ink">{d.label}</span>
                    {d.blurb && <span className="text-xs text-hh-muted">{d.blurb}</span>}
                  </div>
                </li>
              );
            })}
          </ol>
        </Disclosure>
      </div>
    </main>
  );
}
