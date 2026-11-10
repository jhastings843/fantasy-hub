import "server-only";
import { redis } from "@/lib/redis/client";
import type { MoneySnapshot } from "./types";
import type { DeskId } from "./schedule";

// What the Mac's desks are doing, line by line (Jack, 2026-11-09: "checking
// this, checking that, looking for that"). trade-bot's tradebot/activity.py
// posts each line to /api/money/activity as it works.
// - money:v1:activity  newest-first list of lines, trimmed to FEED_MAX
// - money:v1:checks    hash desk -> the last line marked done, which is what
//                      a desk's "Checked 6 min ago" reads

const FEED = "money:v1:activity";
const CHECKS = "money:v1:checks";
const FEED_MAX = 400;

export interface ActivityLine {
  at: string;
  desk: DeskId;
  text: string;
  /** The desk finished this run; the text says what it found. */
  done?: boolean;
}

export interface Check {
  at: string;
  text: string;
}

export async function addLine(x: ActivityLine) {
  await redis.lpush(FEED, x);
  await redis.ltrim(FEED, 0, FEED_MAX - 1);
  if (x.done) await redis.hset(CHECKS, { [x.desk]: { at: x.at, text: x.text } satisfies Check });
}

export async function recentLines(n = 80): Promise<ActivityLine[]> {
  return ((await redis.lrange<ActivityLine>(FEED, 0, n - 1)) ?? []).filter((x) => x && typeof x.text === "string");
}

/**
 * Each desk's last finished check. Live lines win; before a desk has posted
 * one, the snapshot's own clock for it stands in (Phil's last cycle, the
 * weather run, the Day Trader's as-of, or the snapshot's `checks` from the Mac).
 */
export async function loadChecks(snap: MoneySnapshot | null): Promise<Partial<Record<DeskId, Check>>> {
  const live = (await redis.hgetall<Record<string, Check>>(CHECKS).catch(() => null)) ?? {};
  const out: Partial<Record<DeskId, Check>> = {};
  const put = (d: DeskId, c: Check | null | undefined) => {
    if (!c?.at || Number.isNaN(Date.parse(c.at))) return;
    if (!out[d] || Date.parse(c.at) > Date.parse(out[d]!.at)) out[d] = c;
  };
  for (const [d, c] of Object.entries(snap?.checks ?? {})) put(d as DeskId, c);
  if (snap?.phil?.lastCycle) put("phil", { at: snap.phil.lastCycle, text: "Finished an hourly cycle" });
  if (snap?.gus?.lastCycle) put("gus", { at: snap.gus.lastCycle, text: "Finished an hourly cycle" });
  if (snap?.weather?.generatedAt) put("weather", { at: snap.weather.generatedAt, text: "Scored the forecasts" });
  for (const [d, c] of Object.entries(live)) put(d as DeskId, c);
  return out;
}

/**
 * One finished run of the hub's own jobs (prop captures, pick saves, the
 * pulse) as a feed line. Counts come from the run's report: every non-empty
 * list but `problems`, e.g. "NBA picks: saved 5, settled 2". Never throws.
 */
export async function logRun(desk: DeskId, name: string, report: unknown, problems: string[] = []): Promise<void> {
  try {
    await addLine({ at: new Date().toISOString(), desk, text: runText(name, report, problems), done: true });
  } catch {
    /* the feed is a nicety; the run never notices */
  }
}

export function runText(name: string, report: unknown, problems: string[] = []): string {
  const parts: string[] = [];
  if (report && typeof report === "object") {
    for (const [k, v] of Object.entries(report as Record<string, unknown>)) {
      if (k === "problems" || !Array.isArray(v) || !v.length) continue;
      parts.push(`${k.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()} ${v.length}`);
    }
  }
  const body = parts.length ? parts.slice(0, 4).join(", ") : "nothing new";
  const bad = problems.length ? `, ${problems.length} problem${problems.length === 1 ? "" : "s"}` : "";
  return `${name}: ${body}${bad}`.slice(0, 200);
}
