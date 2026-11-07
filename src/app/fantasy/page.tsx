import Link from "next/link";
import { Freshness } from "@/components/hh/Freshness";
import { BookOpen, Compass, ShieldCheck, Target } from "lucide-react";
import { RefreshButton } from "@/components/RefreshButton";
import { Chip, Empty, Num, PageHead, Section, type Tone } from "@/components/hh/ui";
import { getMyLeagues } from "@/lib/league/discover";
import { myStanding, standingText } from "@/lib/league/my-standing";
import { getLeagueRosters, getUser } from "@/lib/sleeper/client";
import { leaguePath } from "@/lib/league/tools";
import {
  LEAGUE_TYPE_BLURB,
  LEAGUE_TYPE_LABEL,
  type LeagueProfile,
  type LeagueType,
} from "@/lib/league/types";

// The league list (was the home page until the 2026-11-03 redesign; / now opens Today).
export const dynamic = "force-dynamic";

export const metadata = { title: "Fantasy · Hobby Hub" };

const TYPE_CHIP: Record<LeagueType, Tone> = {
  dynasty: "accent",
  redraft: "pos",
  guillotine: "neg",
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
    href: "/picks",
    title: "Model picks",
    blurb: "Where two NFL and college models agree against the spread, plus NBA, college hoops and a March Madness bracket lab.",
    icon: Target,
  },
  {
    href: "/resources",
    title: "Resources",
    blurb: "Calculators, ranking sites, draft prep, and writers worth reading.",
    icon: BookOpen,
  },
];

export default async function FantasyHome() {
  let leagues: LeagueProfile[] = [];
  let error: string | null = null;

  try {
    leagues = await getMyLeagues();
  } catch (e) {
    error =
      e instanceof Error ? e.message : "Could not load leagues from Sleeper.";
  }

  // My record and place per league, for leagues past the draft. A league whose
  // rosters can't be read just shows no line; the list never fails over it.
  const standing = new Map<string, string>();
  const username = process.env.SLEEPER_USERNAME;
  if (username && leagues.length) {
    const me = await getUser(username).catch(() => null);
    if (me) {
      await Promise.all(
        leagues
          .filter((l) => l.status === "in_season" || l.status === "complete")
          .map(async (l) => {
            const rosters = await getLeagueRosters(l.id).catch(() => null);
            const s = rosters ? myStanding(rosters, me.user_id, l.type === "guillotine") : null;
            if (s) standing.set(l.id, standingText(s));
          }),
      );
    }
  }

  return (
    <main className="mx-auto flex w-full min-w-0 max-w-6xl flex-col gap-10 px-4 py-8 text-hh-ink sm:px-6 lg:px-8 lg:py-12">
      <PageHead
        title="Your fantasy leagues"
        sub={error ? "Your leagues could not be loaded. Refresh to try Sleeper again." : <><Num>{leagues.length}</Num> leagues. Open a league for tools that adapt to its format.</>}
        aside={<RefreshButton all label="Refresh all leagues" />}
      />
      <Freshness what={["leagues", "pulse"]} className="-mt-7" />

      <Section
        label="Your leagues"
        aside={leagues.length > 0 ? <Num>{leagues.length} active</Num> : undefined}
      >
        {error && <p className="break-words py-3 text-sm text-hh-neg">{error}</p>}

        {!error && leagues.length === 0 && (
          <Empty>No leagues found on this Sleeper account for the current season.</Empty>
        )}

        <ul>
          {leagues.map((l) => (
            <li key={l.id} className="border-b border-hh-line last:border-b-0">
              <Link
                href={leaguePath(l.id, "")}
                className="group flex min-w-0 flex-col gap-2 py-4 transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-hh-accent"
              >
                <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-2">
                  <h3 className="min-w-0 break-words font-display text-2xl font-semibold uppercase leading-tight group-hover:text-hh-accent-ink">
                    {l.name}
                  </h3>
                  <Chip tone={TYPE_CHIP[l.type]}>{LEAGUE_TYPE_LABEL[l.type]}</Chip>
                </div>
                <Num className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-hh-muted">
                  <span>{l.teams} teams</span>
                  <span aria-hidden>·</span>
                  <span>{l.superflex ? "Superflex" : "Single QB"}</span>
                  <span aria-hidden>·</span>
                  <span>{l.ppr === 1 ? "PPR" : l.ppr === 0.5 ? "Half PPR" : "Standard"}</span>
                  <span aria-hidden>·</span>
                  <span className="font-semibold text-hh-ink-2">{STATUS_LABEL[l.status]}</span>
                  {standing.has(l.id) && (
                    <>
                      <span aria-hidden>·</span>
                      <span className="font-semibold text-hh-accent-ink">You: {standing.get(l.id)}</span>
                    </>
                  )}
                </Num>
                <p className="text-sm leading-relaxed text-hh-ink-2">
                  {LEAGUE_TYPE_BLURB[l.type]}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      </Section>

      <Section label="Every league you play. One set of tools.">
        <p className="max-w-2xl text-sm leading-relaxed text-hh-ink-2">
          Live values, league-aware rankings, and a trade analyzer that reads
          positional fit. The tools adapt to the format: dynasty values careers,
          redraft values this season only.
        </p>
      </Section>

      <Section label="Everything else">
        <ul>
          {OTHER_TOOLS.map((t) => {
            const Icon = t.icon;
            return (
              <li key={t.href} className="border-b border-hh-line last:border-b-0">
                <Link
                  href={t.href}
                  className="group flex min-w-0 items-start gap-3 py-3 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-hh-accent"
                >
                  <Icon size={16} aria-hidden className="mt-1 shrink-0 text-hh-accent-ink" />
                  <div className="min-w-0">
                    <h3 className="text-base font-semibold group-hover:text-hh-accent-ink">{t.title}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-hh-ink-2">{t.blurb}</p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      </Section>
    </main>
  );
}
