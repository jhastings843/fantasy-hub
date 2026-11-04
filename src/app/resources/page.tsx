import Link from "next/link";
import type { LeagueType } from "@/lib/league/types";
import { LEAGUE_TYPE_LABEL } from "@/lib/league/types";
import {
  CATEGORIES,
  REDDITORS,
  RESOURCES,
  type Resource,
  type ResourceStatus,
} from "@/lib/resources/data";
import { Chip, Disclosure, Num, PageHead, Section, type Tone } from "@/components/hh/ui";

const STATUS_LABEL: Record<ResourceStatus, string> = {
  integrated: "Integrated",
  free: "Free",
  free_tier: "Free tier",
  paid: "Paid",
  scrape_required: "Scrape required",
  outdated: "Verify",
};

const STATUS_TONE: Record<ResourceStatus, Tone> = {
  integrated: "pos",
  free: "muted",
  free_tier: "gold",
  paid: "accent",
  scrape_required: "gold",
  outdated: "neg",
};

/** Past this many rows a category folds the rest behind a Disclosure. */
const SHOWN = 6;

function StatusBadge({ status }: { status: ResourceStatus }) {
  return (
    <Chip tone={STATUS_TONE[status]}>
      <span className="uppercase tracking-wide">{STATUS_LABEL[status]}</span>
    </Chip>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function ResourceRow({ r, strong = false }: { r: Resource; strong?: boolean }) {
  return (
    <li className="flex min-w-0 flex-col gap-1 border-b border-hh-line py-3">
      <div className="flex items-start justify-between gap-3">
        <a
          href={r.url}
          target="_blank"
          rel="noopener noreferrer"
          className={`min-w-0 flex-1 font-semibold underline-offset-[3px] hover:underline ${
            strong ? "text-base text-hh-ink hover:text-hh-accent-ink" : "text-sm text-hh-accent-ink"
          }`}
        >
          {r.name}
          <span className="ml-1.5 text-xs text-hh-muted">↗</span>
        </a>
        {r.status && r.status.length > 0 && (
          <div className="flex shrink-0 flex-wrap justify-end gap-1">
            {r.status.map((s) => (
              <StatusBadge key={s} status={s} />
            ))}
          </div>
        )}
      </div>
      <span className="text-xs text-hh-muted">{hostOf(r.url)}</span>
      {r.note && <p className="text-xs leading-relaxed text-hh-ink-2">{r.note}</p>}
    </li>
  );
}

const FORMAT_TABS: { key: string; label: string }[] = [
  { key: "all", label: "All" },
  { key: "dynasty", label: LEAGUE_TYPE_LABEL.dynasty },
  { key: "redraft", label: LEAGUE_TYPE_LABEL.redraft },
  { key: "guillotine", label: LEAGUE_TYPE_LABEL.guillotine },
];

function isFormat(v: string | undefined): v is LeagueType {
  return v === "dynasty" || v === "redraft" || v === "guillotine";
}

const GRID = "grid gap-x-8 md:grid-cols-2 lg:grid-cols-3";

export default async function ResourcesPage({
  searchParams,
}: {
  searchParams: Promise<{ format?: string }>;
}) {
  const { format } = await searchParams;
  const active = isFormat(format) ? format : null;

  // An empty formats array means the resource is not tied to a league format
  // (survivor tools). Those show only under All.
  const matches = (formats: LeagueType[]) =>
    active === null ? true : formats.includes(active);

  const visible = RESOURCES.filter((r) => matches(r.formats));
  const visibleRedditors = REDDITORS.filter((u) => matches(u.formats));
  const featured = visible.filter((r) => r.featured);
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-10">
        <div className="flex flex-col gap-3">
          <PageHead
            title="Resources"
            sub="Rankings and strategy diverge sharply between formats, so a dynasty trade value chart is actively wrong in a redraft league. Filter to the format you are playing."
          />
          <nav aria-label="Format" className="-mx-3 flex flex-wrap items-center gap-1">
            {FORMAT_TABS.map((t) => {
              const on = t.key === "all" ? active === null : active === t.key;
              const count =
                t.key === "all"
                  ? RESOURCES.length + REDDITORS.length
                  : RESOURCES.filter((r) => r.formats.includes(t.key as LeagueType)).length +
                    REDDITORS.filter((u) => u.formats.includes(t.key as LeagueType)).length;
              return (
                <Link
                  key={t.key}
                  href={t.key === "all" ? "/resources" : `/resources?format=${t.key}`}
                  aria-current={on ? "page" : undefined}
                  className={`relative inline-flex min-h-11 items-center gap-1.5 px-3 text-sm font-medium transition-colors ${
                    on ? "text-hh-ink" : "text-hh-muted hover:text-hh-ink"
                  }`}
                >
                  {t.label}
                  <Num className="text-xs opacity-70">{count}</Num>
                  {on && <span aria-hidden className="absolute inset-x-3 bottom-0 h-[2px] bg-hh-ink" />}
                </Link>
              );
            })}
          </nav>
        </div>

        {featured.length > 0 && (
          <Section label={<span className="text-hh-accent-ink">Use these first</span>}>
            <ul className={GRID}>
              {featured.map((r) => (
                <ResourceRow key={r.url} r={r} strong />
              ))}
            </ul>
          </Section>
        )}

        <nav aria-label="Categories" className="flex flex-wrap gap-x-1 gap-y-0 text-sm">
          {CATEGORIES.filter((c) => visible.some((r) => r.category === c.key && !r.featured)).map((c) => (
            <a
              key={c.key}
              href={`#${c.key}`}
              className="inline-flex min-h-11 items-center px-2 font-medium text-hh-ink-2 underline-offset-[3px] hover:text-hh-accent-ink hover:underline"
            >
              {c.title}
            </a>
          ))}
          <a
            href="#redditors"
            className="inline-flex min-h-11 items-center px-2 font-medium text-hh-ink-2 underline-offset-[3px] hover:text-hh-accent-ink hover:underline"
          >
            Redditors
          </a>
        </nav>

        {CATEGORIES.map((cat) => {
          const items = visible.filter((r) => r.category === cat.key && !r.featured);
          if (items.length === 0) return null;
          const head = items.slice(0, SHOWN);
          const rest = items.slice(SHOWN);
          return (
            <div key={cat.key} id={cat.key} className="scroll-mt-20">
              <Section label={cat.title} aside={<><Num>{items.length}</Num> listed</>}>
                {cat.blurb && <p className="text-sm text-hh-muted">{cat.blurb}</p>}
                <ul className={GRID}>
                  {head.map((r) => (
                    <ResourceRow key={r.url} r={r} />
                  ))}
                </ul>
                {rest.length > 0 && (
                  <Disclosure summary={<><Num>{rest.length}</Num> more</>} className="mt-1">
                    <ul className={GRID}>
                      {rest.map((r) => (
                        <ResourceRow key={r.url} r={r} />
                      ))}
                    </ul>
                  </Disclosure>
                )}
              </Section>
            </div>
          );
        })}

        {visibleRedditors.length > 0 && (
          <div id="redditors" className="scroll-mt-20">
            <Section label="Redditors" aside={<><Num>{visibleRedditors.length}</Num> listed</>}>
              <p className="text-sm text-hh-muted">People worth following for analysis and rookie content.</p>
              {(() => {
                const row = (u: (typeof visibleRedditors)[number]) => (
                  <li key={u.handle} className="flex min-w-0 flex-col gap-1 border-b border-hh-line py-3">
                    <div className="flex items-start justify-between gap-3">
                      <a
                        href={u.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="min-w-0 flex-1 text-sm font-semibold text-hh-accent-ink underline-offset-[3px] hover:underline"
                      >
                        {u.handle}
                        <span className="ml-1.5 text-xs text-hh-muted">↗</span>
                      </a>
                      {u.status && u.status.length > 0 && (
                        <div className="flex shrink-0 flex-wrap justify-end gap-1">
                          {u.status.map((s) => (
                            <StatusBadge key={s} status={s} />
                          ))}
                        </div>
                      )}
                    </div>
                    <p className="text-xs leading-relaxed text-hh-ink-2">{u.posts}</p>
                  </li>
                );
                const head = visibleRedditors.slice(0, SHOWN);
                const rest = visibleRedditors.slice(SHOWN);
                return (
                  <>
                    <ul className={GRID}>{head.map(row)}</ul>
                    {rest.length > 0 && (
                      <Disclosure summary={<><Num>{rest.length}</Num> more</>} className="mt-1">
                        <ul className={GRID}>{rest.map(row)}</ul>
                      </Disclosure>
                    )}
                  </>
                );
              })()}
            </Section>
          </div>
        )}
      </div>
    </main>
  );
}
