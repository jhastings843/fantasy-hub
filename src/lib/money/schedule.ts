// When each Money desk runs on the Mac, so a page can say "next check 2:05pm"
// and explain a quiet Monday (Jack, 2026-11-09: Trends kept saying "Nov 6
// close" with nothing to show it had looked since). Pure: safe in client code.
//
// Mirrors the launchd plists in trade-bot/scripts and weather-desk. If a plist
// changes, change it here too.
//   intraday  9:00 premarket, then every 5 min 9:50 to 4:05pm, weekdays
//   books     6:30am Tue to Sat (paper_nightly.sh), on the prior day's close
//   trends    same run as books
//   options   10:05am and 3:55pm, weekdays
//   phil, gus every hour (StartInterval 3600, so an hour after the last check)
//   weather   every hour at :20

export type DeskId = "intraday" | "books" | "trends" | "options" | "phil" | "gus" | "weather";

export const DESK_NAMES: Record<DeskId, string> = {
  intraday: "Day Trader",
  books: "Stock books",
  trends: "Trends",
  options: "Options",
  phil: "Phil",
  gus: "Gus",
  weather: "Weather",
};

export const CADENCE: Record<DeskId, string> = {
  intraday: "Checks every 5 minutes, 9:50am to 4pm on weekdays",
  books: "Runs before the open, Tue to Sat, on the prior day's close",
  trends: "Picks before the open, Tue to Sat, from the prior day's close",
  options: "Checks at 10:05am and 3:55pm on weekdays",
  phil: "Checks every hour",
  gus: "Checks every hour",
  weather: "Checks every hour at :20",
};

export const isDesk = (x: unknown): x is DeskId => typeof x === "string" && x in DESK_NAMES;

const TZ = "America/New_York";

/** Wall-clock parts in New York. weekday: 1 Mon .. 7 Sun. */
function etParts(d: Date) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", weekday: "short", hourCycle: "h23" });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  const wd = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(p.weekday) + 1;
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, wd };
}

/** The instant a New York wall time happens (DST-safe to the minute). */
function etInstant(y: number, mo: number, d: number, h: number, mi: number): Date {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const p = etParts(new Date(guess));
  const offset = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi) - guess;
  return new Date(guess - offset);
}

/** Slots (minutes after midnight) a desk runs on a weekday (1 Mon .. 7 Sun). */
function slots(desk: DeskId, wd: number): number[] {
  const weekday = wd <= 5;
  switch (desk) {
    case "intraday": {
      if (!weekday) return [];
      const out = [9 * 60];
      for (let t = 9 * 60 + 50; t <= 16 * 60 + 5; t += 5) out.push(t);
      return out;
    }
    case "books":
    case "trends":
      return wd >= 2 && wd <= 6 ? [6 * 60 + 30] : [];
    case "options":
      return weekday ? [10 * 60 + 5, 15 * 60 + 55] : [];
    case "weather":
      return Array.from({ length: 24 }, (_, h) => h * 60 + 20);
    default:
      return [];
  }
}

/**
 * The next time a desk runs after `now`. Phil and Gus run an hour after their
 * last check, so they need `lastAt`; without it there is no answer (null).
 * Holidays are not known here: on one the desk wakes, sees the market shut and
 * goes back to sleep, so the time shown is still when it next looks.
 */
export function nextRun(desk: DeskId, now: Date, lastAt?: string | null): Date | null {
  if (desk === "phil" || desk === "gus") {
    if (!lastAt) return null;
    let t = Date.parse(lastAt) + 3_600_000;
    while (t <= now.getTime()) t += 3_600_000;
    return new Date(t);
  }
  const p = etParts(now);
  for (let add = 0; add < 9; add++) {
    const day = etParts(new Date(Date.UTC(p.y, p.mo - 1, p.d + add, 12)));
    for (const m of slots(desk, day.wd)) {
      const at = etInstant(day.y, day.mo, day.d, Math.floor(m / 60), m % 60);
      if (at.getTime() > now.getTime()) return at;
    }
  }
  return null;
}

/** "2:05pm", "Tue 6:30am" when it is not today, in New York time. */
export function clock(at: Date | string, now: Date): string {
  const d = typeof at === "string" ? new Date(at) : at;
  const t = d.toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).replace(" ", "").toLowerCase();
  const same = d.toLocaleDateString("en-US", { timeZone: TZ }) === now.toLocaleDateString("en-US", { timeZone: TZ });
  if (same) return t;
  const days = Math.abs(d.getTime() - now.getTime()) / 86_400_000;
  const wd = d.toLocaleDateString("en-US", { timeZone: TZ, weekday: "short" });
  return days < 6 ? `${wd} ${t}` : `${d.toLocaleDateString("en-US", { timeZone: TZ, month: "short", day: "numeric" })} ${t}`;
}
