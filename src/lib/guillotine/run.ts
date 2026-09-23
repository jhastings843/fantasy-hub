import "server-only";
import { getMyLeagues } from "@/lib/league/discover";
import { buildWeeklyReport } from "./report";
import { emailSubject, renderEmail } from "./email";
import { sendEmail } from "./send";
import { alreadySent, clearSent, recordSent } from "./sent-log";
import { withSendLock } from "@/lib/email/sent-log";

// The Tuesday job itself, lifted out of the route.
//
// It lived in api/faab-email/route.ts while the Vercel cron was the only thing
// that called it. The pulse calls it now as well, from inside the same
// deployment, and a job that can only be started by making an HTTP request to
// yourself is a job that fails differently depending on who asked.
//
// The day gate stays here rather than moving into the caller, because the
// Vercel cron still fires daily and still needs to decide whether today is the
// day. The pulse knows the answer already and passes force.

export const DAYS = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];

/**
 * Tuesday by default: Monday night is played, the chop is known, the
 * commissioner has dropped the roster, and there is a full day before bids
 * process. Configurable because the one thing nobody can tell us is when the
 * roster actually drops, and the fix for that should be one variable.
 */
const DEFAULT_SEND_DAY = 2;

export function configuredSendDay(): number {
  const raw = (process.env.FAAB_EMAIL_DAY ?? "").trim();
  if (!raw) return DEFAULT_SEND_DAY;

  const asNumber = Number(raw);
  if (Number.isInteger(asNumber) && asNumber >= 0 && asNumber <= 6) return asNumber;

  const byName = DAYS.findIndex(
    (d) => d.toLowerCase().startsWith(raw.slice(0, 3).toLowerCase()),
  );
  return byName >= 0 ? byName : DEFAULT_SEND_DAY;
}

export function dayInNewYork(now: Date): number {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
  }).format(now);
  return DAYS.indexOf(weekday);
}

export interface FaabRunOptions {
  /**
   * Ignore the day gate AND send a report that has nothing to say.
   *
   * Only ever a human asking by hand: "prove the plumbing works" wants an
   * email either way. A schedule does not, which is what ignoreDayGate is for.
   */
  force?: boolean;
  /**
   * Ignore the day gate only.
   *
   * The pulse has already decided that today is the day, so re-deciding it
   * here would just be the same clock read twice. It must NOT inherit force's
   * other half: a no_projections week emailed and recorded on a Tuesday would
   * burn the week's send on an apology and lock out the real guide.
   */
  ignoreDayGate?: boolean;
  dry?: boolean;
  resend?: boolean;
  /** Only when the league is being named by hand. */
  leagueId?: string;
}

/** The job, behind its lock. See withSendLock: two callers, one send. */
export function runFaabEmail(options: FaabRunOptions = {}): Promise<Response> {
  // A preview is not a send, so it never waits on one.
  if (options?.dry) return runFaabEmailLocked(options);
  return withSendLock("faab", () => runFaabEmailLocked(options));
}

async function runFaabEmailLocked(options: FaabRunOptions = {}): Promise<Response> {
  const { force = false, ignoreDayGate = false, dry = false, resend = false } = options;

  const sendDay = configuredSendDay();
  const today = dayInNewYork(new Date());
  if (!force && !ignoreDayGate && !dry && today !== sendDay) {
    return Response.json({
      ok: true,
      skipped: true,
      reason: `The guide goes out on ${DAYS[sendDay]} and today is ${DAYS[today]}. Add ?force=1 to send anyway.`,
    });
  }

  // Found rather than configured: the league id changes every season, and a
  // hardcoded one would quietly send last season's report forever.
  let leagueId = (options.leagueId ?? "").trim();
  if (!leagueId) {
    try {
      const leagues = await getMyLeagues();
      const guillotine = leagues.filter((l) => l.type === "guillotine");
      if (guillotine.length === 0) {
        return Response.json({
          ok: true,
          skipped: true,
          reason: "No guillotine league on this account for the current season.",
        });
      }
      leagueId = guillotine[0].id;
    } catch (e) {
      return Response.json(
        { ok: false, error: `Could not list leagues: ${(e as Error).message}` },
        { status: 502 },
      );
    }
  }

  let report;
  try {
    report = await buildWeeklyReport(leagueId);
  } catch (e) {
    return Response.json(
      { ok: false, error: `Could not build the report: ${(e as Error).message}` },
      { status: 502 },
    );
  }

  // A report with nothing to say is not worth an email on a schedule. A forced
  // run is different: somebody asked by hand, usually to prove the plumbing
  // works, and silence is the wrong answer to that.
  if (report.state !== "ok" && !dry && !force) {
    return Response.json({
      ok: true,
      skipped: true,
      state: report.state,
      reason: report.message,
    });
  }

  const subject = emailSubject(report);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://fantasy-hub-tan.vercel.app";
  const html = renderEmail(report, appUrl);

  if (dry) {
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  }

  const season = report.league.season;

  if (resend) {
    await clearSent(leagueId, season, report.week);
  } else {
    const previous = await alreadySent(leagueId, season, report.week);
    if (previous) {
      return Response.json({
        ok: true,
        skipped: true,
        reason: `Week ${report.week} already went out at ${previous.sentAt} ("${previous.subject}"). Add ?resend=1 to send it again.`,
      });
    }
  }

  // The idempotency key is what makes two attempts at the same email one
  // email, and asking for a resend is saying that this one is not the same.
  // Resend holds a key for 24 hours and answers a repeat with 409, so without
  // the suffix the only send that resend=1 can ever produce is a refusal, which
  // is exactly what happened the first time the card changed after a Tuesday.
  const attempt = resend ? `:again-${Date.now()}` : "";
  const result = await sendEmail(
    subject,
    html,
    `faab:${leagueId}:${season}:w${report.week}${attempt}`,
  );

  if (result.sent) {
    await recordSent(leagueId, season, report.week, {
      sentAt: new Date().toISOString(),
      subject,
      messageId: result.id,
    });
  }

  return Response.json({
    ok: result.sent,
    sent: result.sent,
    league: report.league.name,
    week: report.week,
    subject,
    posture: report.posture.posture,
    spend: Math.round(report.card.maxPossibleSpend),
    ...(result.sent ? { id: result.id } : { error: result.reason }),
  });
}
