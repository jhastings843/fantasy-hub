"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { PlayerLink } from "@/components/PlayerLink";
import { Empty, Num, PosBadge, Section } from "@/components/hh/ui";
import { PopLink } from "@/components/hh/PopLink";
import { TeamEdge } from "@/components/hh/team";
import { teamHref } from "@/app/picks/hrefs";

const TRACKED_POSITIONS = ["QB", "RB", "WR", "TE"] as const;

type PositionFilter = (typeof TRACKED_POSITIONS)[number] | "all";

export interface SearchablePlayer {
  id: string;
  name: string;
  position: string | null;
  team: string | null;
  value: number;
  photoUrl: string | null;
  rostered: boolean;
  ownerName: string | null;
}

const RESULT_LIMIT = 40;

export function PlayerSearch({ players }: { players: SearchablePlayer[] }) {
  const [query, setQuery] = useState("");
  const [posFilter, setPosFilter] = useState<PositionFilter>("all");
  const [waiverOnly, setWaiverOnly] = useState(false);
  const deferredQuery = useDeferredValue(query);

  const results = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    let filtered = players;
    if (posFilter !== "all") {
      filtered = filtered.filter((p) => p.position === posFilter);
    }
    if (waiverOnly) {
      filtered = filtered.filter((p) => !p.rostered);
    }
    if (q.length > 0) {
      filtered = filtered.filter((p) => p.name.toLowerCase().includes(q));
    } else {
      // Default sort: highest value first when no query
      filtered = [...filtered].sort((a, b) => b.value - a.value);
      return filtered.slice(0, RESULT_LIMIT);
    }
    // When searching, score by: starts-with > contains, then value
    filtered = [...filtered].sort((a, b) => {
      const an = a.name.toLowerCase();
      const bn = b.name.toLowerCase();
      const aStarts = an.startsWith(q) ? 0 : 1;
      const bStarts = bn.startsWith(q) ? 0 : 1;
      if (aStarts !== bStarts) return aStarts - bStarts;
      return b.value - a.value;
    });
    return filtered.slice(0, RESULT_LIMIT);
  }, [deferredQuery, posFilter, waiverOnly, players]);

  const showingTotalNote =
    deferredQuery.trim().length > 0 || posFilter !== "all" || waiverOnly;

  return (
    <Section label="Search all players" aside={<><Num>{players.length.toLocaleString()}</Num> indexed</>}>
      <div className="flex flex-col gap-3">
      <div className="relative">
        <Search
          size={16}
          aria-hidden
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-hh-muted"
        />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Type a player name..."
          className="min-h-11 w-full rounded-[4px] border border-hh-line bg-hh-panel py-2.5 pl-9 pr-3 text-base text-hh-ink placeholder:text-hh-muted focus:border-hh-accent focus:outline-none"
          aria-label="Search players"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Position">
          {(["all", ...TRACKED_POSITIONS] as PositionFilter[]).map((pos) => {
            const active = posFilter === pos;
            return (
              <button
                key={pos}
                type="button"
                aria-pressed={active}
                onClick={() => setPosFilter(pos)}
                className={`min-h-11 min-w-11 rounded-[4px] px-3 text-xs font-semibold transition-colors ${
                  active
                    ? "bg-hh-ink text-hh-bg"
                    : "border border-hh-line text-hh-ink-2 hover:bg-hh-sunk"
                }`}
              >
                {pos === "all" ? "All" : pos}
              </button>
            );
          })}
        </div>
        <label className="ml-auto inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-[4px] border border-hh-line px-3 text-xs font-medium text-hh-ink-2 hover:bg-hh-sunk">
          <input
            type="checkbox"
            className="size-4 accent-[var(--hh-accent)]"
            checked={waiverOnly}
            onChange={(e) => setWaiverOnly(e.target.checked)}
          />
          Waivers only
        </label>
      </div>

      <ul className="flex flex-col">
        {results.length === 0 && (
          <li><Empty>No players match.</Empty></li>
        )}
        {results.map((p) => (
          <li key={p.id}>
            <TeamEdge league="nfl" team={p.team} className="flex min-h-11 items-center gap-3 border-b border-hh-line py-2">
              <PlayerAvatar name={p.name} position={p.position} photoUrl={p.photoUrl} size="sm" />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <PlayerLink id={p.id} name={p.name} className="truncate text-sm font-medium text-hh-ink" />
                  {p.position && <PosBadge pos={p.position} />}
                </div>
                <span className="truncate text-xs text-hh-muted">
                  {p.team ? <PopLink href={teamHref("nfl", p.team)}>{p.team}</PopLink> : "FA"} ·{" "}
                  {p.rostered ? (
                    <span className="font-medium text-hh-ink-2">{p.ownerName ?? "rostered"}</span>
                  ) : (
                    <span className="font-medium text-hh-pos">Available</span>
                  )}
                </span>
              </div>
              <span className="shrink-0 text-sm font-semibold text-hh-ink">
                {p.value > 0 ? <Num>{p.value.toLocaleString()}</Num> : <span className="text-hh-muted">None</span>}
              </span>
            </TeamEdge>
          </li>
        ))}
      </ul>

      {showingTotalNote && results.length === RESULT_LIMIT && (
        <p className="text-[11px] text-hh-muted">
          Showing top <Num>{RESULT_LIMIT}</Num>. Refine the search to narrow down.
        </p>
      )}
      </div>
    </Section>
  );
}
