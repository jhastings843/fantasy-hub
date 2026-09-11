import { buildWeeklyLineups, type LeagueLineup } from "@/lib/lineup/build";
import type { AdvicePlayer, SlotAdvice } from "@/lib/lineup/weekly-advice";
import { season } from "@/lib/scorecard/pure";
import { isSettled, readSeason, type Settled as SettledWeek } from "@/lib/scorecard/store";

export const dynamic = "force-dynamic";

// Who to start this week, from his weekly rankings and this league's own slots.
//
// Changes first, and only changes. A page that lists ten correct slots and one
// wrong one has buried the only line that matters, so the lineup itself is
// below the fold and the top of the page is either "nothing to change" or the
// short list of slots that need touching.

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
      {children}
    </p>
  );
}

function Chip({
  tone = "zinc",
  children,
}: {
  tone?: "amber" | "emerald" | "rose" | "zinc" | "cyan";
  children: React.ReactNode;
}) {
  const tones = {
    amber: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
    emerald: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300",
    rose: "bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300",
    cyan: "bg-cyan-100 text-cyan-800 dark:bg-cyan-950/50 dark:text-cyan-300",
    zinc: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  } as const;
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${tones[tone]}`}
    >
      {children}
    </span>
  );
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
            ? "font-medium text-zinc-500 dark:text-zinc-400"
            : "font-medium text-zinc-900 dark:text-zinc-100"
        }
      >
        {p.name}
      </span>
      <Chip tone={p.unranked ? "rose" : showAdjusted ? "cyan" : "zinc"}>
        {rankText(p, slot)}
      </Chip>
      {showAdjusted && !played && <Chip>his {p.flexRank}</Chip>}
      <span className="text-sm text-zinc-500 tabular-nums dark:text-zinc-400">
        {matchupText(p)}
      </span>
      {played && typeof p.actualPoints === "number" && (
        <span className="text-sm font-semibold text-zinc-900 tabular-nums dark:text-zinc-100">
          {p.actualPoints.toFixed(1)} pts
        </span>
      )}
    </span>
  );
}

function ChangeCard({ slot }: { slot: SlotAdvice }) {
  return (
    <div className="rounded-2xl border border-amber-300 bg-amber-50/60 p-4 transition-colors dark:border-amber-900/60 dark:bg-amber-950/20">
      <div className="flex items-center gap-2">
        <Chip tone="amber">{slot.slot}</Chip>
        <Eyebrow>Change this</Eyebrow>
      </div>
      <div className="mt-2 text-base">
        {slot.recommended ? (
          <PlayerLine p={slot.recommended} slot={slot.slot} />
        ) : (
          <span className="text-zinc-500">No eligible player</span>
        )}
      </div>
      <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
        {slot.reason}
      </p>
    </div>
  );
}

function LineupTable({ league }: { league: LeagueLineup }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
        {league.advice.slots.map((s) => (
          <div
            key={`${s.slot}-${s.index}`}
            className="flex flex-col gap-1.5 px-4 py-3 sm:flex-row sm:items-center sm:gap-4"
          >
            <div className="flex w-full items-center gap-2 sm:w-28 sm:shrink-0">
              <Chip tone={s.changed ? "amber" : "zinc"}>{s.slot}</Chip>
              {s.changed && (
                <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                  change
                </span>
              )}
              {s.recommended?.locked && (
                <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                  played
                </span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              {s.recommended ? (
                <PlayerLine p={s.recommended} slot={s.slot} />
              ) : (
                <span className="text-sm text-zinc-500">Nobody eligible</span>
              )}
              <p className="mt-1 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
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
      ? "text-emerald-600 dark:text-emerald-400"
      : n < 0
        ? "text-rose-600 dark:text-rose-400"
        : "text-zinc-600 dark:text-zinc-400";

  return (
    <div className="mt-10">
      <Eyebrow>How this has done, {totals.weeks} {totals.weeks === 1 ? "week" : "weeks"}</Eyebrow>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Against what you actually started
          </p>
          <p className={`mt-1 text-2xl font-semibold tabular-nums ${tone(totals.vsStarted)}`}>
            {sign(totals.vsStarted)}
          </p>
          <p className="mt-1 text-xs text-zinc-500 tabular-nums dark:text-zinc-400">
            ahead in {totals.weeksAhead}, behind in {totals.weeksBehind}
          </p>
        </div>
        <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            What the scoring adjustment added
          </p>
          <p className={`mt-1 text-2xl font-semibold tabular-nums ${tone(totals.vsRaw)}`}>
            {sign(totals.vsRaw)}
          </p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            against his rankings left alone
          </p>
        </div>
      </div>

      <div className="mt-3 overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {weeks.map((w) => (
            <div
              key={w.week}
              className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-2.5 text-sm tabular-nums"
            >
              <span className="w-16 shrink-0 font-medium">Week {w.week}</span>
              <span className="text-zinc-600 dark:text-zinc-400">
                you {w.verdict.started.toFixed(1)}
              </span>
              <span className="text-zinc-600 dark:text-zinc-400">
                advised {w.verdict.advised.toFixed(1)}
              </span>
              <span className={tone(w.verdict.vsStarted)}>{sign(w.verdict.vsStarted)}</span>
              <span className="ml-auto text-xs text-zinc-400 dark:text-zinc-500">
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

export default async function LineupPage({
  params,
}: {
  params: Promise<{ leagueId: string }>;
}) {
  const { leagueId } = await params;
  const result = await buildWeeklyLineups({ leagueId });
  const league = result.leagues[0];
  // Keyed on the season the rankings are for, not the calendar year: in January
  // those disagree and the scorecard would silently look at the wrong season.
  const graded = result.season
    ? (await readSeason(result.season, leagueId)).filter(isSettled)
    : [];

  if (result.blocked) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Lineup</h1>
        <div className="mt-6 max-w-2xl rounded-2xl border border-zinc-200 bg-white p-5 text-sm leading-relaxed text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          {result.blocked}
        </div>
      </main>
    );
  }

  if (!league) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Lineup</h1>
        <div className="mt-6 max-w-2xl rounded-2xl border border-zinc-200 bg-white p-5 text-sm leading-relaxed text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          This league could not be read. It may not be one of yours this season.
        </div>
      </main>
    );
  }

  const changes = league.advice.changes;
  const problems = league.advice.problems;
  // Slots that are spent rather than correct. Without this the page says the
  // lineup "already matches his rankings", which is not what it means when
  // three of those slots were settled on Thursday night.
  const locked = league.advice.slots.filter((s) => s.recommended?.locked);

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <Eyebrow>Week {result.week}</Eyebrow>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">
        {changes.length === 0
          ? "Nothing to change."
          : `${changes.length} slot${changes.length === 1 ? "" : "s"} to change.`}
      </h1>
      <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-zinc-600 dark:text-zinc-400">
        {subhead(changes.length, locked.length, league.advice.slots.length)}
      </p>

      {changes.length > 0 && (
        <div className="mt-6 grid gap-3 lg:grid-cols-2">
          {changes.map((s) => (
            <ChangeCard key={`${s.slot}-${s.index}`} slot={s} />
          ))}
        </div>
      )}

      {(problems.length > 0 || league.advice.superflexFellThrough) && (
        <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50/60 p-4 dark:border-rose-900/60 dark:bg-rose-950/20">
          <Eyebrow>Worth a look</Eyebrow>
          <ul className="mt-2 space-y-1">
            {problems.map((p) => (
              <li
                key={p.player.playerId}
                className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300"
              >
                <span className="font-medium">{p.player.name}</span> is {p.why}.
              </li>
            ))}
            {league.advice.superflexFellThrough && (
              <li className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
                No second quarterback available, so superflex is taking a flex player.
              </li>
            )}
          </ul>
        </div>
      )}

      {league.advice.adjustmentDecided.length > 0 && (
        <div className="mt-6 rounded-2xl border border-cyan-200 bg-cyan-50/60 p-4 dark:border-cyan-900/60 dark:bg-cyan-950/20">
          <Eyebrow>Our call, not his</Eyebrow>
          <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            He ranks for {(result.listScoring ?? "half ppr").replace("_", " ")} and this league is{" "}
            {league.scoringLabel}. The adjusted rank is this app&rsquo;s, measured from what the
            scoring difference is worth in projected points. It is what the lineup sorts by, so
            these slots were decided by our number rather than by his order.
          </p>
          <ul className="mt-3 space-y-1.5">
            {league.advice.adjustmentDecided.map((d) => (
              <li
                key={d.started.playerId}
                className="text-sm leading-relaxed text-zinc-700 tabular-nums dark:text-zinc-300"
              >
                <span className="font-medium">{d.started.name}</span> at {d.slot}: he has him at
                FLEX {d.started.flexRank}, we move him to {d.started.adjustedFlexRank}
                {d.insteadOf ? `, ahead of ${d.insteadOf.name}` : ""}.
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-10">
        <Eyebrow>The full lineup</Eyebrow>
        <div className="mt-3">
          <LineupTable league={league} />
        </div>
      </div>

      <div className="mt-8 max-w-2xl space-y-2 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
        <p>
          {result.listTitle}
          {result.listUpdatedLabel ? `, last updated ${result.listUpdatedLabel}` : ""}. He ranks
          for {(result.listScoring ?? "half ppr").replace("_", " ")}. This league is{" "}
          {league.scoringLabel}.
        </p>
        {league.skewNotes.map((n) => (
          <p key={n}>{n}</p>
        ))}
        {league.error && <p className="text-rose-600 dark:text-rose-400">{league.error}</p>}
      </div>

      <Scorecard weeks={graded} />
    </main>
  );
}
