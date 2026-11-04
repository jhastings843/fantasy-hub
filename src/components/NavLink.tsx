"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// A league tool tab. Same look as the hub sub-tabs (HubNav SubTabs): plain text,
// muted until active, a 2px ink underline on the one you're on, 44px tall.
export function NavLink({
  href,
  label,
  exact = false,
}: {
  href: string;
  label: string;
  /**
   * Match the path exactly instead of prefix-matching. Needed for links whose
   * href is a prefix of every sibling, such as a league home at /l/[id] when
   * its tools live at /l/[id]/draft.
   */
  exact?: boolean;
}) {
  const pathname = usePathname();
  const active = exact
    ? pathname === href
    : pathname === href || (href !== "/" && !!pathname?.startsWith(href + "/"));
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`relative flex min-h-11 items-center whitespace-nowrap px-3 text-sm font-medium transition-colors ${
        active ? "text-hh-ink" : "text-hh-muted hover:text-hh-ink"
      }`}
    >
      {label}
      {active && <span aria-hidden className="absolute inset-x-3 bottom-0 h-[2px] bg-hh-ink" />}
    </Link>
  );
}
