"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { searchEntries, type SearchEntry } from "@/app/picks/WeekSearch";

// The one search box, in the site header on every page (Jack, 2026-10-22:
// "not on the pages but at the top area... so it's always there"). It loads
// this week's index (/api/search) the first time it is used, then filters as
// you type; each result opens the page it comes from. "/" focuses it.

const LIMIT = 8;
const TONE: { [k in SearchEntry["rows"][number]["tone"]]: string } = {
  bet: "text-hh-accent-ink font-semibold",
  lean: "text-hh-ink",
  pass: "text-hh-muted",
  W: "text-hh-pos",
  L: "text-hh-neg",
  P: "text-hh-ink-2",
};

export default function HeaderSearch() {
  const [q, setQ] = useState("");
  const [entries, setEntries] = useState<SearchEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const load = () => {
    if (entries || failed) return;
    fetch("/api/search")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { entries: SearchEntry[] }) => setEntries(d.entries))
      .catch(() => setFailed(true));
  };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && /input|textarea|select/i.test(e.target.tagName);
      if (e.key === "/" && !typing) {
        e.preventDefault();
        input.current?.focus();
      }
      if (e.key === "Escape") setOpen(false);
    };
    const click = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", key);
    document.addEventListener("mousedown", click);
    return () => {
      document.removeEventListener("keydown", key);
      document.removeEventListener("mousedown", click);
    };
  }, []);

  const hits = entries ? searchEntries(entries, q) : [];
  const show = open && q.trim().length > 0;

  return (
    <div ref={box} className="relative w-full max-w-[22rem] sm:w-64" role="search">
      <label htmlFor="site-search" className="sr-only">
        Search this week&apos;s picks and props
      </label>
      <svg aria-hidden viewBox="0 0 16 16" className="pointer-events-none absolute left-3.5 top-1/2 size-3.5 -translate-y-1/2 fill-none stroke-hh-muted" strokeWidth={1.6}>
        <circle cx="7" cy="7" r="5" />
        <path d="M11 11l3.5 3.5" />
      </svg>
      <input
        ref={input}
        id="site-search"
        type="search"
        value={q}
        placeholder="Team or player"
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="search"
        onFocus={() => {
          load();
          setOpen(true);
        }}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        className="h-10 w-full rounded-[6px] border border-hh-line bg-hh-panel py-2 pl-9 pr-3 text-[16px] text-hh-ink placeholder:text-hh-muted focus:border-hh-accent focus:outline-none sm:pr-9 sm:text-sm"
      />
      {!q && <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border border-hh-line px-1 font-mono text-[10px] text-hh-muted sm:block">/</kbd>}
      {show && (
        <div className="absolute right-0 z-[60] mt-2 max-h-[70vh] w-[min(30rem,calc(100vw-2rem))] overflow-y-auto rounded-[6px] border border-hh-line bg-hh-panel p-2 shadow-xl shadow-black/10" aria-live="polite">
          {failed ? (
            <p className="px-3 py-2 text-sm text-hh-muted">Search couldn&apos;t load just now. Try again in a minute.</p>
          ) : !entries ? (
            <p className="px-3 py-2 text-sm text-hh-muted">Loading this week…</p>
          ) : hits.length === 0 ? (
            <p className="px-3 py-2 text-sm text-hh-muted">{`Nothing this week matches “${q.trim()}”.`}</p>
          ) : (
            <ul className="flex flex-col">
              {hits.slice(0, LIMIT).map((e) => (
                <li key={e.key}>
                  <Link href={e.href ?? "/today"} onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2 hover:bg-hh-sunk">
                    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
                      <b className="text-sm text-hh-ink">{e.title}</b>
                      <span className="text-xs text-hh-muted sm:shrink-0 sm:text-right">{e.meta}</span>
                    </div>
                    <ul className="mt-1 flex flex-col gap-0.5">
                      {e.rows.slice(0, 4).map((r, i) => (
                        <li key={i} className="flex gap-2 text-xs">
                          <span className="w-20 shrink-0 text-hh-muted">{r.market}</span>
                          <span className={`min-w-0 ${TONE[r.tone]}`}>{r.text}</span>
                        </li>
                      ))}
                    </ul>
                  </Link>
                </li>
              ))}
              {hits.length > LIMIT && <li className="px-3 py-1 text-xs text-hh-muted">{`${hits.length - LIMIT} more. Keep typing to narrow it.`}</li>}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
