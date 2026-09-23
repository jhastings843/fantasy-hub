// What the heartbeat should do right now, decided from the clock alone.
//
// GitHub Actions calls /api/pulse every fifteen minutes and this function
// decides whether that call is a gameday refresh, the hourly top-up, the slow
// overnight pull, or nothing at all. The tempo lives here rather than in cron
// expressions for three reasons: cron runs on UTC and the NFL runs on Eastern,
// so twice a year a schedule written in UTC is an hour wrong; a workflow file
// cannot be tested; and one schedule in one place cannot disagree with itself.
//
// Pure, no network, no Redis. Everything below can be exercised by handing it
// an instant.

export type PulseTier = "live" | "hourly" | "overnight" | "idle";

// Note on "hourly": this says the hour is one the hourly job belongs in, not
// that this particular call should do it. Four calls land in every hour and
// GitHub's scheduler can deliver them minutes late or out of order, so the
// once-an-hour part is a debounce in run.ts against what actually ran, rather
// than a minute window here that a late run would fall straight through.

/** The emails, by the moment each one belongs to. */
export type SendId = "faab" | "midweek" | "thursday" | "sunday" | "alarm";

export type TimedJobId = "refresh-all-early" | "refresh-all-late";

export interface EtClock {
  /** 0 = Sunday. */
  day: number;
  hour: number;
  minute: number;
  /** 1 = January. */
  month: number;
}

export interface Tempo {
  tier: PulseTier;
  /** Why this tier, in words, for the receipt. */
  window: string;
  et: EtClock;
  /** Sends whose time has passed today. The send log decides if they go. */
  dueSends: SendId[];
  dueJobs: TimedJobId[];
}

export interface SendDays {
  /** Overridden by FAAB_EMAIL_DAY when the chopped roster drops another day. */
  faabDay?: number;
  /** Overridden by THURSDAY_EMAIL_DAY. */
  thursdayDay?: number;
}

const SUN = 0;
const MON = 1;
const WED = 3;
const THU = 4;

/**
 * Sunday's live window closes at 20:00 rather than at the end of the night
 * game. Once the 4pm games have kicked off there is nothing left in this app
 * to act on: lineups are locked, the survivor pick is in, and waivers do not
 * run until Wednesday. Refreshing through a game nobody can respond to is
 * spend with no decision attached.
 */
const SUNDAY_LIVE = { from: 11 * 60, to: 20 * 60 };

/** Thursday and Monday nights: kickoff is 20:15, the inactives land at 18:30. */
const NIGHT_LIVE = { from: 18 * 60 + 30, to: 23 * 60 + 30 };

/** Hours the hourly tier is awake. Nothing upstream moves at 3am. */
const DAY_START_HOUR = 7;
const DAY_END_HOUR = 23;

/** The slow pull: values, grades, traded picks. */
const OVERNIGHT_HOUR = 4;

type Season = "full" | "preseason" | "off";

/**
 * September to January is the season this app is for. August still moves:
 * rankings, values and a draft board, but nothing that needs watching by the
 * quarter hour. February to July nothing moves but dynasty values, so the
 * heartbeat drops to one run a night and the emails stop entirely.
 */
function seasonFor(month: number): Season {
  if (month >= 9 || month === 1) return "full";
  if (month === 8) return "preseason";
  return "off";
}

const DAY_NAMES = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];

/** The ET wall clock, which is the only clock this app schedules against. */
export function etClock(now: Date): EtClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
    month: "numeric",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(now);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  // Intl writes midnight as 24 under hour12: false, which would sort a 00:05
  // run into tomorrow's late evening if it were taken literally.
  const hour = Number(get("hour")) % 24;

  return {
    day: DAY_NAMES.indexOf(get("weekday")),
    hour,
    minute: Number(get("minute")),
    month: Number(get("month")),
  };
}

/**
 * When each email is meant to leave, in ET.
 *
 * `until` is only for the alarm. Every other send is due from its time until
 * the end of its day, because an email that missed 8am is still worth having
 * at noon. The alarm is the opposite: it exists for the 75 minutes before the
 * 1pm lock, and one arriving at 8pm about a slot nobody can change any more
 * is the exact noise it was built to avoid.
 */
function sendTimes(days: SendDays): { id: SendId; day: number; at: number; until?: number }[] {
  return [
    { id: "faab", day: days.faabDay ?? 2, at: 8 * 60 },
    // Tuesday evening, not Wednesday morning. Every league except the
    // guillotine one processes its claims at 3am Wednesday, so a Wednesday 8am
    // email about what to claim arrived five hours after the claims ran. 7pm
    // is after the day's practice reports and after Jingles posts his waiver
    // article, and still eight hours clear of the run.
    { id: "midweek", day: 2, at: 19 * 60 },
    // Twice, deliberately. The lineup email waits for waivers to process and
    // for his rankings to be published, and on a week where either is late
    // there has to be a second chance at it rather than no email at all. The
    // send log makes the Thursday slot a no-op when Wednesday went out.
    { id: "thursday", day: days.thursdayDay ?? WED, at: 8 * 60 },
    { id: "thursday", day: THU, at: 8 * 60 },
    { id: "sunday", day: SUN, at: 9 * 60 },
    // After the 11:30 inactive reports and well before the 13:00 lock. This one
    // is allowed to send nothing at all, which is its normal outcome.
    { id: "alarm", day: SUN, at: 11 * 60 + 45, until: 16 * 60 },
  ];
}

function jobTimes(): { id: TimedJobId; day: number; at: number }[] {
  return [
    { id: "refresh-all-early", day: WED, at: 3 * 60 + 30 },
    { id: "refresh-all-late", day: WED, at: 5 * 60 + 35 },
  ];
}

function inWindow(minutes: number, w: { from: number; to: number }): boolean {
  return minutes >= w.from && minutes < w.to;
}

export function tempoFor(now: Date, days: SendDays = {}): Tempo {
  const et = etClock(now);
  const season = seasonFor(et.month);
  const minutes = et.hour * 60 + et.minute;

  const live =
    season === "full" &&
    ((et.day === SUN && inWindow(minutes, SUNDAY_LIVE)) ||
      ((et.day === THU || et.day === MON) && inWindow(minutes, NIGHT_LIVE)));

  let tier: PulseTier = "idle";
  let window = "nothing due";

  if (live) {
    tier = "live";
    window = et.day === SUN ? "Sunday gameday" : `${DAY_NAMES[et.day]} night`;
  } else if (et.hour === OVERNIGHT_HOUR) {
    tier = "overnight";
    window = "overnight pull";
  } else if (season !== "off" && et.hour >= DAY_START_HOUR && et.hour <= DAY_END_HOUR) {
    tier = "hourly";
    window = "hourly top-up";
  }

  // A send is due from its own time until the end of its day. The send log is
  // what stops a repeat, so a run that misses 8am still catches the email at
  // 9am rather than skipping the week, which is the failure the Vercel cron
  // had no answer for.
  const dueSends =
    season === "full"
      ? sendTimes(days)
          .filter(
            (s) =>
              s.day === et.day && minutes >= s.at && (s.until === undefined || minutes < s.until),
          )
          .map((s) => s.id)
      : [];

  // League activity still matters outside the email season. Keeping jobs due
  // all day lets a delayed heartbeat catch up after waivers have processed.
  const dueJobs = jobTimes()
    .filter((j) => j.day === et.day && minutes >= j.at)
    .map((j) => j.id);

  return { tier, window, et, dueSends, dueJobs };
}
