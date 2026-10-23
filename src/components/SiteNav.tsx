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
  // One top tab for the betting ledger (Jack, 2026-10-22: "one hobby tab... with the subtabs top center").
  { key: "hobby", label: "Hobby", href: "/today", owns: (p) => isHobby(p) },
];

/** The betting ledger's own tabs, centered under the top nav (the Ledger redesign). */
const HOBBY_TABS = [
  { href: "/today", label: "Today", owns: (p: string) => under(p, "/today") },
  { href: "/picks", label: "Picks", owns: (p: string) => under(p, "/picks") },
  { href: "/props", label: "Props", owns: (p: string) => under(p, "/props") },
  { href: "/records", label: "Records", owns: (p: string) => under(p, "/records") },
  { href: "/money", label: "Money", owns: (p: string) => under(p, "/money") },
];
export const isHobby = (p: string) => HOBBY_TABS.some((t) => t.owns(p));

const FANTASY_TABS = [
  { href: "/", label: "Leagues", owns: (p: string) => p === "/" || under(p, "/l") },
  { href: "/strategy", label: "Strategy", owns: (p: string) => under(p, "/strategy") },
  { href: "/resources", label: "Resources", owns: (p: string) => under(p, "/resources") },
];

export function SectionTabs() {
  const p = usePathname() ?? "/";
  return (
    <div className="flex items-center gap-1 overflow-x-auto">
      {SECTIONS.map((s) => {
        const active = s.owns(p);
        return (
          <Link
            key={s.key}
            href={s.href}
            aria-current={active ? "page" : undefined}
            className={`whitespace-nowrap rounded-full px-4 py-2 text-[15px] font-semibold transition-colors ${
              active ? "bg-zinc-50 text-zinc-900" : "text-zinc-400 hover:text-zinc-50"
            }`}
          >
            {s.label}
          </Link>
        );
      })}
    </div>
  );
}

/** The ledger's tabs, centered, shown only inside Hobby. */
export function HobbyTabs() {
  const p = usePathname() ?? "/";
  if (!isHobby(p)) return null;
  return (
    <div className="border-b border-zinc-200/60 bg-white/60 backdrop-blur dark:border-zinc-800/60 dark:bg-zinc-950/60">
      <nav aria-label="Hobby" className="mx-auto flex w-full max-w-6xl items-center justify-center gap-1 overflow-x-auto px-3 py-2 sm:px-5 lg:px-7">
        {HOBBY_TABS.map((t) => {
          const active = t.owns(p);
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? "page" : undefined}
              className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors ${
                active ? "bg-zinc-50 text-zinc-900" : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-50"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
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
