import { AlertTriangle, BookOpen, ChevronDown, ArrowUpRight } from "lucide-react";
import { RESOURCES } from "@/lib/resources/data";
import { STRATEGY_ARTICLES } from "@/lib/survivor/strategy";
import { buildReports } from "@/lib/survivor/report";
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
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-10">
        {error && (
          <div className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm dark:border-rose-900/60 dark:bg-rose-950/30">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-rose-600 dark:text-rose-400" aria-hidden />
            <div>
              <p className="font-semibold text-rose-900 dark:text-rose-200">
                No pick this week
              </p>
              <p className="text-rose-800 dark:text-rose-300">{error}</p>
            </div>
          </div>
        )}

        {reports.length > 0 && <SurvivorTool reports={reports} />}

        <section className="flex flex-col gap-3">
          <header className="flex items-center gap-2">
            <BookOpen size={16} aria-hidden className="text-zinc-400 dark:text-zinc-500" />
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Strategy library
            </h2>
          </header>
          <ul className="grid gap-2 lg:grid-cols-2">
            {STRATEGY_ARTICLES.map((article) => (
              <li key={article.id}>
                <details className="group h-full rounded-2xl border border-zinc-200 bg-white p-4 transition-colors hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700">
                  <summary className="flex cursor-pointer list-none items-start justify-between gap-3">
                    <div className="flex flex-1 flex-col gap-0.5">
                      <span className="text-sm font-semibold">{article.title}</span>
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">
                        {article.hook}
                      </span>
                    </div>
                    <ChevronDown
                      size={16}
                      aria-hidden
                      className="mt-0.5 shrink-0 text-zinc-400 transition-transform group-open:rotate-180 dark:text-zinc-500"
                    />
                  </summary>
                  <div className="flex flex-col gap-3 pt-3">
                    <p className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
                      {article.body}
                    </p>
                    <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 dark:border-amber-900/60 dark:bg-amber-950/20">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                        Rule of thumb
                      </span>
                      <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                        {article.takeaway}
                      </p>
                    </div>
                  </div>
                </details>
              </li>
            ))}
          </ul>
        </section>

        {survivorTools.length > 0 && (
          <section className="flex flex-col gap-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              External tools
            </h2>
            <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {survivorTools.map((t) => (
                <li
                  key={t.url}
                  className="flex flex-col gap-2 rounded-2xl border border-zinc-200 bg-white p-4 transition-colors hover:border-amber-300 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-amber-800"
                >
                  <a
                    href={t.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-sm font-semibold text-zinc-900 hover:text-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-500 dark:text-zinc-50 dark:hover:text-amber-400"
                  >
                    {t.name}
                    <ArrowUpRight size={14} aria-hidden />
                  </a>
                  {t.note && (
                    <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                      {t.note}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}
