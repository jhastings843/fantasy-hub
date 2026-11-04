import type { Metadata } from "next";
import { PLAYBOOKS } from "@/lib/strategy/playbooks";
import { LEAGUE_TYPE_LABEL, type LeagueType } from "@/lib/league/types";
import { Chip, Disclosure, PageHead, Section, type Tone } from "@/components/hh/ui";

export const metadata: Metadata = {
  title: "Strategy playbooks",
  description:
    "How dynasty, redraft, and guillotine leagues are actually played, and why the same roster is worth different things in each.",
};

const TYPE_TONE: Record<LeagueType, Tone> = {
  dynasty: "accent",
  redraft: "gold",
  guillotine: "neg",
};

export default function StrategyPage() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-12">
        <PageHead
          title="Three formats, three games"
          sub="The same roster is worth different things depending on the format. These are the principles behind the goals your league pages compute, gathered in one place to read before a draft."
        />

        {PLAYBOOKS.map((pb) => (
          <Section
            key={pb.type}
            id={`playbook-${pb.type}`}
            label={
              <span className="inline-flex flex-wrap items-center gap-2">
                {pb.title}
                <Chip tone={TYPE_TONE[pb.type]}>{LEAGUE_TYPE_LABEL[pb.type]}</Chip>
              </span>
            }
          >
            <p className="max-w-2xl text-[15px] leading-relaxed text-hh-ink">{pb.thesis}</p>

            <div className="mt-6 grid gap-x-10 gap-y-6 lg:grid-cols-2">
              {pb.sections.map((sec) => (
                <div key={sec.heading} className="flex min-w-0 flex-col gap-2">
                  <h3 className="border-b border-hh-line pb-1.5 text-xs font-semibold uppercase tracking-wider text-hh-muted">
                    {sec.heading}
                  </h3>
                  <ul className="flex flex-col gap-2">
                    {sec.points.map((pt, i) => (
                      <li key={i} className="flex gap-2.5 text-sm leading-relaxed text-hh-ink-2">
                        <span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-hh-accent" />
                        <span>{pt}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            {pb.sources.length > 0 && (
              <Disclosure summary={`Sources (${pb.sources.length})`} className="mt-4">
                <ul className="flex flex-col">
                  {pb.sources.map((s) => (
                    <li key={s.url}>
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex min-h-11 items-center border-b border-hh-line text-sm font-medium text-hh-accent-ink underline-offset-[3px] hover:underline"
                      >
                        {s.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </Disclosure>
            )}
          </Section>
        ))}
      </div>
    </main>
  );
}
