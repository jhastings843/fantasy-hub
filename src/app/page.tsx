import Link from "next/link";
import { BookOpen, Compass, ShieldCheck } from "lucide-react";
import { RefreshButton } from "@/components/RefreshButton";
import { getMyLeagues } from "@/lib/league/discover";
import { leaguePath } from "@/lib/league/tools";
import {
  LEAGUE_TYPE_BLURB,
  LEAGUE_TYPE_LABEL,
  type LeagueProfile,
  type LeagueType,
} from "@/lib/league/types";

export const dynamic = "force-dynamic";

const TYPE_CHIP: Record<LeagueType, string> = {
  dynasty:
    "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
  redraft: "bg-cyan-100 text-cyan-800 dark:bg-cyan-950/50 dark:text-cyan-300",
  guillotine:
    "bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300",
};

const STATUS_LABEL: Record<LeagueProfile["status"], string> = {
  pre_draft: "Pre-draft",
  drafting: "Drafting",
  in_season: "In season",
  complete: "Complete",
};

const OTHER_TOOLS = [
  {
    href: "/strategy",
    title: "Strategy playbooks",
    blurb:
      "How dynasty, redraft, and guillotine are actually played, with sources.",
    icon: Compass,
  },
  {
    href: "/survivor",
    title: "Survivor pool",
    blurb: "Pool sizing, team scarcity, and leverage against the field.",
    icon: ShieldCheck,
  },
  {
    href: "/resources",
    title: "Resources",
    blurb: "Calculators, ranking sites, draft prep, and writers worth reading.",
    icon: BookOpen,
  },
];

export default async function Home() {
  let leagues: LeagueProfile[] = [];
  let error: string | null = null;

  try {
    leagues = await getMyLeagues();
  } catch (e) {
    error =
      e instanceof Error ? e.message : "Could not load leagues from Sleeper.";
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 lg:px-8 lg:py-16">
      <section className="mb-12 flex flex-col gap-4">
        <h1 className="max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">
          <span className="block text-zinc-900 dark:text-zinc-50">
            Every league you play.
          </span>
          <span className="block bg-gradient-to-r from-amber-500 via-orange-500 to-rose-500 bg-clip-text pb-1 text-transparent">
            One set of tools.
          </span>
        </h1>
        <p className="max-w-2xl text-base leading-relaxed text-zinc-600 dark:text-zinc-400">
          Live values, league-aware rankings, and a trade analyzer that reads
          positional fit. The tools adapt to the format: dynasty values careers,
          redraft values this season only.
        </p>
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-baseline gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Your leagues
            </h2>
            {leagues.length > 0 && (
              <span className="text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                {leagues.length} active
              </span>
            )}
          </div>
          <RefreshButton all label="Refresh all leagues" />
        </div>

        {error && (
          <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 dark:bg-red-950/50 dark:text-red-300">
            {error}
          </p>
        )}

        {!error && leagues.length === 0 && (
          <p className="rounded-2xl border border-zinc-200 bg-white px-4 py-6 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
            No leagues found on this Sleeper account for the current season.
          </p>
        )}

        <ul className="grid gap-3 md:grid-cols-2">
          {leagues.map((l) => (
            <li key={l.id}>
              <Link
                href={leaguePath(l.id, "")}
                className="group flex h-full flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-5 transition-colors hover:border-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-500 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-amber-800"
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-lg font-semibold tracking-tight">
                    {l.name}
                  </h3>
                  <span
                    className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${TYPE_CHIP[l.type]}`}
                  >
                    {LEAGUE_TYPE_LABEL[l.type]}
                  </span>
                </div>
                <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                  {LEAGUE_TYPE_BLURB[l.type]}
                </p>
                <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                  <span>{l.teams} teams</span>
                  <span aria-hidden>·</span>
                  <span>{l.superflex ? "Superflex" : "Single QB"}</span>
                  <span aria-hidden>·</span>
                  <span>{l.ppr === 1 ? "PPR" : l.ppr === 0.5 ? "Half PPR" : "Standard"}</span>
                  <span aria-hidden>·</span>
                  <span className="font-semibold text-zinc-700 dark:text-zinc-300">
                    {STATUS_LABEL[l.status]}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-12 flex flex-col gap-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          Everything else
        </h2>
        <ul className="grid gap-3 md:grid-cols-2">
          {OTHER_TOOLS.map((t) => {
            const Icon = t.icon;
            return (
              <li key={t.href}>
                <Link
                  href={t.href}
                  className="flex h-full flex-col gap-2 rounded-2xl border border-zinc-200 bg-white p-5 transition-colors hover:border-zinc-300 focus:outline-none focus:ring-2 focus:ring-amber-500 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700"
                >
                  <div className="flex items-center gap-2.5">
                    <Icon
                      size={16}
                      aria-hidden
                      className="text-amber-600 dark:text-amber-400"
                    />
                    <h3 className="text-base font-semibold tracking-tight">
                      {t.title}
                    </h3>
                  </div>
                  <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                    {t.blurb}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}
