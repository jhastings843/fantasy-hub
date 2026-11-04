import Link from "next/link";
import type { ReactNode } from "react";

/**
 * A team, matchup or player name that opens its pop-up (Jack, 2026-11-04).
 * scroll={false} keeps the page where it is under the pop-up. Reads as the
 * name it wraps, underlined on hover and focus so it is clearly tappable.
 */
export function PopLink({ href, children, className = "" }: { href: string; children: ReactNode; className?: string }) {
  return (
    <Link
      href={href}
      scroll={false}
      className={`underline decoration-transparent decoration-1 underline-offset-[3px] transition-colors hover:text-hh-accent-ink hover:decoration-current focus-visible:decoration-current ${className}`}
    >
      {children}
    </Link>
  );
}
