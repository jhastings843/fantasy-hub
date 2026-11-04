import { AlertTriangle, ArrowUpRight } from "lucide-react";
import { RESOURCES } from "@/lib/resources/data";
import { STRATEGY_ARTICLES } from "@/lib/survivor/strategy";
import { buildReports } from "@/lib/survivor/report";
import { Disclosure, Section } from "@/components/hh/ui";
import SurvivorTool from "./SurvivorTool";

export const dynamic = "force-dynamic";

export default async function SurvivorPage() {
  const survivorTools = RESOURCES.filter((r) => r.category === "survivor_tools");

  let reports: Awaited<ReturnType<typeof buildReports>> = [];
  let error: string | null = null;
  try {
    reports = await buildReports();
  } catch (e) {
    error = e instanceof Error ? e.message : "Could not build this week's report.";
  }

  return (
    <main className="mx-auto w-full min-w-0 max-w-7xl break-words px-4 py-8 text-hh-ink sm:px-6 lg:px-8">
      <div className="flex flex-col gap-10">
        {error && (
          <div className="flex items-start gap-3 border-l-2 border-hh-neg py-1 pl-3 text-sm" role="alert">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-hh-neg" aria-hidden />
            <div>
              <p className="font-semibold text-hh-neg">No pick this week</p>
              <p className="text-hh-ink-2">{error}</p>
            </div>
          </div>
        )}

        {reports.length > 0 ? (
          <SurvivorTool reports={reports} />
        ) : (
          <h1 className="hh-title">Survivor</h1>
        )}

        <Section label="Strategy and resources">
          <Disclosure summary={`Strategy library (${STRATEGY_ARTICLES.length})`}>
            <ul className="grid gap-x-8 lg:grid-cols-2">
              {STRATEGY_ARTICLES.map((article, i) => (
                // Two articles share the id "pool-size" in lib/survivor/strategy.ts,
                // so the index keeps the keys unique.
                <li key={`${article.id}-${i}`} className="border-b border-hh-line">
                  <Disclosure
                    summary={
                      <span className="flex flex-col gap-0.5 py-1">
                        <span className="text-sm font-semibold text-hh-ink">{article.title}</span>
                        <span className="text-xs font-normal text-hh-muted">{article.hook}</span>
                      </span>
                    }
                  >
                    <div className="flex flex-col gap-3">
                      <p className="text-sm leading-relaxed text-hh-ink-2">{article.body}</p>
                      <div className="border-l-2 border-hh-accent pl-3">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-hh-accent-ink">
                          Rule of thumb
                        </span>
                        <p className="text-sm font-medium text-hh-ink">{article.takeaway}</p>
                      </div>
                    </div>
                  </Disclosure>
                </li>
              ))}
            </ul>
          </Disclosure>

          {survivorTools.length > 0 && (
            <Disclosure summary={`External tools (${survivorTools.length})`}>
              <ul className="grid gap-x-8 md:grid-cols-2 lg:grid-cols-3">
                {survivorTools.map((t) => (
                  <li key={t.url} className="flex flex-col gap-1 border-b border-hh-line py-3">
                    <a
                      href={t.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-hh-ink hover:text-hh-accent-ink focus:outline-none focus-visible:underline sm:min-h-0"
                    >
                      {t.name}
                      <ArrowUpRight size={14} aria-hidden />
                    </a>
                    {t.note && <p className="text-xs leading-relaxed text-hh-muted">{t.note}</p>}
                  </li>
                ))}
              </ul>
            </Disclosure>
          )}
        </Section>
      </div>
    </main>
  );
}
