import { Suspense } from "react";
import Link from "next/link";
import { loadFreshness } from "@/lib/status/load";
import { ago } from "@/lib/status/core";

// One line per page saying how old its numbers are (UX pass, 2026-11-06):
//   "Lines and scores 10 min ago · Props 2 h ago · Checked 4 min ago · Status"
// Anything older than STALE_H reads in the warning color. Streams in after the
// page so it never slows it; a read failure just shows nothing.

type What = Parameters<typeof loadFreshness>[0][number];
const STALE_H = 6;

async function Line({ what }: { what: What[] }) {
  const items = await loadFreshness(what).catch(() => []);
  if (!items.length) return null;
  const now = new Date();
  return (
    <p className="hh-num flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-hh-muted">
      {items.map((x, i) => {
        const stale = (now.getTime() - Date.parse(x.at)) / 3_600_000 > STALE_H;
        return (
          <span key={x.label} className="inline-flex items-center gap-2">
            {i > 0 && <span aria-hidden>·</span>}
            <span className={stale ? "font-semibold text-hh-neg" : undefined}>
              {x.label} <time dateTime={x.at}>{ago(x.at, now)}</time>
            </span>
          </span>
        );
      })}
      <span aria-hidden>·</span>
      <Link href="/status" className="font-semibold text-hh-accent-ink underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hh-accent">
        Status
      </Link>
    </p>
  );
}

export function Freshness({ what, className = "" }: { what: What[]; className?: string }) {
  return (
    <div className={className}>
      <Suspense fallback={<p className="h-4 w-56 animate-pulse rounded bg-hh-line" aria-hidden />}>
        <Line what={what} />
      </Suspense>
    </div>
  );
}
