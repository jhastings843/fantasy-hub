import Link from "next/link";
import { Target, TriangleAlert } from "lucide-react";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { PlayerLink } from "@/components/PlayerLink";
import { RefreshButton } from "@/components/RefreshButton";
import { PopLink } from "@/components/hh/PopLink";
import { Chip, Disclosure, Empty, Num, PosBadge, Section, Spotlight } from "@/components/hh/ui";
import { teamHref } from "@/app/picks/hrefs";
import {
  JINGLES_CALLS,
  LAB_300_VERSION,
  LAST_UPDATED,
} from "@/lib/jingles/data";
import type { LeagueProfile } from "@/lib/league/types";
import { buildLiveBoard } from "@/lib/redraft/live-board";
import { activeLab } from "@/lib/jingles/active";
import {
  displayPositionRank,
  picksForSlot,
  projectPicks,
} from "@/lib/redraft/draft-board";
import type { RAValuesBySleeperId } from "@/lib/rosteraudit/types";
import {
  getAllPlayers,
  getDraftPicks,
  getLeagueDrafts,
  getLeagueRosters,
} from "@/lib/sleeper/client";

/** 11 -> "11th". Draft slots read better as an ordinal. */
function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  const suffix = { 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th";
  return `${n}${suffix}`;
}

function PosChip({ position }: { position: string }) {
  return <PosBadge pos={position} />;
}

/** NFL team code that opens the team pop-up. "FA" stays text. */
function Team({ team }: { team: string | null | undefined }) {
  return team ? <PopLink href={teamHref("nfl", team)}>{team}</PopLink> : <>FA</>;
}


