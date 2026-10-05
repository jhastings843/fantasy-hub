import { latestWaivers } from "@/lib/jingles/ingest";
import Link from "next/link";
import {
  formatKeyFromLeague,
  getPicks,
} from "@/lib/rosteraudit/client";
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
    <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex max-w-2xl flex-col gap-3">
        <Link
          href="/"
          className="text-sm text-zinc-500 dark:text-zinc-400"
        >
          ‹ Leagues
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">
          Trade analyzer
        </h1>
        <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 dark:bg-red-950/50 dark:text-red-300">
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
  const labCurrent =
    !!lab && lab.list.length > 0 && !!lab.postedAt &&
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

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <Link
            href={`/l/${leagueId}`}
            className="text-sm text-zinc-500 dark:text-zinc-400"
          >
            ‹ League
          </Link>
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h1 className="text-3xl font-semibold tracking-tight">
              Trade analyzer
            </h1>
            <RefreshButton leagueId={leagueId} />
          </div>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {league.name} · {league.season}
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
        />

      </div>
    </main>
  );
}
