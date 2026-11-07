"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** A one-line, sideways-scrolling tab row that brings the current tab into view on load (phones). */
export function ScopeScroll({ className, label, children }: { className: string; label: string; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = ref.current;
    const cur = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !cur || nav.scrollWidth <= nav.clientWidth) return;
    // Only the row scrolls, never the page.
    nav.scrollLeft = Math.max(0, cur.offsetLeft - (nav.clientWidth - cur.offsetWidth) / 2);
  }, []);
  return (
    <nav ref={ref} className={className} aria-label={label}>
      {children}
    </nav>
  );
}