export async function RedraftDraft({
  leagueId,
  profile,
  myUserId,
  values,
}: {
  leagueId: string;
  profile: LeagueProfile;
  myUserId: string;
  values: RAValuesBySleeperId;
}) {
  const [drafts, rosters, players] = await Promise.all([
    getLeagueDrafts(leagueId),
    getLeagueRosters(leagueId),
    getAllPlayers(),
  ]);

  const draft = drafts[0] ?? null;
  const picks = draft
    ? await getDraftPicks(draft.draft_id).catch(() => [])
    : [];
  const drafted = new Set(picks.map((p) => p.player_id));

  const myRoster = rosters.find((r) => r.owner_id === myUserId) ?? null;
  const myPickIds = picks
    .filter((p) => p.picked_by === myUserId)
    .map((p) => p.player_id);

  // Everything on the roster plus anything taken in this draft, de-duped.
  const mine = new Set<string>([...(myRoster?.players ?? []), ...myPickIds]);
  // The board itself is lib/redraft/live-board.ts, shared with /api/draft.
  // Two implementations of "best available" that drift is worse than not having
  // the second one: Jack's phone would quietly disagree with this screen while
  // he is on the clock.
  // The same list /api/draft answers from. This screen used to fall back to the
  // file compiled into the build while the API read whatever had been ingested
  // that morning, which is precisely the drift the comment above warns about,
  // one screen apart: on 2026-09-05 he posted a new Lab 300 at 11:23 and this
  // page would still have been ordering by the 30 August one.
  const lab = await activeLab(profile);
  const { needs, uncoveredSlots, board, bestAvailable, pool } = buildLiveBoard({
    rosterPositions: profile.rosterPositions,
    draftedIds: drafted,
    myIds: mine,
    positionById: (id) => players[id]?.position ?? undefined,
    values,
    limit: 5,
    labList: lab.list,
    rankings: { byId: lab.byId, tierFor: lab.tierFor },
  });

  // His calls are ADP-relative, which is exactly what a draft board wants.
  // Split into who is still on the table and who to let someone else take.
  const availableIds = new Set(pool.map((p) => p.id));
  const jinglesTargets = JINGLES_CALLS.filter(
    (c) => c.verdict !== "fade" && availableIds.has(c.sleeperId),
  );
  const jinglesFades = JINGLES_CALLS.filter(
    (c) => c.verdict === "fade" && availableIds.has(c.sleeperId),
  );

  const draftStart = draft?.start_time ? new Date(draft.start_time) : null;

  // His Lab 300 is built for half PPR specifically. In a league scored any
  // other way the order is still the best ranking available, but it is priced
  // for receptions this league does not pay the same way, and the reader should
  // know which direction the error runs. FantasyCalc is pulled for this
  // league's exact format, so it is the tiebreaker where the two disagree.
  const scoringLabel =
    profile.ppr === 1 ? "full PPR" : profile.ppr === 0 ? "standard" : "half PPR";
  const pprSkew =
    profile.ppr === 1
      ? "Every catch is worth half a point more here than his ranking assumes, so pass-catching backs and high-volume slot receivers should go earlier than he has them, and touchdown-dependent runners later."
      : profile.ppr === 0
        ? "Receptions score nothing here, so the pass-catching backs and slot receivers his ranking pays up for should slide, and volume runners and touchdown scorers should climb."
        : null;

  // Where you sit in the order, and who is likely to be there when you are up.
  // Sleeper publishes draft_order as soon as the commissioner sets it, which is
  // usually well before the draft, so this fills in the moment it exists.
  const mySlot = draft?.draft_order?.[myUserId] ?? null;
  const totalTeams = draft?.settings?.teams ?? rosters.length ?? 12;
  const totalRounds = draft?.settings?.rounds ?? 0;
  const myPicks = mySlot
    ? picksForSlot(
        mySlot,
        totalTeams,
        totalRounds,
        draft?.type,
        draft?.settings?.reversal_round ?? 0,
      )
    : [];
  // Picks already made, so a live draft projects from where the room is now.
  const nextPickNo = picks.length + 1;
  const remainingPicks = myPicks.filter((p) => p.pickNo >= nextPickNo);
  // Project every remaining pick, since each one's cliff is defined by the pick
  // after it, then show the first six.
  const projections = projectPicks(pool, remainingPicks, nextPickNo).slice(0, 6);
  const laterPicks = remainingPicks.slice(6);
  const turnGap =
    remainingPicks.length >= 2
      ? remainingPicks[1].pickNo - remainingPicks[0].pickNo
      : null;


  const topRec = board[0] ?? null;
  const restRecs = board.slice(1);

  return (
    <main className="mx-auto w-full max-w-6xl min-w-0 break-words px-4 py-8 text-hh-ink sm:px-6 lg:px-8">
      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-2">
          <Link
            href={`/l/${leagueId}`}
            className="inline-flex min-h-11 items-center text-sm text-hh-muted hover:text-hh-accent-ink sm:min-h-0"
          >
            ‹ League
          </Link>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="hh-title">Draft board</h1>
              {mySlot && (
                <Chip tone="accent">
                  Pick <Num>{mySlot}</Num> of <Num>{totalTeams}</Num>
                </Chip>
              )}
            </div>
            <RefreshButton leagueId={leagueId} />
          </div>
          <p className="max-w-2xl text-sm leading-relaxed text-hh-ink-2">
            {profile.name} · {draft?.settings?.rounds ?? "?"}-round{" "}
            {draft?.type ?? "snake"}
            {draftStart
              ? ` · starts ${draftStart.toLocaleString("en-US", {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}`
              : " · not scheduled"}
          </p>
          {pprSkew && (
            <p className="flex max-w-2xl items-start gap-2 border-l-2 border-hh-gold py-1 pl-3 text-xs leading-relaxed text-hh-ink-2">
              <TriangleAlert size={14} className="mt-0.5 shrink-0 text-hh-gold" aria-hidden />
              <span>
                <span className="font-semibold text-hh-ink">
                  This league is {scoringLabel}, his ranking is half PPR.
                </span>{" "}
                {pprSkew} The value beside each name is priced for this
                league&rsquo;s exact format ({profile.teams} teams,{" "}
                {profile.superflex ? "superflex" : "one QB"}, {scoringLabel}),
                so trust it over the order where the two disagree on a
                receiver.
              </span>
            </p>
          )}
        </div>

        {/* The one spotlight: the top recommendation right now. */}
        {topRec ? (
          <Spotlight
            label="Take next"
            aside={mySlot ? <>you pick <Num>{ordinal(mySlot)}</Num></> : undefined}
          >
            <RecLine rec={topRec} big />
            <ul className="mt-3 flex flex-col gap-1.5">
              {topRec.reasoning.map((r, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-hh-ink-2">
                  <span aria-hidden className="mt-1.5 size-1 shrink-0 rounded-full bg-hh-accent" />
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          </Spotlight>
        ) : (
          <Section label="Top recommendations">
            <Empty>No players available yet.</Empty>
          </Section>
        )}

        {/* Where you pick, and who should be there */}
        {myPicks.length > 0 && (
          <Section label="Your picks">
            <p className="max-w-2xl text-xs leading-relaxed text-hh-muted">
              You draft {ordinal(mySlot ?? 0)} of {totalTeams}
              {turnGap !== null && remainingPicks.length >= 2 ? (
                <>
                  , so you are up at <Num>#{remainingPicks[0].pickNo}</Num> and{" "}
                  <Num>#{remainingPicks[1].pickNo}</Num>, <Num>{turnGap}</Num> picks apart
                </>
              ) : null}
              . Each pick also names who is projected to go before you are back
              on the clock, which is the actual decision at a turn slot.
              Projections assume the room drafts straight down the Lab 300,
              which no room actually does. Treat them as the middle of a range,
              not a promise.
            </p>
            {projections.length === 0 ? (
              <Empty>Your picks are all in. Nothing left to project.</Empty>
            ) : (
              <ul className="mt-2 grid gap-x-8 sm:grid-cols-2 lg:grid-cols-3">
                {projections.map((proj, i) => {
                  const top = proj.projected[0] ?? null;
                  const alts = proj.projected.slice(1);
                  return (
                    <li
                      key={proj.pick.pickNo}
                      className={`flex flex-col gap-2 border-b border-hh-line py-3 ${i === 0 ? "border-l-2 border-l-hh-accent pl-3" : ""}`}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="flex flex-wrap items-baseline gap-1.5">
                          <Num className={`text-lg font-bold ${i === 0 ? "text-hh-accent-ink" : ""}`}>{proj.pick.label}</Num>
                          {proj.tierEndsHere && proj.tier && (
                            <span title={`${proj.tierRemaining} left in his ${proj.tier} tier, and ${proj.picksUntilNext} picks before you are back up`}>
                              <Chip tone="neg">
                                <Num>{proj.tierRemaining}</Num> left in tier
                              </Chip>
                            </span>
                          )}
                        </span>
                        <span className="text-[11px] text-hh-muted">
                          <Num>#{proj.pick.pickNo}</Num> overall
                        </span>
                      </div>
                      {top ? (
                        <>
                          <div className="flex items-center gap-2">
                            <PlayerAvatar name={top.name} position={top.position} size="sm" />
                            <div className="flex min-w-0 flex-col">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <PlayerLink id={top.id} name={top.name} className="truncate text-sm font-bold" />
                                <PosChip position={top.position} />
                              </div>
                              <span className="text-[11px] text-hh-muted">
                                <Team team={top.team} />
                                {top.labTier ? ` · ${top.labTier}` : ""}
                              </span>
                            </div>
                          </div>
                          {alts.length > 0 && (
                            <span className="text-[11px] leading-relaxed text-hh-muted">
                              or{" "}
                              {alts.map((a, j) => (
                                <span key={a.id}>
                                  {j > 0 ? ", " : ""}
                                  <PlayerLink id={a.id} name={a.name} />
                                </span>
                              ))}
                            </span>
                          )}
                          {proj.goneBefore.length > 0 && proj.nextLabel && (
                            <span className="text-[11px] leading-relaxed text-hh-neg">
                              <span className="font-semibold">Gone by {proj.nextLabel}:</span>{" "}
                              {proj.goneBefore
                                .slice(0, 3)
                                .map((p) => p.name)
                                .join(", ")}
                              {proj.goneBefore.length > 3 ? `, and ${proj.goneBefore.length - 3} more` : ""}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-sm text-hh-muted">Past the ranked board. Stream it.</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {laterPicks.length > 0 && (
              <p className="mt-2 text-[11px] leading-relaxed text-hh-muted">
                Then {laterPicks.map((p) => `${p.label} (#${p.pickNo})`).join(", ")}.
              </p>
            )}
          </Section>
        )}

        {/* Starting slots still open */}
        <Section label="Starting slots">
          <ul className="grid grid-cols-3 gap-x-6 sm:grid-cols-4 lg:grid-cols-6">
            {needs.map((n) => {
              const done = n.filled >= n.required;
              const unsupported = uncoveredSlots.some((u) => u.slot === n.slot);
              const open = !(done || unsupported);
              return (
                <li key={n.slot} className="flex flex-col gap-0.5 border-b border-hh-line py-2">
                  <span className={`text-[11px] font-semibold uppercase tracking-wider ${open ? "text-hh-accent-ink" : "text-hh-muted"}`}>
                    {n.slot}
                  </span>
                  <Num className={`text-lg font-bold ${open ? "text-hh-accent-ink" : "text-hh-ink"}`}>
                    {n.filled}/{n.required}
                  </Num>
                  {unsupported && <span className="text-[10px] leading-tight text-hh-muted">not valued</span>}
                </li>
              );
            })}
          </ul>
          {uncoveredSlots.length > 0 && (
            <p className="mt-2 text-xs leading-relaxed text-hh-muted">
              {uncoveredSlots.map((u) => u.slot).join(", ")}{" "}
              {uncoveredSlots.length === 1 ? "is" : "are"} not in FantasyCalc&apos;s
              redraft set, so this board cannot rank{" "}
              {uncoveredSlots.length === 1 ? "it" : "them"}. Draft{" "}
              {uncoveredSlots.length === 1 ? "that slot" : "those slots"} late
              off a streaming source.
            </p>
          )}
        </Section>

        {/* Recommendations after the top one */}
        {restRecs.length > 0 && (
          <Section
            label="Also in range"
            aside="His Lab 300 rank first, weighted toward filling an open starting slot, with his individual calls factored in."
          >
            <ol className="flex flex-col">
              {restRecs.map((rec) => (
                <li key={rec.player.id} className="border-b border-hh-line py-2.5 last:border-b-0">
                  <RecLine rec={rec} />
                  <Disclosure summary="Why">
                    <ul className="flex flex-col gap-1.5">
                      {rec.reasoning.map((r, i) => (
                        <li key={i} className="flex items-start gap-2 text-xs text-hh-ink-2">
                          <span aria-hidden className="mt-1.5 size-1 shrink-0 rounded-full bg-hh-accent" />
                          <span>{r}</span>
                        </li>
                      ))}
                    </ul>
                  </Disclosure>
                </li>
              ))}
            </ol>
          </Section>
        )}

        {/* Jingles ADP calls */}
        {(jinglesTargets.length > 0 || jinglesFades.length > 0) && (
          <Section label="Jingles Labs vs ADP" aside={<>pulled {LAST_UPDATED}</>}>
            <p className="max-w-2xl text-xs leading-relaxed text-hh-muted">
              His individual calls on players still available, showing the ADP he
              quoted against his own rank. Separate from the Lab 300: these are
              players he has written about specifically.
            </p>
            <div className="mt-3 grid gap-x-8 gap-y-6 lg:grid-cols-2">
              <CallList title="Taking at this price" icon="target" calls={jinglesTargets} />
              <CallList title="Letting someone else have" icon="fade" calls={jinglesFades} />
            </div>
          </Section>
        )}

        {/* Best available */}
        <Section label="Best available">
          <ul className="flex flex-col">
            {bestAvailable.map((p, i) => (
              <li key={p.id} className="flex min-h-11 items-center gap-2.5 border-b border-hh-line py-2 last:border-b-0">
                <Num className="w-6 shrink-0 text-right text-xs text-hh-muted">{i + 1}</Num>
                <PlayerAvatar name={p.name} position={p.position} size="sm" />
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                  <PlayerLink id={p.id} name={p.name} className="truncate text-sm font-medium" />
                  <PosChip position={p.position} />
                  <span className="text-xs text-hh-muted">
                    <Team team={p.team} /> · {p.position}
                    {displayPositionRank(p)}
                  </span>
                  {p.jingles && <Chip tone={p.jingles.verdict === "fade" ? "neg" : "pos"}>{p.jingles.verdict === "fade" ? "Fade" : "Target"}</Chip>}
                </div>
                <span className="shrink-0 text-right text-xs">
                  {p.labRank !== null ? (
                    <Num className="font-semibold">#{p.labRank}</Num>
                  ) : (
                    <Num className="text-hh-muted">{p.value.toLocaleString()}</Num>
                  )}
                  {p.labTier && <span className="block text-[10px] text-hh-muted">{p.labTier}</span>}
                </span>
              </li>
            ))}
          </ul>
        </Section>

        <Disclosure summary="Sources">
          <p className="max-w-2xl text-xs leading-relaxed text-hh-muted">
            Ordered by{" "}
            <a href={lab.url} target="_blank" rel="noopener noreferrer" className="font-medium text-hh-accent-ink hover:underline">
              {lab.source === "curated" ? `the Lab 300 v${LAB_300_VERSION}` : lab.title}
            </a>{" "}
            ({lab.postedAt.slice(0, 10)}), his tiered half-PPR ranking, with FantasyCalc
            value alongside and for anyone he has not ranked. Age and long-term
            upside are ignored on purpose: the roster resets in January.
          </p>
        </Disclosure>
      </div>
    </main>
  );
}

type BoardRec = Awaited<ReturnType<typeof buildLiveBoard>>["board"][number];

function RecLine({ rec, big = false }: { rec: BoardRec; big?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <Num className={`w-8 shrink-0 font-bold ${big ? "text-2xl text-hh-accent-ink" : "text-lg text-hh-muted"}`}>{rec.rank}</Num>
      <PlayerAvatar name={rec.player.name} position={rec.player.position} size={big ? "md" : "sm"} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <PlayerLink id={rec.player.id} name={rec.player.name} className={`truncate font-semibold text-hh-ink ${big ? "text-lg" : "text-base"}`} />
          <PosChip position={rec.player.position} />
          {rec.fillsNeed && <Chip tone="accent">Need</Chip>}
        </div>
        <span className="text-xs text-hh-muted">
          <Team team={rec.player.team} /> · <span className="font-semibold text-hh-ink-2">{rec.headline}</span>
        </span>
      </div>
      <span className="flex shrink-0 flex-col items-end">
        {rec.player.labRank !== null && <Num className="text-lg font-bold">#{rec.player.labRank}</Num>}
        {rec.player.labTier && <span className="text-[10px] text-hh-muted">{rec.player.labTier}</span>}
        {rec.player.labRank === null && <Num className="text-lg font-bold">{rec.player.value.toLocaleString()}</Num>}
      </span>
    </div>
  );
}

function CallList({
  title,
  icon,
  calls,
}: {
  title: string;
  icon: "target" | "fade";
  calls: typeof JINGLES_CALLS;
}) {
  const Icon = icon === "target" ? Target : TriangleAlert;
  const tint = icon === "target" ? "text-hh-pos" : "text-hh-neg";

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex items-center gap-2 border-b border-hh-rule pb-1">
        <Icon size={15} className={tint} aria-hidden />
        <h3 className="text-xs font-semibold uppercase tracking-wider text-hh-muted">{title}</h3>
        <Num className="ml-auto text-xs text-hh-muted">{calls.length}</Num>
      </div>
      {calls.length === 0 ? (
        <Empty>None still available.</Empty>
      ) : (
        <ul className="flex flex-col">
          {calls.map((c) => (
            <li key={c.sleeperId} className="flex flex-col gap-0.5 border-b border-hh-line py-2 last:border-b-0">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <a
                  href={c.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-semibold text-hh-ink hover:text-hh-accent-ink hover:underline"
                >
                  {c.player}
                </a>
                <span className="text-xs text-hh-muted">
                  {c.position} · <Team team={c.team} />
                </span>
              </div>
              {c.adp && (
                <span className="text-xs text-hh-ink-2">
                  ADP <Num>{c.adp}</Num> → his rank <Num>{c.jinglesRank}</Num>
                </span>
              )}
              <span className="text-xs leading-relaxed text-hh-muted">{c.note}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
