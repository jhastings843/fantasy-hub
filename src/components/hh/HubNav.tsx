"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarCheck, LineChart, Target, Trophy, Wallet, type LucideIcon } from "lucide-react";
import { HUBS, hubFor, type HubKey } from "./hubs";

const ICON: Record<HubKey, LucideIcon> = {
  today: CalendarCheck,
  bets: Target,
  fantasy: Trophy,
  money: Wallet,
  results: LineChart,
};

/** Desktop and tablet: the five hubs in Barlow caps, a rust (teal) underline on the one you're in. */
export function HubTabs() {
  const p = usePathname() ?? "/";
  const active = hubFor(p)?.key;
  return (
    <nav aria-label="Hubs" className="hidden h-full items-stretch gap-1 sm:flex">
      {HUBS.map((h) => {
        const on = h.key === active;
        return (
          <Link
            key={h.key}
            href={h.href}
            aria-current={on ? "page" : undefined}
            className={`relative flex items-center px-3 font-display text-[17px] font-semibold uppercase tracking-[0.06em] transition-colors lg:px-4 ${
              on ? "text-hh-ink" : "text-hh-muted hover:text-hh-ink"
            }`}
          >
            {h.label}
            <span
              aria-hidden
              className={`absolute inset-x-3 bottom-0 h-[3px] bg-hh-accent transition-transform duration-200 lg:inset-x-4 ${on ? "scale-x-100" : "scale-x-0"}`}
            />
          </Link>
        );
      })}
    </nav>
  );
}

/** The hub's own tabs, one row under the top bar. Hidden for single-page hubs. */
export function SubTabs() {
  const p = usePathname() ?? "/";
  const hub = hubFor(p);
  if (!hub || hub.tabs.length < 2) return null;
  return (
    <div className="border-b border-hh-line bg-hh-bg">
      <nav
        aria-label={`${hub.label} sections`}
        className="mx-auto flex w-full max-w-6xl items-center gap-1 overflow-x-auto px-2 [scrollbar-width:none] sm:px-4 lg:px-6 [&::-webkit-scrollbar]:hidden"
      >
        {hub.tabs.map((t) => {
          const on = t.owns(p);
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={on ? "page" : undefined}
              className={`relative flex min-h-11 items-center whitespace-nowrap px-3 text-sm font-medium transition-colors ${
                on ? "text-hh-ink" : "text-hh-muted hover:text-hh-ink"
              }`}
            >
              {t.label}
              {on && <span aria-hidden className="absolute inset-x-3 bottom-0 h-[2px] bg-hh-ink" />}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

/** Phones (under 640px): the five hubs as a bottom tab bar, icon over label, clear of the home bar. */
export function BottomTabs() {
  const p = usePathname() ?? "/";
  const active = hubFor(p)?.key;
  return (
    <nav
      aria-label="Hubs"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-hh-line bg-hh-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md sm:hidden"
    >
      <ul className="grid h-[var(--hh-tabbar-h)] grid-cols-5">
        {HUBS.map((h) => {
          const on = h.key === active;
          const Icon = ICON[h.key];
          return (
            <li key={h.key} className="contents">
              <Link
                href={h.href}
                aria-current={on ? "page" : undefined}
                className={`relative flex flex-col items-center justify-center gap-1 transition-colors [touch-action:manipulation] ${
                  on ? "text-hh-accent-ink" : "text-hh-muted active:text-hh-ink"
                }`}
              >
                <span aria-hidden className={`absolute inset-x-5 top-0 h-[2px] bg-hh-accent transition-opacity duration-200 ${on ? "opacity-100" : "opacity-0"}`} />
                <Icon size={21} strokeWidth={on ? 2.1 : 1.7} aria-hidden />
                <span className="font-display text-[12px] font-semibold uppercase tracking-[0.06em]">{h.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
