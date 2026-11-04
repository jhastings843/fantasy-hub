"use client";

import { useState } from "react";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { PlayerLink } from "@/components/PlayerLink";
import { PopLink } from "@/components/hh/PopLink";
import { Chip, Num } from "@/components/hh/ui";
import { teamHref } from "@/app/picks/hrefs";

export interface RookieRow {
  id: string;
  name: string;
  position: string | null;
  team: string | null;
  age: number | null;
  value: number;
  rank: number;
  positionRank: number;
  photoUrl: string | null;
  buyLow?: boolean;
  sellHigh?: boolean;
  breakout?: boolean;
}

const FILTERS = [
  { key: "all", label: "All" },
  { key: "QB", label: "QB" },
  { key: "RB", label: "RB" },
  { key: "WR", label: "WR" },
  { key: "TE", label: "TE" },
] as const;

export interface NextPickRef {
  label: string; // e.g. "1.06"
  value: number;
}

export function RookieList({
  rookies,
  weakestPositions,
  nextPick,
  limit = 30,
}: {
  rookies: RookieRow[];
  weakestPositions: string[];
  nextPick?: NextPickRef | null;
  limit?: number;
}) {
  const [filter, setFilter] = useState<string>("all");

  const counts: Record<string, number> = {
    all: rookies.length,
    QB: 0,
    RB: 0,
    WR: 0,
    TE: 0,
  };
  for (const r of rookies) {
    const p = r.position ?? "";
    if (p in counts) counts[p] += 1;
  }

  const filtered =
    filter === "all"
      ? rookies
      : rookies.filter((r) => r.position === filter);
  const visible = filtered.slice(0, limit);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => {
          const active = filter === f.key;
          const count = counts[f.key] ?? 0;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              disabled={count === 0 && f.key !== "all"}
              aria-pressed={active}
              className={`h-11 rounded-[6px] px-3 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 sm:h-8 ${
                active
                  ? "bg-hh-accent text-[var(--hh-on-accent)]"
                  : "border border-hh-line bg-hh-panel text-hh-ink-2 hover:border-hh-accent"
              }`}
            >
              {f.label}{" "}
              <Num className={active ? "opacity-80" : "opacity-60"}>{count}</Num>
            </button>
          );
        })}
      </div>

      <ul className="grid gap-x-8 md:grid-cols-2 lg:grid-cols-3">
        {visible.map((p, idx) => {
          const targetMatch =
            !!p.position && weakestPositions.includes(p.position);
          return (
            <li
              key={p.id}
              className="flex min-h-11 items-center gap-3 border-b border-hh-line py-2.5"
            >
              <Num className="w-6 shrink-0 text-sm font-semibold text-hh-muted">{idx + 1}</Num>
              <PlayerAvatar
                name={p.name}
                position={p.position ?? null}
                photoUrl={p.photoUrl}
                size="sm"
              />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <PlayerLink
                  id={p.id}
                  name={p.name}
                  className="truncate text-sm font-semibold"
                />
                <span className="text-xs text-hh-muted">
                  {p.team ? <PopLink href={teamHref("nfl", p.team)}>{p.team}</PopLink> : "FA"}
                  {[p.position, p.age ? `age ${p.age}` : null]
                    .filter(Boolean)
                    .map((x) => ` · ${x}`)
                    .join("")}
                </span>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-0.5">
                <Num className="text-sm font-semibold text-hh-ink">{p.value.toLocaleString()}</Num>
                {nextPick && (() => {
                  const surplus = p.value - nextPick.value;
                  if (surplus >= 200) {
                    return (
                      <span className="text-[10px] font-bold text-hh-pos">
                        <Num>+{surplus.toLocaleString()}</Num> vs <Num>{nextPick.label}</Num>
                      </span>
                    );
                  }
                  if (surplus <= -200) {
                    return (
                      <span className="text-[10px] text-hh-muted">
                        <Num>{surplus.toLocaleString()}</Num> vs <Num>{nextPick.label}</Num>
                      </span>
                    );
                  }
                  return null;
                })()}
                {targetMatch && (
                  <Chip tone="accent">Fit</Chip>
                )}
              </div>
            </li>
          );
        })}
        {visible.length === 0 && (
          <li className="py-2 text-sm text-hh-muted">
            No rookies match this filter.
          </li>
        )}
      </ul>
    </div>
  );
}
