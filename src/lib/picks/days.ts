// Groups games by their Eastern calendar day, for the week board's
// "today first, later days below" layout. Pure: `now` is passed in.

const ET = "America/New_York";
const dayKey = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: ET });

export interface DayGroup<T> {
  /** YYYY-MM-DD in Eastern time, or "tbd" when kickoff is unknown. */
  key: string;
  /** "Today · Thu", "Tomorrow · Fri", "Saturday", or "Time TBD". */
  label: string;
  games: T[];
}

export function groupByDay<T>(games: T[], kickoffOf: (g: T) => string | undefined, now: Date): DayGroup<T>[] {
  const today = dayKey(now);
  const tomorrow = dayKey(new Date(now.getTime() + 86400000));
  const groups = new Map<string, DayGroup<T>>();
  // Unknown kickoffs sort last (plain compare: localeCompare ranks "~" before digits).
  const at = (g: T) => kickoffOf(g) ?? "~";
  const sorted = [...games].sort((a, b) => (at(a) < at(b) ? -1 : at(a) > at(b) ? 1 : 0));
  for (const g of sorted) {
    const iso = kickoffOf(g);
    const d = iso ? new Date(iso) : null;
    const key = d ? dayKey(d) : "tbd";
    if (!groups.has(key)) {
      const short = d?.toLocaleDateString("en-US", { timeZone: ET, weekday: "short" });
      const long = d?.toLocaleDateString("en-US", { timeZone: ET, weekday: "long" });
      const label = !d ? "Time TBD" : key === today ? `Today · ${short}` : key === tomorrow ? `Tomorrow · ${short}` : long!;
      groups.set(key, { key, label, games: [] });
    }
    groups.get(key)!.games.push(g);
  }
  return [...groups.values()];
}
