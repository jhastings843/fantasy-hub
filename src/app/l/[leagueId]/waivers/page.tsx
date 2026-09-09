import { buildWaivers } from "@/lib/waivers/build";
import type { SeasonTarget, StartableTarget, WaiverPlayer } from "@/lib/waivers/rank";

export const dynamic = "force-dynamic";

// Who to claim, and what it costs.
//
// Two questions, kept apart on the page because they have different answers and
// different deadlines. "Who would start for me on Sunday" is usually nobody.
// "Who is worth a roster spot" usually has an answer. A page that merged them
// would bury the second behind the emptiness of the first.

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

function seasonChip(p: WaiverPlayer) {
  if (p.seasonRank === null) return <Chip tone="rose">unranked</Chip>;
  return (
    <>
      <Chip tone="cyan">#{p.seasonRank}</Chip>
      {p.seasonPositionRank && <Chip>{p.seasonPositionRank}</Chip>}
      {p.tier && <Chip>{p.tier}</Chip>}
    </>
  );
}

function matchupText(p: WaiverPlayer): string {
  if (!p.opponent) return "";
  return `${p.home ? "vs" : "@"} ${p.opponent}`;
}

function StartRow({ t }: { t: StartableTarget }) {
  return (
    <div className="rounded-2xl border border-amber-300 bg-amber-50/60 p-4 dark:border-amber-900/60 dark:bg-amber-950/20">
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone="amber">{t.slot}</Chip>
        <span className="font-medium text-zinc-900 dark:text-zinc-100">{t.player.name}</span>
        <Chip>{t.player.position}</Chip>
        {t.player.flexRank !== null ? (
          <Chip>FLEX {t.player.flexRank}</Chip>
        ) : t.player.positionalRank !== null ? (
          <Chip>
            {t.player.position} {t.player.positionalRank}
          </Chip>
        ) : null}
        <span className="text-sm text-zinc-500 tabular-nums dark:text-zinc-400">
          {matchupText(t.player)}
        </span>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
        Would start at {t.slot} this week
        {t.displaces ? `, ahead of ${t.displaces.name}` : ""}.
      </p>
    </div>
  );
}

function SeasonRow({ t }: { t: SeasonTarget }) {
  return (
    <div className="flex flex-col gap-1.5 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-zinc-900 dark:text-zinc-100">{t.player.name}</span>
          <Chip>{t.player.position}</Chip>
          {seasonChip(t.player)}
        </div>
        <p className="mt-1 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
          {t.dropFor ? (
            <>
              Drop <span className="font-medium text-zinc-700 dark:text-zinc-300">{t.dropFor.name}</span>
              {t.dropFor.seasonRank !== null ? ` (#${t.dropFor.seasonRank})` : " (unranked)"}
              {t.placesBetter !== null ? `, ${t.placesBetter} places better` : ""}.
            </>
          ) : (
            "You have a free roster spot, so this one costs nothing."
          )}
        </p>
      </div>
    </div>
  );
}

export default async function WaiversPage({
  params,
}: {
  params: Promise<{ leagueId: string }>;
}) {
  const { leagueId } = await params;
  const w = await buildWaivers(leagueId);
  const { startable, seasonUpgrades, dropCandidates } = w.report;

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <Eyebrow>{w.week ? `Week ${w.week}` : "Waivers"}</Eyebrow>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">
        {startable.length > 0
          ? `${startable.length} on the wire would start for you.`
          : seasonUpgrades.length > 0
            ? "Nothing to start, one worth holding."
            : "Nothing worth claiming."}
      </h1>
      <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-zinc-600 dark:text-zinc-400">
        {startable.length > 0
          ? "These would crack this week's lineup, which is the rare case. Everything below is the longer game."
          : seasonUpgrades.length > 0
            ? "Nobody unowned improves this week's lineup. These are worth a roster spot for the rest of the season."
            : "Nobody unowned improves this week's lineup, and nobody he ranks beats what you already have."}
      </p>

      {(w.budgetLeft !== null || w.freeAgentCount > 0) && (
        <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm text-zinc-600 dark:text-zinc-400">
          {w.budgetLeft !== null && (
            <span className="tabular-nums">
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                ${w.budgetLeft}
              </span>{" "}
              FAAB left{w.budgetTotal !== null ? ` of $${w.budgetTotal}` : ""}
            </span>
          )}
          <span className="tabular-nums">
            <span className="font-semibold text-zinc-900 dark:text-zinc-100">
              {w.freeAgentCount}
            </span>{" "}
            of his ranked players unowned
          </span>
        </div>
      )}

      {w.blocked && (
        <div className="mt-6 max-w-2xl rounded-2xl border border-amber-200 bg-amber-50/60 p-4 text-sm leading-relaxed text-zinc-700 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-zinc-300">
          {w.blocked}
        </div>
      )}

      {startable.length > 0 && (
        <div className="mt-8">
          <Eyebrow>Would start this week</Eyebrow>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            {startable.map((t) => (
              <StartRow key={t.player.playerId} t={t} />
            ))}
          </div>
        </div>
      )}

      {seasonUpgrades.length > 0 && (
        <div className="mt-8">
          <Eyebrow>Worth a claim for the season</Eyebrow>
          <div className="mt-3 overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {seasonUpgrades.map((t) => (
                <SeasonRow key={t.player.playerId} t={t} />
              ))}
            </div>
          </div>
        </div>
      )}

      {dropCandidates.length > 0 && (
        <div className="mt-8">
          <Eyebrow>Droppable, worst first</Eyebrow>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
            Anyone this week&rsquo;s lineup depends on is left out of this list, however poor
            their season rank. A fill-in who is actually starting on Sunday is worth more than a
            better player you cannot start.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {dropCandidates.map((d) => (
              <span
                key={d.playerId}
                className="inline-flex items-center gap-2 rounded-full border border-zinc-200 px-3 py-1.5 text-sm dark:border-zinc-800"
              >
                <span className="text-zinc-800 dark:text-zinc-200">{d.name}</span>
                <span className="text-xs text-zinc-500 tabular-nums dark:text-zinc-400">
                  {d.seasonRank !== null ? `#${d.seasonRank}` : "unranked"}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="mt-10 max-w-2xl space-y-2 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
        <p>
          This week from {w.listTitle ?? "his weekly rankings"}
          {w.listUpdatedLabel ? `, last updated ${w.listUpdatedLabel}` : ""}. Season-long from{" "}
          {w.seasonListTitle}.
        </p>
        {!w.seasonListMatchesScoring && (
          <p>
            That season list is for different scoring than this league, so treat the ranks as
            indicative rather than exact.
          </p>
        )}
      </div>
    </main>
  );
}
