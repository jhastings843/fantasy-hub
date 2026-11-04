"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Check, ChevronDown } from "lucide-react";
import { TOOLS, leaguePath } from "@/lib/league/tools";
import { LEAGUE_TYPE_LABEL, type LeagueProfile } from "@/lib/league/types";
import { Chip, type Tone } from "@/components/hh/ui";

const TYPE_TONE: Record<string, Tone> = {
  dynasty: "accent",
  redraft: "gold",
  guillotine: "neg",
};

/**
 * Which tool the current URL is on, if any. Only the top-level segment carries
 * across a league switch: detail pages are keyed to one league's rosters and
 * members, so following them into another league would land on nothing.
 */
function currentToolSegment(pathname: string): string {
  const parts = pathname.split("/").filter(Boolean); // ["l", id, segment, ...]
  const segment = parts[2] ?? "";
  return TOOLS.some((t) => t.segment === segment && t.segment !== "")
    ? segment
    : "";
}

function targetPath(pathname: string, league: LeagueProfile): string {
  const segment = currentToolSegment(pathname);
  if (!segment) return leaguePath(league.id, "");

  const tool = TOOLS.find((t) => t.segment === segment);
  const supported = tool?.types.includes(league.type) ?? false;
  return leaguePath(league.id, supported ? segment : "");
}

export function LeagueSwitcher({
  leagues,
  current,
}: {
  leagues: LeagueProfile[];
  current: LeagueProfile;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname() ?? "";

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Nothing to switch to.
  if (leagues.length < 2) {
    return (
      <span className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-hh-ink">
        {current.name}
        <TypeChip type={current.type} />
      </span>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="inline-flex min-h-11 items-center gap-2 rounded-[4px] border border-hh-line bg-hh-panel px-3 py-1.5 text-sm font-semibold text-hh-ink transition-colors hover:border-hh-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-hh-accent"
      >
        <span className="max-w-[10rem] truncate">{current.name}</span>
        <TypeChip type={current.type} />
        <ChevronDown
          size={14}
          aria-hidden
          className={`text-hh-muted transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 z-50 mt-1.5 w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-[var(--hh-radius)] border border-hh-line bg-hh-panel shadow-lg"
        >
          {leagues.map((l) => {
            const active = l.id === current.id;
            return (
              <Link
                key={l.id}
                href={targetPath(pathname, l)}
                role="menuitem"
                onClick={() => setOpen(false)}
                className="flex min-h-11 items-center justify-between gap-3 border-b border-hh-line px-3 py-2.5 transition-colors last:border-b-0 hover:bg-hh-sunk focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-hh-accent"
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-sm font-semibold text-hh-ink">
                    {l.name}
                  </span>
                  <span className="text-xs text-hh-muted">
                    <span className="hh-num">{l.teams}</span> team {l.superflex ? "superflex" : "single QB"}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <TypeChip type={l.type} />
                  {active && (
                    <Check
                      size={14}
                      aria-label="Current league"
                      className="text-hh-accent-ink"
                    />
                  )}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TypeChip({ type }: { type: string }) {
  return (
    <Chip tone={TYPE_TONE[type] ?? "accent"}>
      {LEAGUE_TYPE_LABEL[type as keyof typeof LEAGUE_TYPE_LABEL] ?? type}
    </Chip>
  );
}
