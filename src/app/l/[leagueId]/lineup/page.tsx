import { buildWeeklyLineups, type LeagueLineup } from "@/lib/lineup/build";
import type { AdvicePlayer, SlotAdvice } from "@/lib/lineup/weekly-advice";

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
  tone,
  children,
}: {
  tone: "amber" | "emerald" | "rose" | "zinc" | "cyan";
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

/** His rank for a player, in the list the slot was decided from. */
function rankText(p: AdvicePlayer, slot: string): string {
  if (p.unranked) return "unranked";
  const usingFlex = slot !== p.position && p.flexRank !== null;
  if (usingFlex) return `FLEX ${p.flexRank}`;
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
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="font-medium text-zinc-900 dark:text-zinc-100">{p.name}</span>
      <Chip tone={p.unranked ? "rose" : "zinc"}>{rankText(p, slot)}</Chip>
      {showAdjusted && <Chip tone="cyan">{p.adjustedFlexRank} adjusted</Chip>}
      <span className="text-sm text-zinc-500 tabular-nums dark:text-zinc-400">
        {matchupText(p)}
      </span>
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
            </div>
            <div className="min-w-0 flex-1">
              {s.recommended ? (
                <PlayerLine p={s.recommended} slot={s.slot} />
              ) : (
                <span className="text-sm text-zinc-500">Nobody eligible</span>
              )}
              <p className="mt-1 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
                {s.reason}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default async function LineupPage({
  params,
}: {
  params: Promise<{ leagueId: string }>;
}) {
  const { leagueId } = await params;
  const result = await buildWeeklyLineups({ leagueId });
  const league = result.leagues[0];

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

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <Eyebrow>Week {result.week}</Eyebrow>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">
        {changes.length === 0
          ? "Nothing to change."
          : `${changes.length} slot${changes.length === 1 ? "" : "s"} to change.`}
      </h1>
      <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-zinc-600 dark:text-zinc-400">
        {changes.length === 0
          ? "Your lineup already matches his rankings for every slot this league starts."
          : "Everything else already matches his rankings. Only these need touching."}
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
    </main>
  );
}
