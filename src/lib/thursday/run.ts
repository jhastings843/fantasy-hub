import "server-only";
import { buildReports } from "@/lib/survivor/report";
import type { SurvivorReport } from "@/lib/survivor/types";
import { buildWeeklyLineups } from "@/lib/lineup/build";
import { sendEmail } from "@/lib/guillotine/send";
import { renderThursdayEmail, thursdaySubject, totalChanges } from "./email";
import { alreadySent, clearSent, recordSent, type ThursdaySendRecord } from "./sent-log";
import { recordBaseline, type Baselines } from "@/lib/survivor/baseline";
import { withSendLock } from "@/lib/email/sent-log";
import { getNflState } from "@/lib/sleeper/client";
import { getMyLeagues } from "@/lib/league/discover";
import { getWeekTransactions } from "@/lib/guillotine/league-state";
import { thisWeeksClaims, waiversAreSettled } from "@/lib/waivers/settled";
import { weeklyRankingsReady } from "@/lib/jingles/ingest";
import { refreshJinglesBeforeSend } from "@/lib/jingles/refresh";

// The Thursday job itself, kept out of route.ts.
//
// Next only allows a route file to export HTTP handlers and segment config, and
// the snapshot cron needs to call this directly rather than making an HTTP
// request back to the same deployment, so it lives here.

export const DAYS = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];
// Wednesday. The lineup email follows the 3am waiver run rather than waiting
// a day behind it, and it holds itself until waivers have processed and his
// rankings are up. Thursday is the fallback slot, in tempo.ts.
const DEFAULT_SEND_DAY = 3;

export function configuredSendDay(): number {
  const raw = (process.env.THURSDAY_EMAIL_DAY ?? "").trim();
  if (!raw) return DEFAULT_SEND_DAY;
  const asNumber = Number(raw);
  if (Number.isInteger(asNumber) && asNumber >= 0 && asNumber <= 6) return asNumber;
  const byName = DAYS.findIndex((d) => d.toLowerCase().startsWith(raw.slice(0, 3).toLowerCase()));
  return byName >= 0 ? byName : DEFAULT_SEND_DAY;
}

export function dayInNewYork(now: Date): number {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
  }).format(now);
  return DAYS.indexOf(weekday);
}

export type ThursdaySentThisWeek =
  | { week: number; season: string; sent: ThursdaySendRecord | null }
  | { error: string };

/**
 * Whether this week's email has gone out, for ?check=1.
 *
 * Readiness said "willSend true" all morning on the first unattended
 * Thursday and could not say whether it had, which is the only question
 * worth asking after 8am. The send log knows; this reads it by the current
 * Sleeper week. An error is reported as one rather than as "not sent",
 * because those call for different next steps.
 */
