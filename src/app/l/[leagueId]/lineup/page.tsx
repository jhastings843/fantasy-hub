import { Chip, Disclosure, Num, Section, Spotlight, PosBadge } from "@/components/hh/ui";
import { PlayerLink } from "@/components/PlayerLink";
import { TeamEdge } from "@/components/hh/team";
import { buildWeeklyLineups, type LeagueLineup } from "@/lib/lineup/build";
import type { AdvicePlayer, SlotAdvice } from "@/lib/lineup/weekly-advice";
import { season } from "@/lib/scorecard/pure";
import { isSettled, readSeason, type Settled as SettledWeek } from "@/lib/scorecard/store";
import { buildWaivers } from "@/lib/waivers/build";
import type { StartableTarget } from "@/lib/waivers/rank";
import { mergePickups } from "@/lib/waivers/merge";
import Link from "next/link";

export const dynamic = "force-dynamic";

/** Past three it is the waivers page, not a lineup page. */
const PICKUPS_SHOWN = 3;

// Who to start this week, from his weekly rankings and this league's own slots.
//
// Changes first, and only changes. A page that lists ten correct slots and one
// wrong one has buried the only line that matters, so the lineup itself is
// below the fold and the top of the page is either "nothing to change" or the
// short list of slots that need touching.

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-wider text-hh-muted">
      {children}
    </p>
  );
}


// Slot colours are data encoding (Jack scans the lineup by position): a coloured mark per position, label in ink.
function SlotBadge({ slot }: { slot: string }) {
  return <PosBadge pos={slot} />;
}

/**
 * The rank chip for a player in a slot.
 *
 * Where an adjustment applies, this is the number the lineup was sorted by, and
 * his own number is shown beside it as a separate, quieter chip. Leading with
 * his number and appending ours reads as though his decided it.
 */
function rankText(p: AdvicePlayer, slot: string): string {
  if (p.unranked) return "unranked";
  const usingFlex = slot !== p.position && p.flexRank !== null;
  if (usingFlex) {
    return p.adjustedFlexRank !== null && p.adjustedFlexRank !== p.flexRank
      ? `FLEX ${p.adjustedFlexRank}`
      : `FLEX ${p.flexRank}`;
  }
  if (p.positionalRank !== null) return `${p.position} ${p.positionalRank}`;
  return p.flexRank !== null ? `FLEX ${p.flexRank}` : "unranked";
}

function matchupText(p: AdvicePlayer): string {
  if (!p.opponent) return "";
  return `${p.home ? "vs" : "@"} ${p.opponent}`;
}

function PlayerLine({ p, slot }: { p: AdvicePlayer; slot: string }) {
  // The adjusted number is a FLEX rank, so it is only shown next to a FLEX
  // rank. Beside "RB 11" it reads as an adjusted RB rank, which is a different
  // list and a number he never published.
  const usingFlex = slot !== p.position && p.flexRank !== null;
  const showAdjusted =
    usingFlex && p.adjustedFlexRank !== null && p.adjustedFlexRank !== p.flexRank;
  // The score replaces the rank once the game is over. A rank is a forecast and
  // the forecast is spent: nobody wants to know where he was ranked after the
  // fact, and putting both side by side invites a comparison that means
  // nothing.
  const played = p.locked === true;
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span
        className={
          played
            ? "font-medium text-hh-muted "
            : "font-medium text-hh-ink "
        }
      >
        <PlayerLink id={p.playerId} name={p.name} />
      </span>
      <Chip tone={p.unranked ? "neg" : showAdjusted ? "gold" : "muted"}>
        {rankText(p, slot)}
      </Chip>
      {showAdjusted && !played && <Chip>his {p.flexRank}</Chip>}
      <span className="text-sm text-hh-muted">
        {matchupText(p)}
      </span>
      {played && typeof p.actualPoints === "number" && (
        <span className="text-sm font-semibold text-hh-ink">
          {p.actualPoints.toFixed(1)} pts
        </span>
      )}
    </span>
  );
}

function ChangeCard({ slot }: { slot: SlotAdvice }) {
  return (
    <TeamEdge league="nfl" team={slot.recommended?.team} className="border-b border-hh-line py-4">
      <div className="flex items-center gap-2">
        <SlotBadge slot={slot.slot} />
        <Eyebrow>Change this</Eyebrow>
      </div>
      <p className="mt-2 font-display text-2xl font-bold text-hh-ink">
        {slot.recommended ? `Start ${slot.recommended.name}${(slot.benched ?? slot.current) ? ` over ${(slot.benched ?? slot.current)!.name}` : ""}` : "No eligible player"}
      </p>
      <div className="mt-2 text-base">
        {slot.recommended ? (
          <PlayerLine p={slot.recommended} slot={slot.slot} />
        ) : (
          <span className="text-hh-muted">No eligible player</span>
        )}
      </div>
      <p className="mt-2 text-sm leading-relaxed text-hh-ink-2">
        {slot.reason}
      </p>
    </TeamEdge>
  );
}

