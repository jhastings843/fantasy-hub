"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Hobby Hub's two-level nav (2026-10-15). Five sections on top; Fantasy keeps
// its own tools one bar down, and a league's tools sit one bar below that (the
// league layout). URLs did not move: emails, workflows and bookmarks still
// point at /, /strategy, /picks and the rest.

type Section = { key: string; label: string; href: string; owns: (p: string) => boolean };

const under = (p: string, base: string) => p === base || p.startsWith(base + "/");

const FANTASY_PATHS = ["/strategy", "/resources", "/l"];
export const isFantasy = (p: string) => p === "/" || FANTASY_PATHS.some((b) => under(p, b));

const SECTIONS: Section[] = [
  { key: "fantasy", label: "Fantasy", href: "/", owns: isFantasy },
  // Its own section (Jack, 2026-10-15): the pool is not a fantasy league.
  { key: "survivor", label: "Survivor", href: "/survivor", owns: (p) => under(p, "/survivor") },
  // The betting sections in the Ledger order (2026-10-22): today first, the record after the markets.
  { key: "today", label: "Today", href: "/today", owns: (p) => under(p, "/today") },
  { key: "picks", label: "Picks", href: "/picks", owns: (p) => under(p, "/picks") },
  { key: "props", label: "Props", href: "/props", owns: (p) => under(p, "/props") },
  { key: "records", label: "Records", href: "/records", owns: (p) => under(p, "/records") },
  { key: "money", label: "Money", href: "/money", owns: (p) => under(p, "/money") },
];

const FANTASY_TABS = [
  { href: "/", label: "Leagues", owns: (p: string) => p === "/" || under(p, "/l") },
  { href: "/strategy", label: "Strategy", owns: (p: string) => under(p, "/strategy") },
  { href: "/resources", label: "Resources", owns: (p: string) => under(p, "/resources") },
];

export function SectionTabs() {
  const p = usePathname() ?? "/";
  return (
    <div className="-mx-1 flex items-center gap-1 overflow-x-auto sm:mx-0">
      {SECTIONS.map((s) => {
        const active = s.owns(p);
        return (
          <Link
            key={s.key}
            href={s.href}
            aria-current={active ? "page" : undefined}
            className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
              active
                ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
                : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
            }`}
          >
            {s.label}
          </Link>
        );
      })}
    </div>
  );
}

/** Fantasy's own tabs, shown only inside the Fantasy section. */
export function FantasyTabs() {
  const p = usePathname() ?? "/";
  if (!isFantasy(p)) return null;
  return (
    <div className="border-b border-zinc-200/60 bg-white/60 backdrop-blur dark:border-zinc-800/60 dark:bg-zinc-950/60">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-1 overflow-x-auto px-3 sm:px-5 lg:px-7">
        {FANTASY_TABS.map((t) => {
          const active = t.owns(p);
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? "page" : undefined}
              className={`relative whitespace-nowrap px-3 py-2.5 text-sm font-medium transition-colors ${
                active ? "text-zinc-900 dark:text-zinc-50" : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
              }`}
            >
              {t.label}
              {active && (
                <span aria-hidden className="absolute bottom-0 left-3 right-3 h-0.5 rounded-full bg-zinc-900 dark:bg-zinc-50" />
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
