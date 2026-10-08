import "server-only";
import { sendEmail } from "@/lib/guillotine/send";
import { alreadySent, clearSent, recordSent, withSendLock } from "@/lib/email/sent-log";
import { etClock } from "@/lib/pulse/tempo";
import { refreshPicks } from "./report";
import { buildPicksEmail, buildPicksUpdate } from "./email";
import { toIssued, toIssuedUpdate } from "./issued";
import { loadIssued } from "./issued-store";
import { issueAndSend } from "./issue-send";
import { weekOf } from "./parse";
import { diffUpdate, updateMatters } from "./update";

// The picks emails: the Tuesday card, and the Saturday college update.
//
// Tuesday evening, as soon as every board is up. Measured on one week (Oct
// 6, ET): David's college board 1:30am, Sam's boards 8:47am, David's NFL
// board 4:18pm, PEM's card 4:37pm. The lines then move toward the models
// quickly (by Wednesday night the NFL line had already moved 0.60 points
// toward Sam, of 0.69 by kickoff), and college plays a Tuesday-night game
// most weeks from Week 6. On Tuesday the send waits for all four boards; the
// Wednesday and Thursday 9am slots are fallbacks that only need the NFL
// boards. Sending writes the issued record from the very selection the email
// rendered (plays, lines, straight-up method, rule and its evidence), so the
// live record grades what was sent, at the lines it was sent at.

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
  // NFL first; college is allocated with NFL's card already reserved, so the
  // two cards together stay inside the cross-sport outstanding cap.
  const nfl = await refreshPicks("nfl").catch(() => null);
  const nflCard = (nfl?.board ?? []).reduce((t, g) => t + (g.stake ?? 0), 0) + (nfl?.totals.board ?? []).reduce((t, g) => t + (g.stake ?? 0), 0);
  const cfb = await refreshPicks("cfb", { reserved: nflCard }).catch(() => null);
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
  // Tuesday's send waits for the college boards too; the fallbacks don't.
  if (!dry && etClock(new Date()).day === 2 && (!cfb || !cfb.boardUpdated.sam || !cfb.boardUpdated.david)) {
    return Response.json({ ok: true, skipped: true, reason: "Waiting for the college boards before Tuesday's card." });
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
  if (resend || test) {
    // A resend or test repeats the email only; what was issued stays as it was.
    if (previous && resend) await clearSent("picks", season, week);
    const r = await sendEmail(subject, html, `picks:${season}:w${week}:${test ? "test" : "again"}-${Date.now()}`);
    if (!r.sent) return Response.json({ ok: false, error: r.reason ?? "Not sent." }, { status: 500 });
    if (resend) await recordSent("picks", season, week, { sentAt: new Date().toISOString(), subject, messageId: r.id });
    return Response.json({ ok: true, sent: true, subject, week, season, issued: ["test or resend: nothing issued"] });
  }

  const meta = { issuedAt: new Date().toISOString(), subject };
  const records = [
    ...(email.selections.nfl ? [{ ...toIssued(nfl, email.selections.nfl, meta), slot: "tue" as const }] : []),
    ...(cfb?.week && email.selections.cfb ? [{ ...toIssued(cfb, email.selections.cfb, meta), slot: "tue" as const }] : []),
  ];
  const out = await issueAndSend({ logId: "picks", season, week, subject, html, idempotencyKey: `picks:${season}:w${week}`, records });
  if (out.outcome === "failed") return Response.json({ ok: false, error: out.error, issued: out.issued }, { status: 500 });
  return Response.json({ ok: true, sent: out.sent, skipped: !out.sent, reason: out.outcome, subject, week, season, issued: out.issued });
}

// ---------------------------------------------------------- Saturday update

/** Season and NFL week for a moment, by the calendar (the sent log keys on the NFL week). */
function nflWeekNow(now = new Date()): { season: string; week: number } {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now);
  const season = now.getUTCMonth() <= 1 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
  return { season: String(season), week: weekOf("nfl", day) };
}

/**
 * The Saturday college update: Tuesday's college plays re-checked at the
 * current line, plus any game that qualifies now and was not sent. It sends
 * only when something is new or off; a quiet Saturday is logged and silent.
 */
export function runPicksSaturday(options: PicksEmailOptions = {}): Promise<Response> {
  if (options.dry) return runSaturday(options);
  return withSendLock("picks-sat", () => runSaturday(options));
}

async function runSaturday({ dry = false, resend = false, test = false }: PicksEmailOptions): Promise<Response> {
  const { season, week } = nflWeekNow();
  const previous = await alreadySent("picks-sat", season, week);
  if (previous && !resend && !dry) {
    return Response.json({ ok: true, skipped: true, reason: `Already checked at ${previous.sentAt} (${previous.subject}).` });
  }
  const cfb = await refreshPicks("cfb").catch(() => null);
  if (!cfb?.week) return Response.json({ ok: false, error: "Couldn't read the college board." });
  const diff = diffUpdate(cfb, await loadIssued("cfb", cfb.season));
  const email = buildPicksUpdate({ r: cfb, diff, appUrl: APP_URL(), generatedAt: new Date().toISOString() });
  if (dry) return new Response(email.html, { headers: { "content-type": "text/html; charset=utf-8" } });

  if (!updateMatters(diff) && !resend) {
    // Logged so the pulse stops asking for the rest of the day.
    await recordSent("picks-sat", season, week, { sentAt: new Date().toISOString(), subject: "nothing changed, not sent" });
    return Response.json({ ok: true, skipped: true, reason: `Nothing new or off at the current line (${diff.stillOn.length} still on).` });
  }
  if (previous && resend) await clearSent("picks-sat", season, week);
  const subject = `${test ? "[Test] " : ""}${email.subject}`;
  const meta = { issuedAt: new Date().toISOString(), subject };
  const records = test ? [] : [toIssuedUpdate(cfb, diff, "sat", meta)];
  const out = await issueAndSend({
    logId: "picks-sat",
    season,
    week,
    subject,
    html: email.html,
    idempotencyKey: `picks-sat:${season}:w${week}${test || resend ? `:${Date.now()}` : ""}`,
    records,
  });
  if (out.outcome === "failed") return Response.json({ ok: false, error: out.error, issued: out.issued }, { status: 500 });
  return Response.json({ ok: true, sent: out.sent, subject, week, season, issued: out.issued });
}
