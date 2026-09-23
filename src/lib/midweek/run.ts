import "server-only";
import { getMyLeagues } from "@/lib/league/discover";
import { buildWaivers, type WaiverContext } from "@/lib/waivers/build";
import { sendEmail } from "@/lib/guillotine/send";
import { alreadySent, clearSent, recordSent, withSendLock } from "@/lib/email/sent-log";
import { midweekSubject, renderMidweekEmail } from "./email";

// The Wednesday job.
//
// Tuesday evening, ahead of the 3am run.
//
// Every league here processes its claims at 3am Wednesday, and this email used
// to go out at 8am Wednesday, five hours after the thing it was advising on.
// Evening also means it lands after the day's practice reports and after
// Jingles publishes his waiver article, which are the two things most likely
// to change the answer. The guillotine league is pointed at rather than
// re-explained: its own guide went out this morning with the pacing in it.

const APP_URL = () => process.env.NEXT_PUBLIC_APP_URL ?? "https://fantasy-hub-tan.vercel.app";

export interface MidweekOptions {
  dry?: boolean;
  resend?: boolean;
  test?: boolean;
}

/** The job, behind its lock. See withSendLock: two callers, one send. */
export function runMidweekEmail(options: MidweekOptions = {}): Promise<Response> {
  // A preview is not a send, so it never waits on one.
  if (options?.dry) return runMidweekEmailLocked(options);
  return withSendLock("midweek", () => runMidweekEmailLocked(options));
}

async function runMidweekEmailLocked(options: MidweekOptions = {}): Promise<Response> {
  const { dry = false, resend = false, test = false } = options;

  const all = await getMyLeagues();
  const sleeper = all.filter((l) => l.source !== "manual");
  const guillotineLeague = sleeper.find((l) => l.type === "guillotine") ?? null;

  // The guillotine league is excluded from the waiver run: its wire is the
  // chopped roster, it has its own advisor, and its claim prices come from a
  // market model rather than from a ranking list.
  const waiverLeagues = sleeper.filter((l) => l.type !== "guillotine");

  const results = await Promise.allSettled(
    waiverLeagues.map((l) => buildWaivers(l.id)),
  );
  const leagues: WaiverContext[] = results
    .filter((r): r is PromiseFulfilledResult<WaiverContext> => r.status === "fulfilled")
    .map((r) => r.value);

  const week = leagues.find((l) => l.week != null)?.week ?? null;
  const season = String(sleeper[0]?.season ?? "");

  if (week === null || !season) {
    return Response.json({
      ok: false,
      error: "Could not tell which week this is, so nothing was sent.",
    });
  }

  const input = {
    leagues,
    guillotine: guillotineLeague
      ? { leagueId: guillotineLeague.id, name: guillotineLeague.name }
      : null,
    week,
    generatedAt: new Date().toISOString(),
    appUrl: APP_URL(),
  };

  const subject = `${test ? "[Test] " : ""}${midweekSubject(input)}`;
  const html = renderMidweekEmail(input);

  if (dry) {
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  }

  const previous = await alreadySent("midweek", season, week);
  if (previous && !resend) {
    return Response.json({
      ok: true,
      skipped: true,
      reason: `Week ${week} already went out at ${previous.sentAt}. Add ?resend=1 to send it again.`,
    });
  }
  if (previous && resend) await clearSent("midweek", season, week);

  const result = await sendEmail(subject, html, `midweek:${season}:w${week}${resend ? `:again-${Date.now()}` : ""}`);
  if (!result.sent) {
    return Response.json({ ok: false, error: result.reason ?? "Not sent." }, { status: 500 });
  }

  await recordSent("midweek", season, week, {
    sentAt: new Date().toISOString(),
    subject,
    messageId: result.id,
  });

  return Response.json({
    ok: true,
    sent: true,
    subject,
    week,
    leagues: leagues.length,
    failed: results.filter((r) => r.status === "rejected").length,
  });
}
