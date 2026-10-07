import "server-only";
import { sendEmail } from "@/lib/guillotine/send";
import { alreadySent, clearSent, recordSent, withSendLock } from "@/lib/email/sent-log";
import { freezeSnapshot, refreshPicks } from "./report";
import { picksSubject, renderPicksEmail } from "./email";

// The Wednesday picks email.
//
// Wednesday morning because both sites post their boards on Tuesday, and by
// Wednesday the early line movement has mostly happened. Sending freezes the
// week's board, so the live record grades the plays at the lines they were
// sent at rather than wherever the number drifted to by Sunday.

const APP_URL = () => process.env.NEXT_PUBLIC_APP_URL ?? "https://fantasy-hub-tan.vercel.app";

export interface PicksEmailOptions {
  dry?: boolean;
  resend?: boolean;
  test?: boolean;
}

export function runPicksEmail(options: PicksEmailOptions = {}): Promise<Response> {
  if (options.dry) return runLocked(options);
  return withSendLock("picks", () => runLocked(options));
}

async function runLocked({ dry = false, resend = false, test = false }: PicksEmailOptions): Promise<Response> {
  const [nfl, cfb] = await Promise.all([refreshPicks("nfl").catch(() => null), refreshPicks("cfb").catch(() => null)]);
  const week = nfl?.week ?? null;
  const season = String(nfl?.season ?? cfb?.season ?? "");
  if (!nfl || week === null || !season) {
    return Response.json({ ok: false, error: "Couldn't read this week's NFL board, so nothing was sent." });
  }
  // A board still showing last week means Sam and David haven't posted yet;
  // waiting for the next run beats sending last week's plays.
  if (!nfl.boardUpdated.sam || !nfl.boardUpdated.david) {
    return Response.json({ ok: true, skipped: true, reason: "One of the NFL boards isn't up for this week yet." });
  }

  const html = renderPicksEmail({ nfl, cfb, appUrl: APP_URL(), generatedAt: new Date().toISOString() });
  const subject = `${test ? "[Test] " : ""}${picksSubject(nfl, cfb)}`;
  if (dry) return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });

  const previous = await alreadySent("picks", season, week);
  if (previous && !resend) {
    return Response.json({
      ok: true,
      skipped: true,
      reason: `Week ${week} already went out at ${previous.sentAt}. Add ?resend=1 to send it again.`,
    });
  }
  if (previous && resend) await clearSent("picks", season, week);

  const result = await sendEmail(subject, html, `picks:${season}:w${week}${resend ? `:again-${Date.now()}` : ""}`);
  if (!result.sent) return Response.json({ ok: false, error: result.reason ?? "Not sent." }, { status: 500 });

  await recordSent("picks", season, week, { sentAt: new Date().toISOString(), subject, messageId: result.id });
  if (!test) {
    await freezeSnapshot("nfl", nfl.season, week);
    if (cfb?.week) await freezeSnapshot("cfb", cfb.season, cfb.week);
  }
  return Response.json({ ok: true, sent: true, subject, week, season });
}
