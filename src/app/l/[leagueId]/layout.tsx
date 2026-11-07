import Link from "next/link";
import { Freshness } from "@/components/hh/Freshness";
import { notFound } from "next/navigation";
import { LeagueSwitcher } from "@/components/LeagueSwitcher";
import { LeagueTypeProvider } from "@/components/LeagueTypeProvider";
import { NavLink } from "@/components/NavLink";
import { getMyLeagues, resolveLeague } from "@/lib/league/discover";
import { leaguePath, toolsFor } from "@/lib/league/tools";
import { valueSourceFor } from "@/lib/values";
import { LEAGUE_TYPE_LABEL, type LeagueProfile } from "@/lib/league/types";
import { Section } from "@/components/hh/ui";

function ManualLeagueNotice({ name }: { name: string }) {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex max-w-2xl flex-col gap-4">
        <h1 className="hh-title">{name}</h1>
        <Section label="Manual league">
          <p className="text-sm leading-relaxed text-hh-ink-2">
            This league is declared manually, so there is no live roster, scoring,
            or waiver data behind it. The tools here need a connected league to
            compute anything. The written playbook for this format is on the{" "}
            <Link href="/strategy" className="font-medium text-hh-accent-ink underline-offset-[3px] hover:underline">
              strategy page
            </Link>
            .
          </p>
        </Section>
      </div>
    </main>
  );
}

export default async function LeagueLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ leagueId: string }>;
}) {
  const { leagueId } = await params;

  const league = await resolveLeague(leagueId);
  if (!league) notFound();

  // The switcher is a convenience. If discovery fails (Sleeper down, username
  // unset) the league itself still resolved, so render the page with a
  // single-league switcher rather than failing the whole route.
  let leagues: LeagueProfile[] = [league];
  try {
    const discovered = await getMyLeagues(league.season);
    if (discovered.some((l) => l.id === league.id)) leagues = discovered;
    else leagues = [league, ...discovered];
  } catch {
    // keep the fallback
  }

  const tools = toolsFor(league.type);
  const valueSource = valueSourceFor(league);

  return (
    <>
      <div className="border-b border-hh-line bg-hh-bg">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-1 px-4 pt-2 sm:flex-row sm:items-center sm:gap-4 sm:px-6 sm:pt-0 lg:px-8">
          <LeagueSwitcher leagues={leagues} current={league} />
          <nav
            aria-label={`${league.name} tools`}
            className="-mx-3 flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none] sm:mx-0 [&::-webkit-scrollbar]:hidden"
          >
            {tools.map((t) => (
              <NavLink
                key={t.key}
                href={leaguePath(league.id, t.segment)}
                label={t.label}
                exact={t.segment === ""}
              />
            ))}
          </nav>
          {/* Dynasty and redraft values are genuinely different sets, so name
              which one is on screen rather than leaving it implied. */}
          <span
            title={valueSource.note}
            className="pb-2 text-xs text-hh-muted sm:ml-auto sm:shrink-0 sm:pb-0"
          >
            {LEAGUE_TYPE_LABEL[league.type]} values via{" "}
            <a
              href={valueSource.url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-hh-accent-ink underline-offset-[3px] hover:underline"
            >
              {valueSource.label}
            </a>
          </span>
        </div>
      </div>
      {league.source !== "manual" && (
        <Freshness what={["leagues", "pulse"]} className="mx-auto w-full max-w-6xl px-4 pt-3 sm:px-6 lg:px-8" />
      )}
      {league.source === "manual" ? (
        <ManualLeagueNotice name={league.name} />
      ) : (
        <LeagueTypeProvider type={league.type}>{children}</LeagueTypeProvider>
      )}
    </>
  );
}
