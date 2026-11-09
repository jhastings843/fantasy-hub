"use client";

import { useEffect, useState } from "react";
import { ago } from "@/lib/status/core";
import { CADENCE, DESK_NAMES, clock, nextRun, type DeskId } from "@/lib/money/schedule";

// The client half of the desks' live activity (Jack, 2026-11-09). One poll of
// /api/money/activity feeds both the "Checked 6 min ago" line on each Money tab
// and the live feed on Today. Polls only while the tab is visible.

export interface Line {
  at: string;
  desk: DeskId;
  text: string;
  done?: boolean;
}
export interface Check {
  at: string;
  text: string;
}
export interface Feed {
  now: string;
  lines: Line[];
  checks: Partial<Record<DeskId, Check>>;
}

export function useFeed(initial: Feed | null, everyMs: number): { feed: Feed | null; now: Date } {
  const [feed, setFeed] = useState<Feed | null>(initial);
  const [now, setNow] = useState(() => new Date(initial?.now ?? Date.now()));
  useEffect(() => {
    let stop = false;
    const pull = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const r = await fetch("/api/money/activity", { cache: "no-store" });
        const j = await r.json();
        if (!stop && j?.ok) setFeed({ now: j.now, lines: j.lines ?? [], checks: j.checks ?? {} });
      } catch {
        // A missed poll is fine; the next one tries again.
      }
    };
    const tick = setInterval(() => setNow(new Date()), 15_000);
    const poll = setInterval(pull, everyMs);
    const onShow = () => document.visibilityState === "visible" && (setNow(new Date()), pull());
    document.addEventListener("visibilitychange", onShow);
    if (!initial) pull();
    return () => {
      stop = true;
      clearInterval(tick);
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [everyMs, initial]);
  return { feed, now };
}

/** A run that has not posted "done" within this long is treated as over (the Mac slept, the job died). */
export const RUN_WINDOW_MS = 8 * 60_000;

/** Desks with a line in the last RUN_WINDOW_MS whose newest line is not "done": working right now. */
export function activeDesks(lines: Line[], now: Date): Map<DeskId, Line> {
  const out = new Map<DeskId, Line>();
  const seen = new Set<DeskId>();
  for (const l of lines) {
    if (seen.has(l.desk)) continue;
    seen.add(l.desk);
    if (!l.done && now.getTime() - Date.parse(l.at) < RUN_WINDOW_MS) out.set(l.desk, l);
  }
  return out;
}

/**
 * One Money tab's freshness: when the desk last looked, what it found, when it
 * looks next. Reads "Checking now" while a run is in progress.
 *   Checked 6 min ago · No new breakouts in 42 stocks · Next check 2:05pm
 */
export function DeskChecked({ desk, initial }: { desk: DeskId; initial: Feed | null }) {
  const { feed, now } = useFeed(initial, 30_000);
  const c = feed?.checks[desk];
  const live = feed ? activeDesks(feed.lines, now).get(desk) : undefined;
  const next = nextRun(desk, now, c?.at);
  // Late: the slot after the last check has come and gone with 15 minutes to spare.
  const due = c ? nextRun(desk, new Date(c.at), c.at) : null;
  const late = !live && due && now.getTime() - due.getTime() > 15 * 60_000;
  return (
    <div className="flex flex-col gap-0.5 text-xs text-hh-muted">
      <p className="hh-num flex flex-wrap items-center gap-x-2 gap-y-1">
        {live ? (
          <span className="inline-flex items-center gap-2 font-semibold text-hh-ink">
            <span className="hh-live-dot" aria-hidden />
            {`Checking now: ${live.text}`}
          </span>
        ) : c ? (
          <span className={late ? "font-semibold text-hh-neg" : "text-hh-ink-2"}>
            Checked <time dateTime={c.at}>{ago(c.at, now)}</time>
            <span className="text-hh-muted">{` (${clock(c.at, now)})`}</span>
          </span>
        ) : (
          <span>No check on record yet</span>
        )}
        {!live && c?.text && (
          <>
            <span aria-hidden>·</span>
            <span>{c.text}</span>
          </>
        )}
        {late && due && (
          <>
            <span aria-hidden>·</span>
            <span className="font-semibold text-hh-neg">{`Expected ${clock(due, now)}, the Mac may be asleep`}</span>
          </>
        )}
        {next && (
          <>
            <span aria-hidden>·</span>
            <span>{`Next check ${clock(next, now)}`}</span>
          </>
        )}
      </p>
      <p>{CADENCE[desk]}</p>
    </div>
  );
}

/**
 * Today's live research feed. While a desk works, its lines stream in here in
 * plain words ("Checking NVDA against the Time Machine filter"). When nothing
 * runs, it says what ran last and what runs next.
 */
export function LiveResearch({ initial }: { initial: Feed | null }) {
  const { feed, now } = useFeed(initial, 4_000);
  const lines = (feed?.lines ?? []).filter((l) => now.getTime() - Date.parse(l.at) < 3 * 3_600_000);
  const active = feed ? activeDesks(feed.lines, now) : new Map<DeskId, Line>();
  const upcoming = (Object.keys(DESK_NAMES) as DeskId[])
    .map((d) => ({ d, at: nextRun(d, now, feed?.checks[d]?.at) }))
    .filter((x): x is { d: DeskId; at: Date } => !!x.at)
    .sort((a, b) => a.at.getTime() - b.at.getTime())[0];
  const shown = lines.slice(0, 14);

  return (
    <div className="flex flex-col gap-3">
      <div aria-live="polite" className="flex flex-col gap-1.5">
        {active.size > 0 ? (
          [...active.values()].map((l) => (
            <p key={l.desk} className="flex items-start gap-2.5 text-sm text-hh-ink">
              <span className="hh-live-dot mt-1.5 shrink-0" aria-hidden />
              <span>
                <span className="font-semibold">{DESK_NAMES[l.desk]}</span>
                {` is working: ${l.text}`}
              </span>
            </p>
          ))
        ) : (
          <p className="text-sm text-hh-ink-2">
            {"Nothing running right now."}
            {upcoming ? ` Next up: ${DESK_NAMES[upcoming.d]} at ${clock(upcoming.at, now)}.` : ""}
          </p>
        )}
      </div>

      {shown.length > 0 ? (
        <ol className="flex flex-col">
          {shown.map((l, i) => (
            <li key={`${l.at}-${l.desk}-${i}`} className={`grid grid-cols-[4.25rem_minmax(0,1fr)] gap-x-3 border-t border-hh-line py-2 first:border-t-0 ${i === 0 ? "hh-tick" : ""}`}>
              <time dateTime={l.at} className="hh-num pt-px text-xs text-hh-muted">
                {clock(l.at, now)}
              </time>
              <p className={`min-w-0 text-sm leading-snug ${l.done ? "text-hh-ink" : "text-hh-ink-2"}`}>
                <span className="mr-1.5 text-[11px] font-semibold uppercase tracking-wide text-hh-muted">{DESK_NAMES[l.desk]}</span>
                {l.text}
              </p>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-hh-muted">No desk has posted in the last 3 hours.</p>
      )}
    </div>
  );
}
