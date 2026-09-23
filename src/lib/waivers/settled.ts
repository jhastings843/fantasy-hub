// Have this week's waivers actually run yet.
//
// The lineup email exists to say who starts, and until waivers process that
// question has a different answer: the player it tells you to start may be
// about to become somebody else's, and the player who should start may still
// be a claim you have not won. Sending it early is not early, it is wrong.
//
// Evidence first, clock second. Sleeper's transaction feed for a week carries
// the waiver run in it: every claim, won or lost, lands as a `waiver`
// transaction the moment the run completes. A week where nobody claimed
// anything leaves no trace at all, which is why there is also a cutoff.

import type { RawTransaction } from "@/lib/guillotine/league-state";

/** Wednesday, in America/New_York, where 0 is Sunday. */
const WEDNESDAY = 3;

/**
 * When Wednesday stops waiting for evidence.
 *
 * Every one of Jack's leagues processes between 3am and 5am ET on
 * Wednesday, so noon is many hours past the last of them. A week where nobody
 * in any league put in a claim still has to produce an email.
 */
const GIVE_UP_WAITING_AT = 12;

export interface LeagueTransactions {
  leagueId: string;
  name: string;
  transactions: RawTransaction[];
}

export interface WaiverSettlement {
  settled: boolean;
  /** Leagues with no sign of a waiver run yet. */
  waitingOn: string[];
  /** Why this answer, in a sentence the email job can report verbatim. */
  reason: string;
}

/**
 * A league's waiver run has happened if the week's feed says so.
 *
 * A failed claim counts. Losing a bid is proof the run took place, and a week
 * where every claim failed is exactly the week you most want the lineup email
 * to know about.
 */
export function leagueHasProcessed(transactions: RawTransaction[]): boolean {
  return transactions.some(
    (t) => t.type === "waiver" && (t.status === "complete" || t.status === "failed"),
  );
}

/** Day and hour in New York, without pulling in a date library. */
function newYorkParts(now: Date): { day: number; hour: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    hour12: false,
  }).formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return { day: Math.max(0, days.indexOf(weekday)), hour: hour % 24 };
}

/** Tuesday, in America/New_York. */
const TUESDAY = 2;

/**
 * The earliest moment a claim can belong to this week's run: the most recent
 * Tuesday noon in New York.
 *
 * Sleeper files a Wednesday run under the week just played, not the week
 * about to start, so the run that sets week 3's lineups lives in week 2's
 * feed. That same feed also carries the rolling claims from the previous
 * Thursday onward, which would read as "already processed" at 1am on
 * Wednesday. The timestamp is what tells them apart.
 */
export function thisWeeksRunStartsAt(now: Date): number {
  const { day, hour } = newYorkParts(now);
  const daysBack = (day - TUESDAY + 7) % 7;
  const hoursBack = daysBack * 24 + (hour - 12);
  // Tuesday before noon means last Tuesday's run is still the current one.
  const back = hoursBack < 0 ? hoursBack + 7 * 24 : hoursBack;
  return now.getTime() - back * 60 * 60 * 1000 - now.getMinutes() * 60 * 1000;
}

/** Claims from this week's run only, across the feeds it might be filed in. */
export function thisWeeksClaims(feeds: RawTransaction[][], now: Date): RawTransaction[] {
  const since = thisWeeksRunStartsAt(now);
  return feeds.flat().filter((t) => (t.status_updated ?? 0) >= since);
}

export function waiversAreSettled(
  leagues: LeagueTransactions[],
  now: Date,
): WaiverSettlement {
  const waitingOn = leagues.filter((l) => !leagueHasProcessed(l.transactions)).map((l) => l.name);

  if (leagues.length === 0) {
    return {
      settled: true,
      waitingOn: [],
      reason: "No Sleeper leagues to wait on.",
    };
  }

  if (waitingOn.length === 0) {
    return {
      settled: true,
      waitingOn: [],
      reason: `Waivers have processed in all ${leagues.length} leagues.`,
    };
  }

  const { day, hour } = newYorkParts(now);
  // Thursday onwards is not waiting any more, it is broken, and an email that
  // never arrives is worse than one sent without a claim to report.
  const pastWednesdayNoon = day > WEDNESDAY || (day === WEDNESDAY && hour >= GIVE_UP_WAITING_AT);

  if (pastWednesdayNoon) {
    return {
      settled: true,
      waitingOn,
      reason: `No waiver claims found in ${waitingOn.join(", ")}, but it is past Wednesday noon, so there was nothing to wait for.`,
    };
  }

  return {
    settled: false,
    waitingOn,
    reason: `Waivers have not run yet in ${waitingOn.join(", ")}. The lineup this email would print is not the lineup you will have.`,
  };
}
