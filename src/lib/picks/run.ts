import "server-only";
import { sendEmail } from "@/lib/guillotine/send";
import { alreadySent, clearSent, recordSent, withSendLock } from "@/lib/email/sent-log";
import { refreshPicks } from "./report";
import { buildPicksEmail } from "./email";
import { toIssued } from "./issued";
import { saveIssued } from "./issued-store";

// The Wednesday picks email.
//
// Wednesday morning because both sites post their boards on Tuesday, and by
// Wednesday the early line movement has mostly happened. Sending writes the
// issued record from the very selection the email rendered (plays, lines,
// straight-up method, rule and its evidence), so the live record grades what
// was sent, at the lines it was sent at.

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

  const email = buildPicksEmail({ nfl, cfb, appUrl: APP_URL(), generatedAt: new Date().toISOString() });
  const html = email.html;
  const subject = `${test ? "[Test] " : ""}${email.subject}`;
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
  const issued: string[] = [];
  if (!test) {
    // First record for a week wins; a resend does not rewrite what was issued.
    const meta = { issuedAt: new Date().toISOString(), emailId: result.id, subject };
    const save = async (label: string, rec: Parameters<typeof saveIssued>[0]) => {
      try {
        issued.push(`${label}: ${(await saveIssued(rec)) ? "recorded" : "already on file, kept"}`);
      } catch (e) {
        issued.push(`${label}: NOT RECORDED (${e instanceof Error ? e.message : String(e)})`);
      }
    };
    if (email.selections.nfl) await save("NFL", toIssued(nfl, email.selections.nfl, meta));
    if (cfb?.week && email.selections.cfb) await save("College", toIssued(cfb, email.selections.cfb, meta));
  }
  return Response.json({ ok: true, sent: true, subject, week, season, issued });
}
