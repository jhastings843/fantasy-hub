import Link from "next/link";
import { Clock, Trophy } from "lucide-react";
import {
  formatKeyFromLeague,
  getAllPicks,
} from "@/lib/rosteraudit/client";
import type { PickSlot, RAPick } from "@/lib/rosteraudit/types";
import {
  getAllPlayers,
  getDraftPicks,
  getLeague,
  getLeagueDrafts,
  getLeagueRosters,
  getTradedPicks,
  getUser,
} from "@/lib/sleeper/client";
import type { SleeperPlayer } from "@/lib/sleeper/types";
import { AutoRefresh } from "@/components/AutoRefresh";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { PlayerLink } from "@/components/PlayerLink";
import { RefreshButton } from "@/components/RefreshButton";
import { RookieList, type NextPickRef, type RookieRow } from "./RookieList";
import { RoundTargets } from "./RoundTargets";
import { Recommendations } from "./Recommendations";
import { buildRecommendations } from "@/lib/dynasty/draft-recommender";
import { getKTCValues, ktcFormatFromLeague } from "@/lib/ktc/client";
import type { KTCByName } from "@/lib/ktc/types";
import { getValuesForProfile } from "@/lib/values";
import { profileFromSleeper } from "@/lib/league/detect";
import { RedraftDraft } from "./RedraftDraft";

export const dynamic = "force-dynamic";

const TRADE_POSITIONS = ["QB", "RB", "WR", "TE"] as const;

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
        <h1 className="text-3xl font-semibold tracking-tight">Draft helper</h1>
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