function LineupTable({ league }: { league: LeagueLineup }) {
  return (
    <div className="overflow-hidden border-b border-hh-line py-4">
      <div className="divide-y divide-hh-line">
        {league.advice.slots.map((s) => (
          <div
            key={`${s.slot}-${s.index}`}
            // Three row states, readable without reading: a slot that needs
            // touching is washed amber and carries a left rule, a slot whose
            // game is over is dimmed, everything else is plain.
            className={`flex flex-col gap-1.5 border-l-2 px-4 py-3 transition-colors sm:flex-row sm:items-center sm:gap-4 ${
              s.changed
                ? "border-l-amber-400 bg-amber-50/70  "
                : s.recommended?.locked
                  ? "border-l-transparent bg-hh-sunk "
                  : "border-l-transparent"
            }`}
          >
            <div className="flex w-full items-center gap-2 sm:w-28 sm:shrink-0">
              <SlotBadge slot={s.slot} />
              {s.changed && (
                <span className="text-[10px] font-semibold uppercase tracking-wider text-hh-accent-ink">
                  change
                </span>
              )}
              {s.recommended?.locked && (
                <span className="text-[10px] font-semibold uppercase tracking-wider text-hh-muted">
                  played
                </span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              {s.recommended ? (
                <PlayerLine p={s.recommended} slot={s.slot} />
              ) : (
                <span className="text-sm text-hh-muted">Nobody eligible</span>
              )}
              <p className="mt-1 text-sm leading-relaxed text-hh-muted">
                {/* A played slot gets the short version. The full sentence in
                    s.reason has to stand alone in the Thursday email, so it
                    repeats the name and the score that are already on the row
                    above. */}
                {s.recommended?.locked ? "Locked. Nothing to do here." : s.reason}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}


/**
 * How the advice has actually done, once weeks have been graded.
 *
 * Deliberately at the bottom and deliberately blunt. A tool that recommends a
 * lineup every week and never reports whether it helped is asking to be trusted
 * on manner alone. The negative case gets the same typography as the positive.
 */
function Scorecard({ weeks }: { weeks: SettledWeek[] }) {
  if (weeks.length === 0) return null;
  const totals = season(weeks.map((w) => w.verdict));
  const sign = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(1)}`;
  const tone = (n: number) =>
    n > 0
      ? "text-hh-pos "
      : n < 0
        ? "text-hh-neg "
        : "text-hh-ink-2 ";

  return (
    <div className="mt-10">
      <Eyebrow>How this has done, {totals.weeks} {totals.weeks === 1 ? "week" : "weeks"}</Eyebrow>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="border-b border-hh-line py-4">
          <p className="text-xs text-hh-muted">
            Against what you actually started
          </p>
          <p className={`mt-1 text-2xl font-semibold tabular-nums ${tone(totals.vsStarted)}`}>
            {sign(totals.vsStarted)}
          </p>
          <p className="mt-1 text-xs text-hh-muted">
            ahead in {totals.weeksAhead}, behind in {totals.weeksBehind}
          </p>
        </div>
        <div className="border-b border-hh-line py-4">
          <p className="text-xs text-hh-muted">
            What the scoring adjustment added
          </p>
          <p className={`mt-1 text-2xl font-semibold tabular-nums ${tone(totals.vsRaw)}`}>
            {sign(totals.vsRaw)}
          </p>
          <p className="mt-1 text-xs text-hh-muted">
            against his rankings left alone
          </p>
        </div>
      </div>

      <div className="mt-3 overflow-hidden border-b border-hh-line py-4">
        <div className="divide-y divide-hh-line">
          {weeks.map((w) => (
            <div
              key={w.week}
              className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-2.5 text-sm tabular-nums"
            >
              <span className="w-16 shrink-0 font-medium">Week {w.week}</span>
              <span className="text-hh-ink-2">
                you {w.verdict.started.toFixed(1)}
              </span>
              <span className="text-hh-ink-2">
                advised {w.verdict.advised.toFixed(1)}
              </span>
              <span className={tone(w.verdict.vsStarted)}>{sign(w.verdict.vsStarted)}</span>
              <span className="ml-auto text-xs text-hh-muted">
                perfect was {w.verdict.perfect.toFixed(1)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * The line under the headline, which has to tell the truth about two different
 * kinds of settled slot.
 *
 * A slot can be settled because it is right, or settled because the game has
 * been played, and those are not the same news. Reporting the second as the
 * first is how the page came to claim a lineup matched his rankings on a Friday
 * when a third of it was already in the books.
 */
function subhead(changes: number, locked: number, slots: number): string {
  const played =
    locked === 0
      ? ""
      : locked === slots
        ? "Every slot has been played."
        : `${locked} slot${locked === 1 ? " is" : "s are"} already played and locked.`;

  if (changes > 0) {
    const rest = "Everything else already matches his rankings. Only these need touching.";
    return played ? `${played} ${rest}` : rest;
  }
  if (locked === slots && slots > 0) return "Every slot has been played. This week is done.";
  const rest = locked
    ? "The rest match his rankings."
    : "Your lineup already matches his rankings for every slot this league starts.";
  return played ? `${played} ${rest}` : rest;
}

/**
 * Free agents who would start for this team this week, with the drop that
 * makes room. The same scan the Wednesday email runs, so the page and the
 * email cannot disagree. Hidden when nobody on the wire beats a starter:
 * "if needed" means an empty section is noise.
 */
function PickupCard({ target, slot }: { target: StartableTarget; slot?: string }) {
  const at = slot ?? target.slot;
  const rank =
    target.player.positionalRank != null
      ? `${target.player.position}${target.player.positionalRank} this week`
      : "ranked this week";
  const drop =
    target.dropFor === null
      ? "You have an open roster spot."
      : target.dropFor
        ? `Drop ${target.dropFor.name}.`
        : "Nobody on your bench is a safe drop, so pick one yourself or skip it.";
  return (
    <TeamEdge league="nfl" team={target.player.team} className="border-b border-hh-line py-4">
      <div className="flex items-center gap-2">
        <SlotBadge slot={at} />
        <Eyebrow>{slot ? "Change this: free agent" : "Grab this"}</Eyebrow>
      </div>
      <p className="mt-2 text-base font-semibold text-hh-ink">
        Add <PlayerLink id={target.player.playerId} name={target.player.name} />
      </p>
      <p className="mt-1 text-sm leading-relaxed text-hh-ink-2">
        {rank}
        {target.displaces ? `, starts at ${at} ahead of ${target.displaces.name}` : ` at ${at}`}.{" "}
        {drop}
      </p>
    </TeamEdge>
  );
}

export default async function LineupPage({
  params,
}: {
  params: Promise<{ leagueId: string }>;
}) {
  const { leagueId } = await params;
  const [result, pickups] = await Promise.all([
    buildWeeklyLineups({ leagueId }),
    // One failure costs this section, never the page.
    buildWaivers(leagueId)
      .then((ctx) => ctx.report.startable.slice(0, PICKUPS_SHOWN))
      .catch(() => [] as StartableTarget[]),
  ]);
  const league = result.leagues[0];
  // Keyed on the season the rankings are for, not the calendar year: in January
  // those disagree and the scorecard would silently look at the wrong season.
  const graded = result.season
    ? (await readSeason(result.season, leagueId)).filter(isSettled)
    : [];

  if (result.blocked) {
    return (
      <main className="mx-auto max-w-5xl min-w-0 break-words text-hh-ink px-4 py-8 sm:px-6 lg:px-8">
        <h1 className="hh-title">Lineup</h1>
        <div className="mt-6 max-w-2xl text-sm leading-relaxed text-hh-ink-2 border-b border-hh-line py-4">
          {result.blocked}
        </div>
      </main>
    );
  }

  if (!league) {
    return (
      <main className="mx-auto max-w-5xl min-w-0 break-words text-hh-ink px-4 py-8 sm:px-6 lg:px-8">
        <h1 className="hh-title">Lineup</h1>
        <div className="mt-6 max-w-2xl text-sm leading-relaxed text-hh-ink-2 border-b border-hh-line py-4">
          This league could not be read. It may not be one of yours this season.
        </div>
      </main>
    );
  }

  // Free agents fold into the slot they take, so a card never says "start
  // Freiermuth" above one saying "add Ferguson over Freiermuth".
  const merged = mergePickups(league.advice, pickups);
  const changes = merged.changes;
  const leftover = merged.leftover;
  const problems = league.advice.problems;
  // Slots that are spent rather than correct. Without this the page says the
  // lineup "already matches his rankings", which is not what it means when
  // three of those slots were settled on Thursday night.
  const locked = league.advice.slots.filter((s) => s.recommended?.locked);

  // The page is force-dynamic, so this IS the moment the roster and the injury
  // list were read. "Fri 11:04pm ET" rather than a date, because the only thing
  // worth knowing is whether it is older than the last news you saw.
  const checkedAt = `${new Date()
    .toLocaleString("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    })
    .replace(/\s*AM$/, "am")
    .replace(/\s*PM$/, "pm")} ET`;

  return (
    <main className="mx-auto max-w-5xl min-w-0 break-words text-hh-ink px-4 py-8 sm:px-6 lg:px-8">
      <header>
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone="accent">Week <Num>{result.week}</Num></Chip>
          <span className="text-sm font-semibold text-hh-ink">
            {league.leagueName}
          </span>
          <span className="text-xs text-hh-muted">
            {league.scoringLabel}
          </span>
        </div>
        <h1 className="hh-title mt-3">          {changes.length === 0
            ? "Lineup is set"
            : `${changes.length} slot${changes.length === 1 ? "" : "s"} to change.`}
        </h1>
        <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-hh-ink-2">
          {subhead(changes.length, locked.length, league.advice.slots.length)}
        </p>
      </header>

      {changes.length > 0 && (
        <Spotlight label="First change" className="mt-6">
          {changes[0].pickup ? <PickupCard target={changes[0].pickup} slot={changes[0].slot.slot} /> : <ChangeCard slot={changes[0].slot} />}
        </Spotlight>
      )}
      {changes.length > 1 && (
        <Section label="Other changes" className="mt-8">
          {changes.slice(1).map((c) => c.pickup ? (
            <PickupCard key={`${c.slot.slot}-${c.slot.index}`} target={c.pickup} slot={c.slot.slot} />
          ) : <ChangeCard key={`${c.slot.slot}-${c.slot.index}`} slot={c.slot} />)}
        </Section>
      )}

      {leftover.length > 0 && (
        <Section label="Free agents to grab" className="mt-8">
          <div className="flex items-baseline justify-between gap-3">
            <Link
              href={`/l/${leagueId}/waivers`}
              className="text-xs font-medium text-hh-muted underline-offset-2 hover:underline"
            >
              All waivers
            </Link>
          </div>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-hh-muted">
            Each ranks ahead of someone in your lineup on his weekly list. Once waivers clear these
            are instant adds in Sleeper, no bid.
          </p>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            {leftover.map((t) => (
              <PickupCard key={t.player.playerId} target={t} />
            ))}
          </div>
        </Section>
      )}

      {(problems.length > 0 || league.advice.superflexFellThrough) && (
        <Section label="Worth a look" className="mt-8">
          <ul className="mt-2 space-y-1">
            {problems.map((p) => (
              <li
                key={p.player.playerId}
                className="text-sm leading-relaxed text-hh-ink-2"
              >
                <span className="font-medium"><PlayerLink id={p.player.playerId} name={p.player.name} /></span> is {p.why}.
              </li>
            ))}
            {league.advice.superflexFellThrough && (
              <li className="text-sm leading-relaxed text-hh-ink-2">
                No second quarterback available, so superflex is taking a flex player.
              </li>
            )}
          </ul>
        </Section>
      )}

      {league.advice.adjustmentDecided.length > 0 && (
        <Disclosure summary="Scoring adjustments: our call, not his" className="mt-6">
          <p className="mt-2 text-sm leading-relaxed text-hh-ink-2">
            He ranks for {(result.listScoring ?? "half ppr").replace("_", " ")} and this league is{" "}
            {league.scoringLabel}. The adjusted rank is this app&rsquo;s, measured from what the
            scoring difference is worth in projected points. It is what the lineup sorts by, so
            these slots were decided by our number rather than by his order.
          </p>
          <ul className="mt-3 space-y-1.5">
            {league.advice.adjustmentDecided.map((d) => (
              <li
                key={d.started.playerId}
                className="text-sm leading-relaxed text-hh-ink-2"
              >
                <span className="font-medium"><PlayerLink id={d.started.playerId} name={d.started.name} /></span> at {d.slot}: he has him at
                FLEX {d.started.flexRank}, we move him to {d.started.adjustedFlexRank}
                {d.insteadOf ? `, ahead of ${d.insteadOf.name}` : ""}.
              </li>
            ))}
          </ul>
        </Disclosure>
      )}

      <Section label="Lineup details" className="mt-8">
        <Disclosure summary="The full lineup"><LineupTable league={league} /></Disclosure>
      <Disclosure summary="Sources and scoring notes">
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-hh-line pt-3 text-xs text-hh-muted">
          {result.listUpdatedLabel && (
            <span>
              Rankings updated{" "}
              <span className="font-semibold text-hh-ink-2">
                {result.listUpdatedLabel}
              </span>
            </span>
          )}
          <span>
            Roster and injuries checked{" "}
            <span className="font-semibold text-hh-ink-2">
              {checkedAt}
            </span>
          </span>
        </div>

        <p>
          {result.listTitle}. He ranks for{" "}
          {(result.listScoring ?? "half ppr").replace("_", " ")}. This league is{" "}
          {league.scoringLabel}.
        </p>
        {league.skewNotes.map((n) => (
          <p key={n}>{n}</p>
        ))}
        {league.error && <p className="text-hh-neg">{league.error}</p>}
      </Disclosure>
      {graded.length > 0 && <Disclosure summary="Historical scorecard"><Scorecard weeks={graded} /></Disclosure>}
      </Section>
    </main>
  );
}