export async function sentThisWeek(): Promise<ThursdaySentThisWeek> {
  try {
    const state = await getNflState();
    const week = state.display_week ?? state.week;
    if (!week || !state.season) return { error: "Sleeper did not say which week it is." };
    return { week, season: state.season, sent: await alreadySent(state.season, week) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * The whole job, separated from the request so the snapshot cron can call it
 * directly rather than making an HTTP request to itself.
 */
/** The job, behind its lock. See withSendLock: two callers, one send. */
export function runThursdayEmail(options: {
  force?: boolean;
  dry?: boolean;
  resend?: boolean;
  /**
   * Marks the subject so a preview is distinguishable in the inbox.
   *
   * Worth having rather than sending an identical subject twice: the send log
   * makes a real week unrepeatable, so every look at a change to this email is
   * a resend of a week that already went out, and three lines reading "Week 1:
   * LAC over ARI" with different contents is the confusing outcome.
   */
  test?: boolean;
} = {}): Promise<Response> {
  // A preview is not a send, so it never waits on one.
  if (options?.dry) return runThursdayEmailLocked(options);
  return withSendLock("thursday", () => runThursdayEmailLocked(options));
}

async function runThursdayEmailLocked(options: {
  force?: boolean;
  dry?: boolean;
  resend?: boolean;
  /**
   * Marks the subject so a preview is distinguishable in the inbox.
   *
   * Worth having rather than sending an identical subject twice: the send log
   * makes a real week unrepeatable, so every look at a change to this email is
   * a resend of a week that already went out, and three lines reading "Week 1:
   * LAC over ARI" with different contents is the confusing outcome.
   */
  test?: boolean;
} = {}): Promise<Response> {
  const { force = false, dry = false, resend = false, test = false } = options;

  const sendDay = configuredSendDay();
  const today = dayInNewYork(new Date());
  if (!force && !dry && today !== sendDay) {
    return Response.json({
      ok: true,
      skipped: true,
      reason: `This goes out on ${DAYS[sendDay]} and today is ${DAYS[today]}. Add ?force=1 to send anyway.`,
    });
  }

  // His latest weekly list before the rankings gate and the lineups read it.
  // He revises it through the week, so this is not skipped when a list for
  // the week is already stored. Skipped for a dry run.
  const refreshed = dry ? null : await refreshJinglesBeforeSend();

  // The survivor half and the lineup half fail independently, and one being
  // down is not a reason to withhold the other. A Thursday with a pick and no
  // lineups is still worth sending, and the email says which half is missing.
  const [survivorResult, lineups] = await Promise.all([
    buildReports().then(
      (r) => ({ reports: r, error: null as string | null }),
      (e: unknown) => ({
        reports: [] as SurvivorReport[],
        error: e instanceof Error ? e.message : String(e),
      }),
    ),
    buildWeeklyLineups(),
  ]);

  const week = survivorResult.reports[0]?.week ?? lineups.week;
  const season = String(survivorResult.reports[0]?.season ?? lineups.season ?? "");

  if (week === null || !season) {
    return Response.json({
      ok: false,
      error: "Could not tell which week this is, so nothing was sent.",
    });
  }

  const input = {
    survivors: survivorResult.reports,
    survivorError: survivorResult.error,
    lineups,
    generatedAt: new Date().toISOString(),
    appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "https://fantasy-hub-tan.vercel.app",
  };

  const subject = `${test ? "[Test] " : ""}${thursdaySubject(input)}`;
  const html = renderThursdayEmail(input);

  if (dry) {
    return new Response(html, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  // Nothing goes out until waivers have run.
  //
  // This email's job is to say who starts, and before waivers process that
  // answer is provisional in both directions: a player it tells you to start
  // may be about to be claimed by somebody else, and the player who should
  // start may still be a bid you have not won. The rankings behind it are
  // ingested on their own schedule and can be as early as they like; the
  // SEND is what waits. A skip is not a failure, it is the job saying not yet,
  // and the pulse will try again later the same day.
  if (!force) {
    // His rankings, on the day this email prefers to go. The same rule the
    // waiver gate follows: ingest as early as it likes, send only when the
    // thing being sent is true. On the fallback day the rankings stop being a
    // blocker, because a lineup email built on last week's ranks still beats
    // no lineup email at all, and waivers alone decide.
    const onPreferredDay = today === sendDay;
    if (onPreferredDay && !(await weeklyRankingsReady(season, week))) {
      return Response.json({
        ok: true,
        skipped: true,
        waitingOnRankings: true,
        reason: `His week ${week} rankings are not published yet, so the lineup this email would print is last week's. Waiting for them.`,
      });
    }

    const leagues = (await getMyLeagues()).filter((l) => l.source !== "manual");
    const feeds = await Promise.all(
      leagues.map(async (l) => ({
        leagueId: l.id,
        name: l.name,
        // Sleeper files Wednesday's run under the week just played.
        transactions: thisWeeksClaims(
          await Promise.all(
            [week - 1, week].map((w) => getWeekTransactions(l.id, w).catch(() => [])),
          ),
          new Date(),
        ),
      })),
    );
    const settlement = waiversAreSettled(feeds, new Date());
    if (!settlement.settled) {
      return Response.json({
        ok: true,
        skipped: true,
        waitingOnWaivers: settlement.waitingOn,
        reason: settlement.reason,
      });
    }
  }

  const previous = await alreadySent(season, week);
  if (previous && !resend) {
    return Response.json({
      ok: true,
      skipped: true,
      reason: `Week ${week} already went out at ${previous.sentAt}. Add ?resend=1 to send it again.`,
      subject: previous.subject,
    });
  }
  if (previous && resend) await clearSent(season, week);

  const result = await sendEmail(subject, html, `thursday:${season}:w${week}${resend ? `:again-${Date.now()}` : ""}`);
  if (!result.sent) {
    return Response.json({ ok: false, error: result.reason ?? "Not sent." }, { status: 500 });
  }

  // The number Jack is now carrying around, so Sunday can tell him if it
  // moved. Written after the send, because a pick he was never told about is
  // not a baseline for anything.
  const baselines: Baselines = {};
  for (const report of survivorResult.reports) {
    baselines[report.poolId] = {
      pick: report.myPick,
      winProb: report.myPickCandidate?.winProb ?? null,
    };
  }
  await recordBaseline(season, week, baselines);

  await recordSent(season, week, {
    sentAt: new Date().toISOString(),
    subject,
    messageId: result.id,
  });

  return Response.json({
    ok: true,
    sent: true,
    refreshed,
    subject,
    week,
    season,
    changes: totalChanges(lineups),
    messageId: result.id,
  });
}
