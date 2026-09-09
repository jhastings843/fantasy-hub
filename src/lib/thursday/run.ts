import "server-only";
import { buildReport } from "@/lib/survivor/report";
import { buildWeeklyLineups } from "@/lib/lineup/build";
import { sendEmail } from "@/lib/guillotine/send";
import { renderThursdayEmail, thursdaySubject, totalChanges } from "./email";
import { alreadySent, clearSent, recordSent } from "./sent-log";

// The Thursday job itself, kept out of route.ts.
//
// Next only allows a route file to export HTTP handlers and segment config, and
// the snapshot cron needs to call this directly rather than making an HTTP
// request back to the same deployment, so it lives here.

export const DAYS = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];
const DEFAULT_SEND_DAY = 4; // Thursday, in America/New_York.

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

/**
 * The whole job, separated from the request so the snapshot cron can call it
 * directly rather than making an HTTP request to itself.
 */
export async function runThursdayEmail(options: {
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

  // The survivor half and the lineup half fail independently, and one being
  // down is not a reason to withhold the other. A Thursday with a pick and no
  // lineups is still worth sending, and the email says which half is missing.
  const [survivorResult, lineups] = await Promise.all([
    buildReport().then(
      (r) => ({ report: r, error: null as string | null }),
      (e: unknown) => ({
        report: null,
        error: e instanceof Error ? e.message : String(e),
      }),
    ),
    buildWeeklyLineups(),
  ]);

  const week = survivorResult.report?.week ?? lineups.week;
  const season = String(survivorResult.report?.season ?? lineups.season ?? "");

  if (week === null || !season) {
    return Response.json({
      ok: false,
      error: "Could not tell which week this is, so nothing was sent.",
    });
  }

  const input = {
    survivor: survivorResult.report,
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

  const result = await sendEmail(subject, html);
  if (!result.sent) {
    return Response.json({ ok: false, error: result.reason ?? "Not sent." }, { status: 500 });
  }

  await recordSent(season, week, {
    sentAt: new Date().toISOString(),
    subject,
    messageId: result.id,
  });

  return Response.json({
    ok: true,
    sent: true,
    subject,
    week,
    season,
    changes: totalChanges(lineups),
    messageId: result.id,
  });
}
