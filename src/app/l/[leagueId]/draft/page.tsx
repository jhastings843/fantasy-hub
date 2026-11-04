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
import { Chip, Disclosure, Empty, Num, PosBadge, Section, Stat, type Tone } from "@/components/hh/ui";
import { PopLink } from "@/components/hh/PopLink";
import { teamHref } from "@/app/picks/hrefs";

export const dynamic = "force-dynamic";

const TRADE_POSITIONS = ["QB", "RB", "WR", "TE"] as const;

function ConfigError({ message }: { message: string }) {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10 text-hh-ink sm:px-6 lg:px-8">
      <div className="flex max-w-2xl flex-col gap-3">
        <Link href="/fantasy" className="inline-flex min-h-11 items-center text-sm text-hh-muted hover:text-hh-accent-ink sm:min-h-0">
          ‹ Leagues
        </Link>
        <h1 className="hh-title">Draft helper</h1>
        <p className="border-l-2 border-hh-neg py-2 pl-3 text-sm text-hh-neg">{message}</p>
      </div>
    </main>
  );
}

/** NFL team code that opens the team pop-up, then the position. "FA" stays text. */
function TeamPos({ team, position }: { team?: string | null; position?: string | null }) {
  return (
    <span className="text-xs text-hh-muted">
      {team ? <PopLink href={teamHref("nfl", team)}>{team}</PopLink> : "FA"}
      {position ? ` · ${position}` : ""}
    </span>
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
  if (picksMade === 0) return "n/a";
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

function gradeTone(grade: string): Tone {
  if (grade.startsWith("A")) return "pos";
  if (grade.startsWith("B")) return "gold";
  if (grade.startsWith("C")) return "muted";
  if (grade.startsWith("D")) return "accent";
  return "neg";
}

const TONE_CLASS: Record<Tone, string> = {
  accent: "text-hh-accent-ink",
  pos: "text-hh-pos",
  neg: "text-hh-neg",
  gold: "text-hh-gold",
  muted: "text-hh-muted",
  live: "text-hh-neg",
};

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
  const draftComplete = draft.status === "complete";

  const totalSlots = totalTeams * totalRounds;
  const zoneText = (zone: string, round: number) =>
    `${zone.charAt(0).toUpperCase() + zone.slice(1)} ${ordinal(round)}`;

  return (
    <main className="mx-auto w-full max-w-6xl min-w-0 break-words px-4 py-8 text-hh-ink sm:px-6 lg:px-8">
      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-2">
          <Link href={`/l/${leagueId}`} className="inline-flex min-h-11 items-center text-sm text-hh-muted hover:text-hh-accent-ink sm:min-h-0">
            ‹ League
          </Link>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h1 className="hh-title">{draftComplete ? "Draft recap" : "Draft helper"}</h1>
            <div className="flex flex-wrap items-center gap-2">
              <RefreshButton leagueId={leagueId} />
              <Link
                href={`/l/${leagueId}/draft/board`}
                className="inline-flex h-11 items-center justify-center rounded-[6px] border border-hh-line bg-hh-panel px-4 text-sm font-medium text-hh-ink hover:border-hh-accent sm:h-9"
              >
                {draftComplete ? "League grades →" : "League board →"}
              </Link>
              <Chip tone={draft.status === "drafting" ? "live" : "muted"}>
                {draft.status !== "drafting" && <Clock size={12} aria-hidden />}
                {draft.status === "pre_draft"
                  ? "Pre-draft"
                  : draft.status === "drafting"
                    ? "Drafting"
                    : draft.status === "complete"
                      ? "Complete"
                      : draft.status}
              </Chip>
            </div>
          </div>
          <p className="text-sm text-hh-muted">
            {league.name} · {draft.season} · {totalRounds}-round {draft.type} draft
            {startTime && ` · ${draftComplete ? "completed" : "starts"} ${startTime}`}
          </p>
          {!draftComplete && (
            <AutoRefresh
              intervalMs={draft.status === "drafting" ? 60_000 : 5 * 60_000}
              label={draft.status === "drafting" ? "Live updates" : "Refreshes"}
            />
          )}
          {/* Answer first: where you stand in the draft, in one line. */}
          {!draftComplete && (
            <p className="mt-1 max-w-2xl text-[15px] leading-snug text-hh-ink-2">
              {nextUserPick ? (
                userIsOnTheClock ? (
                  <>
                    <b className="font-semibold text-hh-pos">You are on the clock</b> at{" "}
                    <Num>
                      {nextUserPick.round}.{nextUserPick.slot.toString().padStart(2, "0")}
                    </Num>
                    .
                  </>
                ) : (
                  <>
                    <b className="font-semibold text-hh-ink">
                      <Num>{picksUntilUserUp}</Num> pick{picksUntilUserUp === 1 ? "" : "s"} until your turn
                    </b>{" "}
                    at{" "}
                    <Num>
                      {nextUserPick.round}.{nextUserPick.slot.toString().padStart(2, "0")}
                    </Num>
                    . Weakest spots: {weakestPositions.join(" and ") || "none"}.
                  </>
                )
              ) : (
                "All your picks made."
              )}
            </p>
          )}
        </div>

        {draftComplete && myDraftedPicks.length > 0 && (
          <Section label="Your draft grade">
            <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
              <span className={`hh-num text-6xl font-bold leading-none ${TONE_CLASS[gradeTone(myGrade)]}`}>{myGrade}</span>
              <div className="flex min-w-0 flex-col gap-1">
                <span className="text-xl font-semibold">
                  {surplusSum >= 0 ? "Won " : "Lost "}
                  <Num tone={surplusSum >= 0 ? "pos" : "neg"}>
                    {surplusSum >= 0 ? "+" : ""}
                    {surplusSum.toLocaleString()}
                  </Num>{" "}
                  value over expected
                </span>
                <span className="text-xs text-hh-muted">
                  <Num>{(pctSurplus * 100).toFixed(1)}%</Num> surplus across <Num>{myDraftedPicks.length}</Num> pick
                  {myDraftedPicks.length === 1 ? "" : "s"}. See how you stack up on the league grades page.
                </span>
              </div>
              <div className="flex gap-8 sm:ml-auto">
                <Stat label="Drafted value" value={draftedSum.toLocaleString()} />
                <Stat label="Expected" value={expectedSum.toLocaleString()} tone="muted" />
              </div>
            </div>
          </Section>
        )}

        {!draftComplete && (
          <Recommendations recommendations={recommendations} nextPickLabel={nextPickRef?.label ?? null} />
        )}

        {!draftComplete && (
          <div className="grid gap-x-8 gap-y-8 md:grid-cols-3">
            <Section label="Your next pick">
              {nextUserPick ? (
                <div className="flex flex-col gap-4">
                  <div className="flex items-end gap-4">
                    <Num className={`text-4xl font-bold leading-none ${userIsOnTheClock ? "text-hh-pos" : "text-hh-ink"}`}>
                      {nextUserPick.round}.{nextUserPick.slot.toString().padStart(2, "0")}
                    </Num>
                    <div className="flex min-w-0 flex-col gap-0.5">
                      {userIsOnTheClock ? (
                        <span className="text-lg font-semibold text-hh-pos">On the clock</span>
                      ) : (
                        <Num className="text-2xl font-bold leading-none">{picksUntilUserUp}</Num>
                      )}
                      <span className="text-xs text-hh-muted">
                        {userIsOnTheClock
                          ? `pick ${nextUserPick.pickNo} of ${totalSlots}`
                          : `pick${picksUntilUserUp === 1 ? "" : "s"} until your turn`}
                      </span>
                    </div>
                  </div>

                  <dl className="grid grid-cols-2 gap-3 border-t border-hh-line pt-3 text-xs">
                    <div className="flex flex-col gap-0.5">
                      <dt className="text-hh-muted">Round / zone</dt>
                      <dd className="font-semibold">{zoneText(nextUserPick.zone, nextUserPick.round)}</dd>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <dt className="text-hh-muted">Pick value</dt>
                      <dd className="font-semibold">
                        <Num>{nextUserPick.value != null ? nextUserPick.value.toLocaleString() : "n/a"}</Num>
                      </dd>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <dt className="text-hh-muted">Overall pick</dt>
                      <dd className="font-semibold">
                        <Num>#{nextUserPick.pickNo}</Num> of <Num>{totalSlots}</Num>
                      </dd>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <dt className="text-hh-muted">Source</dt>
                      <dd className="font-semibold">
                        {pickOriginalOwner.get(nextUserPick.pickNo) !== myRoster?.roster_id
                          ? `via roster ${pickOriginalOwner.get(nextUserPick.pickNo)}`
                          : "Your original"}
                      </dd>
                    </div>
                  </dl>

                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-baseline justify-between text-xs text-hh-muted">
                      <span>Draft progress</span>
                      <span>
                        <Num>{picks.length}</Num> / <Num>{totalSlots}</Num>
                      </span>
                    </div>
                    <div className="relative h-1.5 overflow-hidden rounded-full bg-hh-sunk">
                      <div className="absolute inset-y-0 left-0 bg-hh-muted" style={{ width: `${(picks.length / totalSlots) * 100}%` }} />
                      <div
                        className="absolute inset-y-0 w-0.5 bg-hh-accent"
                        style={{ left: `calc(${((nextUserPick.pickNo - 1) / totalSlots) * 100}% - 1px)` }}
                        aria-label="Your next pick"
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <Empty>All your picks made.</Empty>
              )}
            </Section>

            <Section
              label="Your picks"
              aside={
                <>
                  total <Num className="font-bold text-hh-ink">{totalPickValue.toLocaleString()}</Num>
                </>
              }
            >
              {userPicks.length === 0 ? (
                <Empty>No picks this draft.</Empty>
              ) : (
                <ul className="flex flex-col">
                  {userPicks.map((p) => {
                    const made = draftPickByPickNo.get(p.pickNo);
                    const draftedPlayer = made ? players[made.player_id] : null;
                    const draftedValue = made ? (fcValues[made.player_id]?.value ?? 0) : null;
                    const originalRoster = pickOriginalOwner.get(p.pickNo);
                    const isReceivedPick = originalRoster != null && originalRoster !== myRoster?.roster_id;
                    return (
                      <li
                        key={p.pickNo}
                        className={`flex min-h-11 items-center justify-between gap-2 border-b border-hh-line py-1.5 text-sm last:border-b-0 ${made ? "opacity-70" : ""}`}
                      >
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <div className="flex items-center gap-1.5">
                            <Num className="font-bold">
                              {p.round}.{p.slot.toString().padStart(2, "0")}
                            </Num>
                            {draftedPlayer && made ? (
                              <PlayerLink
                                id={made.player_id}
                                name={
                                  draftedPlayer.full_name ??
                                  `${draftedPlayer.first_name ?? ""} ${draftedPlayer.last_name ?? ""}`.trim()
                                }
                                className="truncate text-xs font-medium text-hh-ink-2"
                              />
                            ) : (
                              <span className="text-xs text-hh-muted">{zoneText(p.zone, p.round)}</span>
                            )}
                          </div>
                          {isReceivedPick && <span className="text-[10px] text-hh-muted">via roster {originalRoster}</span>}
                        </div>
                        <Num className="shrink-0 text-xs font-bold text-hh-ink-2">
                          {draftedValue != null
                            ? draftedValue.toLocaleString()
                            : p.value != null
                              ? p.value.toLocaleString()
                              : "n/a"}
                        </Num>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Section>

            <Section label="Target positions">
              <div className="flex flex-col gap-3">
                {weakestPositions.length > 0 ? (
                  <ul className="flex flex-col">
                    {weakestPositions.map((pos) => {
                      const filledCount = draftedByMeByPos[pos] ?? 0;
                      return (
                        <li key={pos} className="flex min-h-11 items-center justify-between gap-2 border-b border-hh-line py-1.5 last:border-b-0">
                          <span className="text-base">
                            <PosBadge pos={pos} />
                          </span>
                          {filledCount > 0 && (
                            <Chip tone="pos">
                              ✓ <Num>{filledCount}</Num> drafted
                            </Chip>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <Empty>None.</Empty>
                )}
                <span className="text-xs text-hh-muted">
                  {Object.keys(draftedByMeByPos).length > 0
                    ? `Live update: ${Object.entries(draftedByMeByPos)
                        .map(([p, n]) => `${n} ${p}${n === 1 ? "" : "s"}`)
                        .join(" + ")} drafted`
                    : "your weakest by total roster value"}
                </span>
              </div>
            </Section>
          </div>
        )}

        {!draftComplete && (
          <Section
            label="Best available rookies"
            aside={
              <>
                <Num>{available.length}</Num> remaining · <Num>{drafted.size}</Num> drafted
              </>
            }
          >
            <RookieList rookies={rookieRows} weakestPositions={weakestPositions as string[]} nextPick={nextPickRef} />
          </Section>
        )}

        {(() => {
          const myPicks = picks.filter((pk) => pk.picked_by === me.user_id).sort((a, b) => a.pick_no - b.pick_no);
          if (myPicks.length === 0) return null;

          // Compute total drafted value + surplus vs the picks I used.
          const drafted = myPicks.reduce((s, pk) => s + (fcValues[pk.player_id]?.value ?? 0), 0);
          const expected = myPicks.reduce((s, pk) => {
            const u = userPicks.find((up) => up.pickNo === pk.pick_no);
            return s + (u?.value ?? 0);
          }, 0);
          const surplus = drafted - expected;

          return (
            <Section
              label={draftComplete ? "Your picks" : "Your draft so far"}
              aside={
                <>
                  <Num>{myPicks.length}</Num> of <Num>{userPicks.length}</Num> picks
                </>
              }
            >
              <div className="flex flex-wrap gap-8 border-b border-hh-line pb-3">
                <Stat label="Drafted value" value={drafted.toLocaleString()} />
                <Stat label="Expected" value={expected.toLocaleString()} tone="muted" />
                <Stat
                  label="Surplus"
                  value={`${surplus >= 0 ? "+" : ""}${surplus.toLocaleString()}`}
                  tone={surplus >= 0 ? "pos" : "neg"}
                />
              </div>
              <ul className="flex flex-col">
                {myPicks.map((pk) => {
                  const p = players[pk.player_id];
                  const v = fcValues[pk.player_id];
                  if (!p) return null;
                  const u = userPicks.find((up) => up.pickNo === pk.pick_no);
                  const playerVal = v?.value ?? 0;
                  const expectedVal = u?.value ?? 0;
                  const pickSurplus = playerVal - expectedVal;
                  return (
                    <li key={pk.pick_no} className="flex min-h-11 items-center gap-3 border-b border-hh-line py-2 last:border-b-0">
                      <Num className="w-14 shrink-0 text-sm font-bold">
                        {pk.round}.{pk.draft_slot.toString().padStart(2, "0")}
                      </Num>
                      <PlayerAvatar name={nameOf(p)} position={p.position ?? null} photoUrl={v?.photoUrl ?? null} size="sm" />
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <PlayerLink id={p.player_id} name={nameOf(p)} className="truncate text-sm font-semibold" />
                        <TeamPos team={p.team} position={p.position} />
                      </div>
                      <div className="flex shrink-0 flex-col items-end">
                        <Num className="text-sm font-semibold">{playerVal.toLocaleString()}</Num>
                        {Math.abs(pickSurplus) >= 50 && (
                          <span className={`text-[10px] font-bold ${pickSurplus > 0 ? "text-hh-pos" : "text-hh-neg"}`}>
                            <Num>
                              {pickSurplus > 0 ? "+" : ""}
                              {pickSurplus.toLocaleString()}
                            </Num>{" "}
                            vs pick
                          </span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Section>
          );
        })()}

        {!draftComplete && userPicks.length > 0 && (
          <Disclosure summary="Round-by-round targets at each of your picks">
            <div className="pt-2">
              <RoundTargets
                userPicks={userPicks}
                rookies={rookieRows}
                weakestPositions={weakestPositions as string[]}
                draftedPickNos={picks.filter((pk) => pk.picked_by === me.user_id).map((pk) => pk.pick_no)}
              />
            </div>
          </Disclosure>
        )}

        {!draftComplete && picks.length > 0 && (
          <Disclosure
            summary={
              <>
                Picks made: <Num>{picks.length}</Num> of <Num>{totalRounds * totalTeams}</Num>
              </>
            }
          >
            <ul className="flex flex-col">
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
                      className={`flex min-h-11 items-center gap-3 border-b border-hh-line py-2.5 last:border-b-0 ${isMine ? "border-l-2 border-l-hh-accent pl-2" : ""}`}
                    >
                      <Num className="w-12 shrink-0 text-xs font-semibold text-hh-muted">
                        {pk.round}.{pk.draft_slot.toString().padStart(2, "0")}
                      </Num>
                      <PlayerAvatar name={nameOf(p)} position={p.position ?? null} photoUrl={v?.photoUrl ?? null} size="sm" />
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <div className="flex items-center gap-1.5">
                          <PlayerLink id={p.player_id} name={nameOf(p)} className="truncate text-sm font-medium text-hh-ink" />
                          {isMine && <Trophy size={12} className="shrink-0 text-hh-accent-ink" aria-label="Your pick" />}
                        </div>
                        <TeamPos team={p.team} position={p.position} />
                      </div>
                      <Num className="shrink-0 text-sm font-semibold text-hh-ink">{v?.value.toLocaleString() ?? "n/a"}</Num>
                    </li>
                  );
                })}
            </ul>
            <p className="mt-2 text-xs text-hh-muted">
              Showing last 10 picks. Refresh during the draft to see updates (60-second cache).
            </p>
          </Disclosure>
        )}
      </div>
    </main>
  );
}
