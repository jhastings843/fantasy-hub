// Is his list this week's list, or last week's?
//
// The waiver tool ranked off the Lab 300 posted on September 5 and offered
// two players who saw one target and two snaps between them in Week 1. A
// season list written before the games is not wrong, it is just not an
// opinion about what happened on Sunday. The rule, as Jack set it: a Jingles
// list counts for a waiver run only if it was posted or updated since the
// start of the current week (Monday, Eastern). Otherwise the tool ranks off
// the wire itself: who the whole of Sleeper is adding, filtered by who
// actually played last week.

export interface LastWeekUsage {
  week: number;
  points: number;
  snaps: number;
  targets: number;
  carries: number;
}

/** The ET wall clock for an instant, enough to find the start of the week. */
function etParts(now: Date): { day: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return {
    day: Math.max(0, days.indexOf(get("weekday"))),
    hour: Number(get("hour")) % 24,
    minute: Number(get("minute")),
  };
}

/** Monday 00:00 Eastern of the week `now` falls in. */
export function weekStartEt(now: Date): Date {
  const et = etParts(now);
  const sinceMonday = (et.day + 6) % 7;
  const ms =
    sinceMonday * 24 * 60 * 60 * 1000 + et.hour * 60 * 60 * 1000 + et.minute * 60 * 1000;
  return new Date(now.getTime() - ms);
}

/** True when a list was posted or updated since this week began. */
export function isFreshForRun(postedAt: string | null | undefined, now: Date = new Date()): boolean {
  if (!postedAt) return false;
  const posted = new Date(postedAt);
  if (Number.isNaN(posted.getTime())) return false;
  return posted.getTime() >= weekStartEt(now).getTime();
}

export function staleNote(listTitle: string, postedAt: string | null | undefined): string {
  const when = postedAt ? new Date(postedAt) : null;
  const dated =
    when && !Number.isNaN(when.getTime())
      ? when.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" })
      : "an earlier date";
  return `${listTitle} was last updated ${dated}, before this week's games. Until he posts again, these claims are ranked off the wire: who all of Sleeper is adding, filtered by who actually played last week.`;
}

export interface WireCandidate {
  playerId: string;
  /** How many Sleeper teams added him in the last day. */
  adds: number;
  lastWeek: LastWeekUsage | null;
  onBye: boolean;
}

/** A player with this few snaps last week did not have a role, whatever the adds say. */
const MIN_SNAPS = 10;

/**
 * The wire, ranked. Most-added first, with anyone who did not play last week
 * removed unless he was on bye. A player nobody has usage for is kept: an
 * injury replacement announced Tuesday has no snaps yet and is exactly the
 * claim the list exists to catch.
 */
export function rankWire(candidates: WireCandidate[]): WireCandidate[] {
  return candidates
    .filter((c) => c.onBye || c.lastWeek === null || c.lastWeek.snaps >= MIN_SNAPS)
    .sort((a, b) => b.adds - a.adds);
}

/** Pull the usage a claim decision cares about out of a Sleeper stat row. */
export function usageFrom(
  row: Record<string, number> | undefined,
  points: number | undefined,
  week: number,
): LastWeekUsage | null {
  if (!row) return null;
  return {
    week,
    points: points ?? 0,
    snaps: row.off_snp ?? 0,
    targets: row.rec_tgt ?? 0,
    carries: row.rush_att ?? 0,
  };
}

export function usageText(u: LastWeekUsage): string {
  const parts = [`${u.points.toFixed(1)} pts`, `${u.snaps} snaps`];
  if (u.targets > 0) parts.push(`${u.targets} tgt`);
  if (u.carries > 0) parts.push(`${u.carries} car`);
  return `Wk ${u.week}: ${parts.join(", ")}`;
}
