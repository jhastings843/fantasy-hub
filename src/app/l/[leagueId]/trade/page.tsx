import { latestWaivers } from "@/lib/jingles/ingest";
import Link from "next/link";
import {
  formatKeyFromLeague,
  getPicks,
  getRosterGrades,
} from "@/lib/rosteraudit/client";
import type { RAGradesByRosterId } from "@/lib/rosteraudit/types";
import { inferTrajectory } from "@/lib/dynasty/season-plan";
import { buildTradePlan, markPlanKeeps } from "@/lib/dynasty/trade-plan";
import { readGoals } from "@/lib/plan/goals-store";
import { computeTeamSummaries } from "@/lib/dynasty/power-rankings";
import { markUntouchables } from "@/lib/dynasty/untouchables";
import {
  getAllPlayers,
  getLeague,
  getLeagueRosters,
  getLeagueUsers,
  getUser,
} from "@/lib/sleeper/client";
import TradeBuilder from "./TradeBuilder";
import { RefreshButton } from "@/components/RefreshButton";
import { getValuesForProfile } from "@/lib/values";
import { profileFromSleeper } from "@/lib/league/detect";
import { jinglesAppliesTo } from "@/lib/jingles/data";
import { activeLab } from "@/lib/jingles/active";
import { blendWithJingles } from "@/lib/redraft/jingles-values";
import type { JinglesBlendInfo } from "./TradeBuilder";
import type { PlayerValuesBySleeperId } from "@/lib/dynasty/power-rankings";

export const dynamic = "force-dynamic";

function ConfigError({ message }: { message: string }) {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10 text-hh-ink sm:px-6 lg:px-8">
      <div className="flex max-w-2xl flex-col gap-3">
        <Link
          href="/fantasy"
          className="text-sm text-hh-muted hover:text-hh-accent-ink"
        >
          ‹ Leagues
        </Link>
        <h1 className="hh-title">Trade analyzer</h1>
        <p className="border-l-2 border-hh-neg py-1 pl-3 text-sm text-hh-neg">
          {message}
        </p>
      </div>
    </main>
  );
}

export default async function TradePage({
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
  const raFormat = formatKeyFromLeague(league);
  const isSuperflex = raFormat.startsWith("sf");

  const profile = profileFromSleeper(league);

  // His season list is redraft research, so it prices redraft trades and
  // stays out of dynasty ones (the same rule the badges and draft board use).
  const readsJingles = jinglesAppliesTo(profile.type);

  const [me, rosters, users, players, marketValues, picks, lab] = await Promise.all([
    getUser(username),
    getLeagueRosters(leagueId),
    getLeagueUsers(leagueId),
    getAllPlayers(),
    getValuesForProfile(profile, league).then((r) => r.values),
    // Rookie picks exist in dynasty and nowhere else. Fetching them for a
    // redraft league was not just wasted work, it fed a UI that offered them.
    profile.type === "dynasty" ? getPicks() : Promise.resolve([]),
    readsJingles ? activeLab(profile) : Promise.resolve(null),
  ]);
  // His newest waiver post's "Players I'm Fine Dropping". Redraft only, like
  // the rest of his lists: he writes it for "normal redraft leagues".
  const hisDrops = readsJingles
    ? new Set(((await latestWaivers())?.fineDropping ?? []).map((d) => d.sleeperId).filter(Boolean) as string[])
    : new Set<string>();

  // Half the market, half his list. See lib/redraft/jingles-values.ts.
  let fcValues: PlayerValuesBySleeperId = marketValues;
  let jingles: JinglesBlendInfo | null = null;
  // His season list prices trades only while it is current (two weeks). The
  // Sep 5 Lab 300 was still moving week 4 trade values by half.
  // Server component on a force-dynamic page: reading the clock per request is the point.
  const labCurrent =
    !!lab && lab.list.length > 0 && !!lab.postedAt &&
    // eslint-disable-next-line react-hooks/purity
    Date.now() - new Date(lab.postedAt).getTime() < 14 * 24 * 60 * 60 * 1000;
  if (lab && (labCurrent || hisDrops.size > 0)) {
    const blend = blendWithJingles(
      marketValues,
      labCurrent ? { entries: lab.list, byId: lab.byId } : { entries: [], byId: {} },
      undefined,
      hisDrops,
    );
    fcValues = blend.values;
    // The banner describes his season list; with only a drop list applied
    // there is no list to credit, and the J drop chips speak for themselves.
    if (labCurrent) jingles = {
      title: lab.title,
      url: lab.url,
      postedAt: lab.postedAt,
      matchesLeagueScoring: lab.matchesLeagueScoring,
      ranked: lab.list.length,
      moved: blend.moved,
    };
  }

  // What each roster has left to spend, which is the budget minus what they have
  // already used. Sleeper reports the spend, not the remainder.
  const faabByRosterId: Record<number, number> = {};
  if (profile.faab !== null) {
    for (const r of rosters) {
      const used = typeof r.settings?.waiver_budget_used === "number" ? r.settings.waiver_budget_used : 0;
      faabByRosterId[r.roster_id] = Math.max(0, profile.faab - used);
    }
  }

  const myRoster = rosters.find((r) => r.owner_id === me.user_id);
  if (!myRoster) {
    return (
      <ConfigError
        message={`No roster found in this league for ${username}.`}
      />
    );
  }

  const teams = computeTeamSummaries(rosters, users, players, fcValues);
  // Do-not-trade list (lib/dynasty/untouchables): recommenders skip these
  // and the analyzer declines any proposal that includes one.
  markUntouchables(teams, leagueId, myRoster.roster_id);

  // The season plan for this league (lib/dynasty/trade-plan): trajectory from
  // the same RosterAudit grade the plan page reads (dynasty only), plus Jack's
  // open goals. Keepers join the do-not-trade list.
  const [grades, goalsRead] = await Promise.all([
    profile.type === "dynasty"
      ? getRosterGrades(leagueId, me.user_id).catch((): RAGradesByRosterId => ({}))
      : Promise.resolve({} as RAGradesByRosterId),
    readGoals(leagueId),
  ]);
  const myTeam = teams.find((t) => t.rosterId === myRoster.roster_id);
  const plan = buildTradePlan({
    leagueType: profile.type,
    trajectory: profile.type === "dynasty" ? inferTrajectory(grades[myRoster.roster_id] ?? null) : null,
    goals: goalsRead.ok ? goalsRead.goals : [],
    myPlayers: myTeam?.players ?? [],
  });
  if (myTeam) markPlanKeeps(myTeam.players, plan);

  return (
    <main className="mx-auto w-full min-w-0 max-w-7xl break-words px-4 py-8 text-hh-ink sm:px-6 lg:px-8">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <Link
            href={`/l/${leagueId}`}
            className="text-sm text-hh-muted hover:text-hh-accent-ink"
          >
            ‹ League
          </Link>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h1 className="hh-title">Trade analyzer</h1>
            <RefreshButton leagueId={leagueId} />
          </div>
          <p className="text-sm text-hh-muted">
            {league.name} · <span className="hh-num">{league.season}</span>
          </p>
        </div>
        <TradeBuilder
          teams={teams}
          myRosterId={myRoster.roster_id}
          picks={picks}
          isSuperflex={isSuperflex}
          leagueType={profile.type}
          faabBudget={profile.faab}
          faabByRosterId={faabByRosterId}
          jingles={jingles}
          plan={plan}
          planLoaded={goalsRead.ok}
          leagueId={leagueId}
        />

      </div>
    </main>
  );
}