function formatStartTime(ms: number | null | undefined): string | null {
  if (!ms) return null;
  const d = new Date(ms);
  return d.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function slotZone(slot: number, teams: number): PickSlot {
  const third = teams / 3;
  if (slot <= Math.ceil(third)) return "early";
  if (slot > Math.ceil(third * 2)) return "late";
  return "mid";
}

function gradeFromPct(pct: number, picksMade: number): string {
  if (picksMade === 0) return "—";
  if (pct >= 0.3) return "A+";
  if (pct >= 0.18) return "A";
  if (pct >= 0.1) return "A-";
  if (pct >= 0.04) return "B+";
  if (pct >= -0.04) return "B";
  if (pct >= -0.1) return "B-";
  if (pct >= -0.18) return "C";
  if (pct >= -0.3) return "D";
  return "F";
}

function gradeTint(grade: string): { tile: string; shadow: string; pill: string } {
  if (grade.startsWith("A")) {
    return {
      tile: "from-emerald-400 to-emerald-600",
      shadow: "shadow-emerald-500/40",
      pill: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300",
    };
  }
  if (grade.startsWith("B")) {
    return {
      tile: "from-sky-400 to-sky-600",
      shadow: "shadow-sky-500/30",
      pill: "bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-300",
    };
  }
  if (grade.startsWith("C")) {
    return {
      tile: "from-zinc-400 to-zinc-600",
      shadow: "shadow-zinc-500/20",
      pill: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
    };
  }
  if (grade.startsWith("D")) {
    return {
      tile: "from-amber-400 to-orange-500",
      shadow: "shadow-amber-500/30",
      pill: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
    };
  }
  return {
    tile: "from-rose-400 to-rose-600",
    shadow: "shadow-rose-500/30",
    pill: "bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300",
  };
}

function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

interface UserPick {
  pickNo: number;
  round: number;
  slot: number;
  zone: PickSlot;
  label: string;
  value: number | null;
}

function buildUserPicks(
  pickNos: number[],
  totalTeams: number,
  season: number,
  raPicks: RAPick[],
  isSuperflex: boolean,
): UserPick[] {
  return pickNos.map((pickNo) => {
    const round = Math.ceil(pickNo / totalTeams);
    const slot = ((pickNo - 1) % totalTeams) + 1;
    const zone = slotZone(slot, totalTeams);
    const label = `${round}.${slot.toString().padStart(2, "0")} ${zone.charAt(0).toUpperCase() + zone.slice(1)} ${ordinal(round)}`;
    const ra = raPicks.find(
      (p) => p.season === season && p.round === round && p.slot === zone,
    );
    const value = ra ? (isSuperflex ? ra.valueSf : ra.value1qb) : null;
    return { pickNo, round, slot, zone, label, value };
  });
}

export default async function DraftPage({
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
  const profile = profileFromSleeper(league);

  // Everything below this point is the rookie draft: it filters to first-year
  // players and reasons about age and long-term runway. That is the wrong tool
  // for a redraft or guillotine draft, where the whole pool is on the board and
  // nothing carries past this season.
  if (profile.type !== "dynasty") {
    const { values } = await getValuesForProfile(profile, league);
    return (
      <RedraftDraft
        leagueId={leagueId}
        profile={profile}
        myUserId={me.user_id}
        values={values}
      />
    );
  }

  const raFormat = formatKeyFromLeague(league);

  const ktcFormat = ktcFormatFromLeague(league);
  const [drafts, rosters, players, fcValues, raPicks, ktcByName, tradedPicks] =
    await Promise.all([
      getLeagueDrafts(leagueId),
      getLeagueRosters(leagueId),
      getAllPlayers(),
      getValuesForProfile(profileFromSleeper(league), league).then((r) => r.values),
      getAllPicks(),
      getKTCValues(ktcFormat).catch((): KTCByName => ({})),
      getTradedPicks(leagueId).catch(() => []),
    ]);

  if (drafts.length === 0) {
    return (
      <ConfigError message="No drafts found for this league. Check Sleeper." />
    );
  }

  const draft = drafts[0];
  const picks = await getDraftPicks(draft.draft_id).catch(() => []);
  const myRoster = rosters.find((r) => r.owner_id === me.user_id) ?? null;
  const totalRounds = draft.settings?.rounds ?? 4;
  const totalTeams = draft.settings?.teams ?? rosters.length ?? 12;

  const drafted = new Set(picks.map((p) => p.player_id));

  const isRookie = (p: SleeperPlayer) =>
    typeof p.years_exp === "number" && p.years_exp === 0;

  const rookies = Object.values(players)
    .filter(isRookie)
    .map((p) => {
      const v = fcValues[p.player_id];
      return {
        ...p,
        value: v?.value ?? 0,
        rank: v?.overallRank ?? 999999,
        positionRank: v?.positionRank ?? 0,
        photoUrl: v?.photoUrl ?? null,
      };
    })
    .filter((p) => p.value > 0)
    .sort((a, b) => b.value - a.value);

  const available = rookies.filter((p) => !drafted.has(p.player_id));
  const rookieRows: RookieRow[] = available.map((p) => {
    const v = fcValues[p.player_id];
    return {
      id: p.player_id,
      name: nameOf(p),
      position: p.position ?? null,
      team: p.team ?? null,
      age: typeof p.age === "number" ? p.age : null,
      value: p.value,
      rank: p.rank,
      positionRank: p.positionRank,
      photoUrl: p.photoUrl,
      buyLow: v?.buyLow ?? false,
      sellHigh: v?.sellHigh ?? false,
      breakout: v?.breakout ?? false,
    };
  });

  // Compute weakest positions from the FULL roster + any rookies the
  // user has drafted in this active draft (whether or not Sleeper has
  // already added them to the roster). De-duped via Set so we never
  // double-count.
  const myDraftedIds = picks
    .filter((pk) => pk.picked_by === me.user_id)
    .map((pk) => pk.player_id);
  const effectivePlayerIds = new Set<string>([
    ...(myRoster?.players ?? []),
    ...myDraftedIds,
  ]);

  const localPosValues: Record<string, number> = { QB: 0, RB: 0, WR: 0, TE: 0 };
  const draftedByMeByPos: Record<string, number> = {};
  for (const pid of effectivePlayerIds) {
    const p = players[pid];
    if (!p?.position || !(p.position in localPosValues)) continue;
    localPosValues[p.position] += fcValues[pid]?.value ?? 0;
  }
  for (const pid of myDraftedIds) {
    const p = players[pid];
    if (!p?.position || !(p.position in localPosValues)) continue;
    draftedByMeByPos[p.position] = (draftedByMeByPos[p.position] ?? 0) + 1;
  }
  const weakestPositions = [...TRADE_POSITIONS]
    .sort((a, b) => localPosValues[a] - localPosValues[b])
    .slice(0, 2);

  // Compute pick number for a given roster's pick in a given round,
  // accounting for snake direction.
  function pickNumberFor(
    rosterId: number,
    round: number,
  ): number | null {
    const roster = rosters.find((r) => r.roster_id === rosterId);
    if (!roster?.owner_id) return null;
    const slot = draft.draft_order?.[roster.owner_id];
    if (!slot) return null;
    if (draft.type === "snake") {
      const slotInRound = round % 2 === 1 ? slot : totalTeams - slot + 1;
      return (round - 1) * totalTeams + slotInRound;
    }
    return (round - 1) * totalTeams + slot;
  }

  const myRosterId = myRoster?.roster_id ?? null;
  const seasonStr = draft.season ?? new Date().getFullYear().toString();

  // Start with the user's default picks (one per round at their slot).
  type ResolvedPick = {
    season: string;
    round: number;
    originalRosterId: number;
    pickNo: number;
  };
  const myResolvedPicks: ResolvedPick[] = [];
  if (myRosterId != null) {
    for (let r = 1; r <= totalRounds; r++) {
      const pn = pickNumberFor(myRosterId, r);
      if (pn != null) {
        myResolvedPicks.push({
          season: seasonStr,
          round: r,
          originalRosterId: myRosterId,
          pickNo: pn,
        });
      }
    }
  }

  // Apply traded picks scoped to this draft's season.
  const seasonTradedPicks = tradedPicks.filter(
    (tp) => tp.season === seasonStr,
  );

  // Remove picks I gave away (my originals where current owner != me).
  const givenAway = new Set(
    seasonTradedPicks
      .filter(
        (tp) => tp.roster_id === myRosterId && tp.owner_id !== myRosterId,
      )
      .map((tp) => tp.round),
  );
  const afterGiven = myResolvedPicks.filter((p) => !givenAway.has(p.round));

  // Add picks I received (where I'm now the owner of someone else's pick).
  const received = seasonTradedPicks.filter(
    (tp) => tp.owner_id === myRosterId && tp.roster_id !== myRosterId,
  );
  for (const tp of received) {
    const pn = pickNumberFor(tp.roster_id, tp.round);
    if (pn != null) {
      afterGiven.push({
        season: tp.season,
        round: tp.round,
        originalRosterId: tp.roster_id,
        pickNo: pn,
      });
    }
  }

  // Sort by pickNo
  afterGiven.sort((a, b) => a.pickNo - b.pickNo);

  const isSuperflex = raFormat.startsWith("sf");
  const seasonNum = Number(seasonStr);
  const myPickNumbers = afterGiven.map((p) => p.pickNo);
  const userPicks = buildUserPicks(
    myPickNumbers,
    totalTeams,
    seasonNum,
    raPicks,
    isSuperflex,
  );

  // Map of pickNo -> originalRosterId for "via" annotation
  const pickOriginalOwner = new Map<number, number>();
  for (const p of afterGiven) {
    pickOriginalOwner.set(p.pickNo, p.originalRosterId);
  }

  // Map of pickNo -> draft pick if made
  const draftPickByPickNo = new Map<number, (typeof picks)[number]>();
  for (const pk of picks) draftPickByPickNo.set(pk.pick_no, pk);

  const totalPickValue = userPicks.reduce(
    (s, p) => s + (p.value ?? 0),
    0,
  );

  // Find the user's next pick (first unused pick in order).
  const madePickNos = new Set(picks.map((pk) => pk.pick_no));
  const nextUserPick = userPicks.find(
    (p) => !madePickNos.has(p.pickNo) && p.value != null,
  );
  const nextPickRef: NextPickRef | null = nextUserPick
    ? {
        label: `${nextUserPick.round}.${nextUserPick.slot.toString().padStart(2, "0")}`,
        value: nextUserPick.value!,
      }
    : null;

  // Pick currently up next overall in the draft (1-based)
  const currentOverallPick = picks.length + 1;
  // Picks remaining until user's next pick
  const picksUntilUserUp = nextUserPick
    ? Math.max(0, nextUserPick.pickNo - currentOverallPick)
    : null;
  const userIsOnTheClock = nextUserPick
    ? nextUserPick.pickNo === currentOverallPick
    : false;

  const recommendations = buildRecommendations({
    rookies: rookieRows,
    nextPickValue: nextPickRef?.value ?? null,
    nextPickLabel: nextPickRef?.label ?? null,
    weakestPositions: weakestPositions as string[],
    ktcByName,
    limit: 3,
  });

  const startTime = formatStartTime(draft.start_time ?? null);

  // Post-draft summary stats. Computed unconditionally; only rendered
  // as a hero when draft.status === "complete".
  const myDraftedPicks = picks
    .filter((pk) => pk.picked_by === me.user_id)
    .sort((a, b) => a.pick_no - b.pick_no);
  const draftedSum = myDraftedPicks.reduce(
    (s, pk) => s + (fcValues[pk.player_id]?.value ?? 0),
    0,
  );
  const expectedSum = myDraftedPicks.reduce((s, pk) => {
    const u = userPicks.find((up) => up.pickNo === pk.pick_no);
    return s + (u?.value ?? 0);
  }, 0);
  const surplusSum = draftedSum - expectedSum;
  const pctSurplus = expectedSum > 0 ? surplusSum / expectedSum : 0;
  const myGrade = gradeFromPct(pctSurplus, myDraftedPicks.length);
  const myGradeTint = gradeTint(myGrade);
  const draftComplete = draft.status === "complete";

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
            <h1 className="text-3xl font-semibold tracking-tight">
              {draftComplete ? "Draft recap" : "Draft helper"}
            </h1>
            <div className="flex items-center gap-2">
              <RefreshButton leagueId={leagueId} />
              <Link
                href={`/l/${leagueId}/draft/board`}
                className="inline-flex items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800"
              >
                {draftComplete ? "League grades →" : "League board →"}
              </Link>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${
                  draft.status === "drafting"
                    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
                    : draft.status === "complete"
                      ? "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                      : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                }`}
              >
                <Clock size={12} aria-hidden />
                {draft.status === "pre_draft"
                  ? "Pre-draft"
                  : draft.status === "drafting"
                    ? "Drafting"
                    : draft.status === "complete"
                      ? "Complete"
                      : draft.status}
              </span>
            </div>
          </div>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {league.name} · {draft.season} · {totalRounds}-round {draft.type}{" "}
            draft
            {startTime && ` · ${draftComplete ? "completed" : "starts"} ${startTime}`}
          </p>
          {!draftComplete && (
            <AutoRefresh
              intervalMs={
                draft.status === "drafting" ? 60_000 : 5 * 60_000
              }
              label={
                draft.status === "drafting"
                  ? "Live updates"
                  : "Refreshes"
              }
            />
          )}
        </div>

        {draftComplete && myDraftedPicks.length > 0 && (
          <section className="flex flex-col gap-4 rounded-3xl border border-zinc-200/80 bg-gradient-to-br from-white via-white to-emerald-50/40 p-6 backdrop-blur dark:border-zinc-800/80 dark:from-zinc-900 dark:via-zinc-900 dark:to-emerald-950/15">
            <div className="flex flex-wrap items-center gap-5">
              <div
                className={`grid size-24 place-items-center rounded-2xl bg-gradient-to-br ${myGradeTint.tile} text-4xl font-black text-white shadow-lg ${myGradeTint.shadow}`}
              >
                {myGrade}
              </div>
              <div className="flex min-w-0 flex-col gap-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Your draft grade
                </span>
                <span className="text-2xl font-bold tracking-tight">
                  {surplusSum >= 0 ? "Won " : "Lost "}
                  <span
                    className={`tabular-nums ${
                      surplusSum >= 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-rose-600 dark:text-rose-400"
                    }`}
                  >
                    {surplusSum >= 0 ? "+" : ""}
                    {surplusSum.toLocaleString()}
                  </span>{" "}
                  value over expected
                </span>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {(pctSurplus * 100).toFixed(1)}% surplus across{" "}
                  {myDraftedPicks.length} pick
                  {myDraftedPicks.length === 1 ? "" : "s"}. See how you stack up
                  on the league grades page.
                </span>
              </div>
              <div className="ml-auto flex flex-col gap-2 sm:flex-row">
                <div className="flex flex-col rounded-xl border border-zinc-200/80 bg-white/60 px-3 py-2 dark:border-zinc-800/80 dark:bg-zinc-900/60">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                    Drafted value
                  </span>
                  <span className="text-lg font-bold tabular-nums">
                    {draftedSum.toLocaleString()}
                  </span>
                </div>
                <div className="flex flex-col rounded-xl border border-zinc-200/80 bg-white/60 px-3 py-2 dark:border-zinc-800/80 dark:bg-zinc-900/60">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                    Expected
                  </span>
                  <span className="text-lg font-bold tabular-nums text-zinc-500 dark:text-zinc-400">
                    {expectedSum.toLocaleString()}
                  </span>
                </div>
              </div>
            </div>
          </section>
        )}

        {!draftComplete && (
        <div className="grid gap-4 md:grid-cols-3">
          {/* Next pick card */}
          <div className="flex flex-col gap-4 rounded-2xl border border-zinc-200/80 bg-gradient-to-br from-white to-sky-50/30 p-5 backdrop-blur dark:border-zinc-800/80 dark:from-zinc-900 dark:to-sky-950/10">
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Your next pick
            </span>
            {nextUserPick ? (
              <>
                <div className="flex items-center gap-4">
                  <span
                    className={`grid size-20 place-items-center rounded-2xl bg-gradient-to-br text-2xl font-black tracking-tighter text-white shadow-lg ${
                      userIsOnTheClock
                        ? "from-emerald-400 to-emerald-600 shadow-emerald-500/40"
                        : "from-sky-400 to-sky-600 shadow-sky-500/30"
                    }`}
                  >
                    {nextUserPick.round}.
                    {nextUserPick.slot.toString().padStart(2, "0")}
                  </span>
                  <div className="flex min-w-0 flex-col gap-0.5">
                    {userIsOnTheClock ? (
                      <span className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                        On the clock
                      </span>
                    ) : (
                      <span className="text-3xl font-black tracking-tight tabular-nums">
                        {picksUntilUserUp}
                      </span>
                    )}
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                      {userIsOnTheClock
                        ? `pick ${nextUserPick.pickNo} of ${totalTeams * totalRounds}`
                        : `pick${picksUntilUserUp === 1 ? "" : "s"} until your turn`}
                    </span>
                  </div>
                </div>

                {/* Detail grid */}
                <dl className="grid grid-cols-2 gap-3 border-t border-zinc-200/60 pt-3 text-xs dark:border-zinc-800/60">
                  <div className="flex flex-col gap-0.5">
                    <dt className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                      Round / zone
                    </dt>
                    <dd className="font-semibold">
                      {nextUserPick.zone.charAt(0).toUpperCase() +
                        nextUserPick.zone.slice(1)}{" "}
                      {ordinal(nextUserPick.round)}
                    </dd>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <dt className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                      Pick value
                    </dt>
                    <dd className="font-semibold tabular-nums">
                      {nextUserPick.value != null
                        ? nextUserPick.value.toLocaleString()
                        : "—"}
                    </dd>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <dt className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                      Overall pick
                    </dt>
                    <dd className="font-semibold tabular-nums">
                      #{nextUserPick.pickNo} of {totalTeams * totalRounds}
                    </dd>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <dt className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                      Source
                    </dt>
                    <dd className="font-semibold">
                      {pickOriginalOwner.get(nextUserPick.pickNo) !==
                      myRoster?.roster_id
                        ? `via roster ${pickOriginalOwner.get(nextUserPick.pickNo)}`
                        : "Your original"}
                    </dd>
                  </div>
                </dl>

                {/* Draft progress bar */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-baseline justify-between text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                    <span>Draft progress</span>
                    <span className="tabular-nums">
                      {picks.length} / {totalTeams * totalRounds}
                    </span>
                  </div>
                  <div className="relative h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                    {/* Picks made fill */}
                    <div
                      className="absolute inset-y-0 left-0 bg-zinc-400 dark:bg-zinc-600"
                      style={{
                        width: `${
                          (picks.length / (totalTeams * totalRounds)) * 100
                        }%`,
                      }}
                    />
                    {/* User's next-pick marker */}
                    <div
                      className="absolute inset-y-0 w-0.5 bg-sky-500"
                      style={{
                        left: `calc(${
                          ((nextUserPick.pickNo - 1) /
                            (totalTeams * totalRounds)) *
                          100
                        }% - 1px)`,
                      }}
                      aria-label="Your next pick"
                    />
                  </div>
                </div>
              </>
            ) : (
              <span className="text-sm text-zinc-400 dark:text-zinc-600">
                All your picks made.
              </span>
            )}
          </div>

          {/* Picks card */}
          <div className="flex flex-col gap-3 rounded-2xl border border-zinc-200/80 bg-white/80 p-5 backdrop-blur dark:border-zinc-800/80 dark:bg-zinc-900/80">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                Your picks
              </span>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                total{" "}
                <span className="font-bold tabular-nums text-zinc-900 dark:text-zinc-50">
                  {totalPickValue.toLocaleString()}
                </span>
              </span>
            </div>
            {userPicks.length === 0 ? (
              <span className="text-sm text-zinc-400 dark:text-zinc-600">—</span>
            ) : (
              <ul className="flex flex-col divide-y divide-zinc-100 dark:divide-zinc-800/60">
                {userPicks.map((p) => {
                  const made = draftPickByPickNo.get(p.pickNo);
                  const draftedPlayer = made
                    ? players[made.player_id]
                    : null;
                  const draftedValue = made
                    ? fcValues[made.player_id]?.value ?? 0
                    : null;
                  const originalRoster = pickOriginalOwner.get(p.pickNo);
                  const isReceivedPick =
                    originalRoster != null &&
                    originalRoster !== myRoster?.roster_id;
                  return (
                    <li
                      key={p.pickNo}
                      className={`flex items-center justify-between gap-2 py-1.5 text-sm ${
                        made ? "opacity-70" : ""
                      }`}
                    >
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold tabular-nums">
                            {p.round}.{p.slot.toString().padStart(2, "0")}
                          </span>
                          {draftedPlayer ? (
                            <span className="truncate text-xs font-medium text-zinc-700 dark:text-zinc-200">
                              {draftedPlayer.full_name ??
                                `${draftedPlayer.first_name ?? ""} ${draftedPlayer.last_name ?? ""}`.trim()}
                            </span>
                          ) : (
                            <span className="text-xs text-zinc-500 dark:text-zinc-400">
                              {p.zone.charAt(0).toUpperCase() +
                                p.zone.slice(1)}{" "}
                              {ordinal(p.round)}
                            </span>
                          )}
                        </div>
                        {isReceivedPick && (
                          <span className="text-[10px] text-zinc-500 dark:text-zinc-500">
                            via roster {originalRoster}
                          </span>
                        )}
                      </div>
                      <span className="shrink-0 text-xs font-bold tabular-nums text-zinc-700 dark:text-zinc-300">
                        {draftedValue != null
                          ? draftedValue.toLocaleString()
                          : p.value != null
                            ? p.value.toLocaleString()
                            : "—"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Target positions card — per-position colors */}
          <div className="flex flex-col gap-3 rounded-2xl border border-zinc-200/80 bg-white/80 p-5 backdrop-blur dark:border-zinc-800/80 dark:bg-zinc-900/80">
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Target positions
            </span>
            <div className="flex flex-wrap gap-2">
              {weakestPositions.length > 0 ? (
                weakestPositions.map((pos) => {
                  const positionTints: Record<
                    string,
                    { grad: string; shadow: string }
                  > = {
                    QB: {
                      grad: "from-rose-400 to-rose-600",
                      shadow: "shadow-rose-500/30",
                    },
                    RB: {
                      grad: "from-emerald-400 to-emerald-600",
                      shadow: "shadow-emerald-500/30",
                    },
                    WR: {
                      grad: "from-sky-400 to-sky-600",
                      shadow: "shadow-sky-500/30",
                    },
                    TE: {
                      grad: "from-amber-400 to-orange-500",
                      shadow: "shadow-amber-500/30",
                    },
                  };
                  const tint = positionTints[pos] ?? {
                    grad: "from-zinc-400 to-zinc-600",
                    shadow: "shadow-zinc-500/20",
                  };
                  const filledCount = draftedByMeByPos[pos] ?? 0;
                  return (
                    <span
                      key={pos}
                      className="relative inline-flex items-center"
                    >
                      <span
                        className={`rounded-xl bg-gradient-to-br ${tint.grad} ${tint.shadow} px-4 py-2 text-lg font-black tracking-tight text-white shadow-md`}
                      >
                        {pos}
                      </span>
                      {filledCount > 0 && (
                        <span className="absolute -right-2 -top-2 grid size-5 place-items-center rounded-full bg-emerald-500 text-[10px] font-bold text-white shadow-md ring-2 ring-white dark:ring-zinc-900">
                          ✓
                        </span>
                      )}
                    </span>
                  );
                })
              ) : (
                <span className="text-zinc-500 dark:text-zinc-400">—</span>
              )}
            </div>
            <span className="mt-auto text-xs text-zinc-500 dark:text-zinc-400">
              {Object.keys(draftedByMeByPos).length > 0
                ? `Live update: ${Object.entries(draftedByMeByPos)
                    .map(([p, n]) => `${n} ${p}${n === 1 ? "" : "s"}`)
                    .join(" + ")} drafted`
                : "your weakest by total roster value"}
            </span>
          </div>
        </div>
        )}

        {!draftComplete && (
          <Recommendations
            recommendations={recommendations}
            nextPickLabel={nextPickRef?.label ?? null}
          />
        )}

        {!draftComplete && (
          <section className="flex flex-col gap-3">
            <header className="flex items-baseline justify-between">
              <h2 className="text-xl font-semibold tracking-tight">
                Best available rookies
              </h2>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                {available.length} remaining · {drafted.size} drafted
              </span>
            </header>
            <RookieList
              rookies={rookieRows}
              weakestPositions={weakestPositions as string[]}
              nextPick={nextPickRef}
            />
          </section>
        )}

        {(() => {
          const myPicks = picks
            .filter((pk) => pk.picked_by === me.user_id)
            .sort((a, b) => a.pick_no - b.pick_no);
          if (myPicks.length === 0) return null;

          // Compute total drafted value + surplus vs the picks I used.
          const drafted = myPicks.reduce(
            (s, pk) => s + (fcValues[pk.player_id]?.value ?? 0),
            0,
          );
          const expected = myPicks.reduce((s, pk) => {
            const u = userPicks.find((up) => up.pickNo === pk.pick_no);
            return s + (u?.value ?? 0);
          }, 0);
          const surplus = drafted - expected;

          return (
            <section className="flex flex-col gap-3">
              <div className="flex items-baseline justify-between">
                <h2 className="text-xl font-semibold tracking-tight">
                  {draftComplete ? "Your picks" : "Your draft so far"}
                </h2>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {myPicks.length} of {userPicks.length} picks
                </span>
              </div>
              <div className="flex flex-col gap-3 rounded-2xl border border-zinc-200/80 bg-gradient-to-br from-white to-emerald-50/20 p-4 backdrop-blur dark:border-zinc-800/80 dark:from-zinc-900 dark:to-emerald-950/10">
                <div className="flex flex-wrap items-center gap-6 border-b border-zinc-200/60 pb-3 dark:border-zinc-800/60">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                      Drafted value
                    </span>
                    <span className="text-2xl font-bold tabular-nums">
                      {drafted.toLocaleString()}
                    </span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                      Expected
                    </span>
                    <span className="text-2xl font-bold tabular-nums text-zinc-500 dark:text-zinc-400">
                      {expected.toLocaleString()}
                    </span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                      Surplus
                    </span>
                    <span
                      className={`text-2xl font-bold tabular-nums ${
                        surplus >= 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-rose-600 dark:text-rose-400"
                      }`}
                    >
                      {surplus >= 0 ? "+" : ""}
                      {surplus.toLocaleString()}
                    </span>
                  </div>
                </div>
                <ul className="flex flex-col gap-2">
                  {myPicks.map((pk) => {
                    const p = players[pk.player_id];
                    const v = fcValues[pk.player_id];
                    if (!p) return null;
                    const u = userPicks.find((up) => up.pickNo === pk.pick_no);
                    const playerVal = v?.value ?? 0;
                    const expectedVal = u?.value ?? 0;
                    const pickSurplus = playerVal - expectedVal;
                    return (
                      <li
                        key={pk.pick_no}
                        className="flex items-center gap-3"
                      >
                        <span className="w-14 shrink-0 text-sm font-bold tabular-nums">
                          {pk.round}.{pk.draft_slot.toString().padStart(2, "0")}
                        </span>
                        <PlayerAvatar
                          name={nameOf(p)}
                          position={p.position ?? null}
                          photoUrl={v?.photoUrl ?? null}
                          size="sm"
                        />
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <PlayerLink
                            id={p.player_id}
                            name={nameOf(p)}
                            className="truncate text-sm font-semibold"
                          />
                          <span className="text-xs text-zinc-500 dark:text-zinc-400">
                            {[p.team ?? "FA", p.position]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </div>
                        <div className="flex shrink-0 flex-col items-end">
                          <span className="text-sm font-semibold tabular-nums">
                            {playerVal.toLocaleString()}
                          </span>
                          {Math.abs(pickSurplus) >= 50 && (
                            <span
                              className={`text-[10px] font-bold tabular-nums ${
                                pickSurplus > 0
                                  ? "text-emerald-600 dark:text-emerald-400"
                                  : "text-rose-600 dark:text-rose-400"
                              }`}
                            >
                              {pickSurplus > 0 ? "+" : ""}
                              {pickSurplus.toLocaleString()} vs pick
                            </span>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </section>
          );
        })()}

        {!draftComplete && (
          <RoundTargets
            userPicks={userPicks}
            rookies={rookieRows}
            weakestPositions={weakestPositions as string[]}
            draftedPickNos={picks
              .filter((pk) => pk.picked_by === me.user_id)
              .map((pk) => pk.pick_no)}
          />
        )}

        {!draftComplete && picks.length > 0 && (
          <section className="flex flex-col gap-3">
            <header className="flex items-baseline justify-between">
              <h2 className="text-xl font-semibold tracking-tight">
                Picks made
              </h2>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                {picks.length} of {totalRounds * totalTeams}
              </span>
            </header>
            <ul className="flex flex-col divide-y divide-zinc-200 overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
              {picks
                .slice(-10)
                .reverse()
                .map((pk) => {
                  const p = players[pk.player_id];
                  const v = fcValues[pk.player_id];
                  if (!p) return null;
                  const isMine = pk.picked_by === me.user_id;
                  return (
                    <li
                      key={pk.pick_no}
                      className={`flex items-center gap-3 px-4 py-3 ${
                        isMine ? "bg-amber-50 dark:bg-amber-950/20" : ""
                      }`}
                    >
                      <span className="w-12 shrink-0 text-xs font-semibold tabular-nums text-zinc-500 dark:text-zinc-400">
                        {pk.round}.{pk.draft_slot.toString().padStart(2, "0")}
                      </span>
                      <PlayerAvatar
                        name={nameOf(p)}
                        position={p.position ?? null}
                        photoUrl={v?.photoUrl ?? null}
                        size="sm"
                      />
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <div className="flex items-center gap-1.5">
                          <PlayerLink
                            id={p.player_id}
                            name={nameOf(p)}
                            className="truncate text-sm font-medium"
                          />
                          {isMine && (
                            <Trophy
                              size={12}
                              className="shrink-0 text-amber-600 dark:text-amber-400"
                              aria-hidden
                            />
                          )}
                        </div>
                        <span className="text-xs text-zinc-500 dark:text-zinc-400">
                          {[p.team ?? "FA", p.position]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </div>
                      <span className="shrink-0 text-sm font-semibold tabular-nums">
                        {v?.value.toLocaleString() ?? "—"}
                      </span>
                    </li>
                  );
                })}
            </ul>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Showing last 10 picks. Refresh during the draft to see updates
              (60-second cache).
            </p>
          </section>
        )}

      </div>
    </main>
  );
}
