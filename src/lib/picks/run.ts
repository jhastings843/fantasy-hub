import "server-only";
import { sendEmail } from "@/lib/guillotine/send";
import { alreadySent, clearSent, recordSent, withSendLock } from "@/lib/email/sent-log";
import { etClock } from "@/lib/pulse/tempo";
import { refreshPicks } from "./report";
import { buildPicksEmail, buildTodayEmail, todayPush, type TodayLeague } from "./email";
import { toIssued, toIssuedUpdate } from "./issued";
import { loadIssued } from "./issued-store";
import { issueAndSend, loadIntent, recoverPending } from "./issue-send";
import { weekOf } from "./parse";
import { GAME_DAY_SLOTS, diffUpdate, onDate } from "./update";
import { RELEASE_MINUTE, etDate } from "./hold";
import { redisStore } from "./learning/store";
import { push } from "@/lib/notify/pushover";
import { harrisNow } from "./harris";
import { harrisSummary } from "./harris-track";

// The picks emails (Jack, 2026-10-08: stakes only on the day of the game):
//
//   runPicksEmail  the Tuesday update. What the app learned, rules, feeds,
//                  last week, early looks. NO stakes: its issued record holds
//                  only the straight-up list (for accuracy), never plays.
//   runPicksToday  9am ET every day: the bets for that day's games at that
//                  morning's line, issued with stakes, plus a Pushover alert.
//
// History of the Tuesday timing below; the plays it mentions now go out on
// game day instead (hold.ts).
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
  // two cards together stay inside the cross-sport caps. Held NFL plays are
  // left out: college already sees them as rivals (heldCandidates), and
  // reserving them too would count the same units twice.
  const nfl = await refreshPicks("nfl").catch(() => null);
  const released = (g: { stake?: number; held?: string }) => (g.held ? 0 : (g.stake ?? 0));
  const nflCard = (nfl?.board ?? []).reduce((t, g) => t + released(g), 0) + (nfl?.totals.board ?? []).reduce((t, g) => t + released(g), 0);
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

  const learning = await redisStore.journal(40).catch(() => []);
  const harris = await harrisNow().then((h) => (h ? harrisSummary(h) : undefined)).catch(() => undefined);
  const email = buildPicksEmail({ nfl, cfb, appUrl: APP_URL(), generatedAt: new Date().toISOString(), learning, harris });
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
  if (!resend && !test) {
    const rec = await recoverPending({ logId: "picks", season, week, idempotencyKey: `picks:${season}:w${week}` });
    if (rec) return Response.json({ ok: rec.outcome !== "failed", sent: rec.sent, reason: `recovered earlier send: ${rec.outcome}`, issued: rec.issued, error: rec.error });
  }
  if (resend || test) {
    // A resend or test repeats the email only; what was issued stays as it was.
    if (previous && resend) await clearSent("picks", season, week);
    const r = await sendEmail(subject, html, `picks:${season}:w${week}:${test ? "test" : "again"}-${Date.now()}`);
    if (!r.sent) return Response.json({ ok: false, error: r.reason ?? "Not sent." }, { status: 500 });
    if (resend) await recordSent("picks", season, week, { sentAt: new Date().toISOString(), subject, messageId: r.id });
    return Response.json({ ok: true, sent: true, subject, week, season, issued: ["test or resend: nothing issued"] });
  }

  // No stakes on a day without games: the record keeps only the straight-up
  // list the email showed. Plays and totals go out on their game day.
  const meta = { issuedAt: new Date().toISOString(), subject };
  const noBets = <S extends { plays: unknown[]; totals: unknown[] }>(s: S): S => ({ ...s, plays: [], shownPlays: 0, totals: [], shownTotals: 0 });
  const records = [
    ...(email.selections.nfl ? [{ ...toIssued(nfl, noBets(email.selections.nfl), meta), slot: "tue" as const }] : []),
    ...(cfb?.week && email.selections.cfb ? [{ ...toIssued(cfb, noBets(email.selections.cfb), meta), slot: "tue" as const }] : []),
  ];
  const out = await issueAndSend({ logId: "picks", season, week, subject, html, idempotencyKey: `picks:${season}:w${week}`, records });
  if (out.outcome === "failed") return Response.json({ ok: false, error: out.error, issued: out.issued }, { status: 500 });
  return Response.json({ ok: true, sent: out.sent, skipped: !out.sent, reason: out.outcome, subject, week, season, issued: out.issued });
}

// ------------------------------------------------------------- today's bets

/** Season and NFL week for a moment, by the calendar (the sent log keys on the NFL week). */
function nflWeekNow(now = new Date()): { season: string; week: number } {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now);
  const season = now.getUTCMonth() <= 1 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
  return { season: String(season), week: weekOf("nfl", day) };
}

/** The sent-log key for a day's bets email: one per ET date (YYYYMMDD in the week field). */
export function todayLogKey(now = new Date()): { id: "picks-day"; season: string; day: number; date: string } {
  const date = etDate(now);
  return { id: "picks-day", season: nflWeekNow(now).season, day: Number(date.replaceAll("-", "")), date };
}

/**
 * 9am ET every day. Sends only when today has a bet, or a sent bet for today
 * is now off; otherwise it logs a quiet day so the pulse stops asking. Waits
 * for a league's boards when it plays today, until an hour before its first
 * kickoff.
 */
export function runPicksToday(options: PicksEmailOptions = {}): Promise<Response> {
  if (options.dry) return runToday(options);
  return withSendLock("picks-day", () => runToday(options));
}

/** Before this (ET, minutes) a day without a ready league keeps retrying instead of logging a quiet day. */
const READY_DEADLINE = 17 * 60;
/** Weekdays (0 = Sunday) each sport normally plays; readiness is only required of a sport that plays today. */
const PLAY_DAYS = { nfl: [0, 1, 4, 6], cfb: [2, 3, 4, 5, 6] } as const;

async function runToday({ dry = false, resend = false, test = false }: PicksEmailOptions): Promise<Response> {
  const now = new Date();
  const { id, season, day, date } = todayLogKey(now);
  const clock = etClock(now);
  const minutes = clock.hour * 60 + clock.minute;
  const slot = GAME_DAY_SLOTS[clock.day];
  const idem = `picks-day:${date}`;
  const appUrl = APP_URL();

  // A resend repeats the email that went out, exactly; it never decides
  // anything new, so it can never email a stake the ledger doesn't hold.
  if (resend && !dry) {
    const intent = await loadIntent(idem);
    if (!intent) return Response.json({ ok: false, error: "Nothing went out today to resend." });
    // An unconfirmed send is finished by the scheduled run's recovery, never by a resend.
    if (!(await alreadySent(id, season, day))) return Response.json({ ok: false, error: "Today's send hasn't confirmed yet; the next scheduled run will finish it." });
    const r = await sendEmail(intent.subject, intent.html, `${idem}:again-${Date.now()}`);
    return r.sent ? Response.json({ ok: true, sent: true, subject: intent.subject, issued: ["resend: nothing new issued"] }) : Response.json({ ok: false, error: r.reason ?? "Not sent." }, { status: 500 });
  }
  // Nothing is released before 9am, so an early call must not close the day.
  if (!dry && minutes < RELEASE_MINUTE) return Response.json({ ok: true, skipped: true, reason: "Before 9am ET: today's games aren't released yet." });
  // A test never touches the production log or ledger.
  const logId = test ? `${id}-test` : id;
  if (!dry && !test) {
    const previous = await alreadySent(id, season, day);
    if (previous) return Response.json({ ok: true, skipped: true, reason: `Already handled at ${previous.sentAt} (${previous.subject}).` });
    const rec = await recoverPending({ logId: id, season, week: day, idempotencyKey: idem });
    if (rec) {
      // The recovered card still gets its push; its details are in the email.
      const intent = rec.sent ? await loadIntent(idem) : null;
      const pushed = intent ? await push({ title: intent.subject, message: "Today's bets email went out after a retry. Details in the email and on the page.", url: `${appUrl}/picks`, urlTitle: "Open Picks" }) : { pushed: false };
      return Response.json({ ok: rec.outcome !== "failed", sent: rec.sent, reason: `recovered earlier send: ${rec.outcome}`, issued: rec.issued, error: rec.error, pushed: pushed.pushed });
    }
  }

  // NFL first; college is allocated with NFL's bets today reserved, so the
  // two together stay inside the cross-sport outstanding cap. A league that
  // failed to load, has stale or missing quotes, or whose boards are not up
  // yet is "not ready": until 5pm ET the run retries rather than calling the
  // day quiet (a Tuesday-morning college game appears only once the new
  // week's boards are up).
  const leagues: TodayLeague[] = [];
  const notReady: string[] = [];
  let reserved = 0;
  for (const league of ["nfl", "cfb"] as const) {
    const name = league === "nfl" ? "NFL" : "college";
    const playsToday = (PLAY_DAYS[league] as readonly number[]).includes(clock.day);
    const r = await refreshPicks(league, league === "cfb" ? { reserved } : undefined).catch(() => null);
    if (!r?.week) {
      if (playsToday) notReady.push(`${name} board unreadable`);
      continue;
    }
    if (playsToday && (r.reference.stale || !r.reference.fetchedAt || (r.reference.games > 0 && r.reference.priced === 0))) notReady.push(`${name} lines missing or stale`);
    else if (playsToday && (!r.boardUpdated.sam || !r.boardUpdated.david)) notReady.push(`${name} model boards not up`);
    const diff = onDate(diffUpdate(r, await loadIssued(league, r.season), now), date);
    reserved += diff.added.reduce((s, g) => s + (g.stake ?? 0), 0) + diff.addedTotals.reduce((s, g) => s + (g.stake ?? 0), 0);
    leagues.push({ r, diff });
  }
  // Waiting must never cost a ready sport its bets: give up waiting 90
  // minutes before today's first kickoff on any loaded board, or at 5pm.
  const firstKick = Math.min(
    ...leagues.flatMap(({ r }) => r.board.flatMap((g) => (g.ref?.kickoff && etDate(new Date(g.ref.kickoff)) === date ? [new Date(g.ref.kickoff).getTime()] : []))),
  );
  const deadline = Math.min(now.getTime() + (READY_DEADLINE - minutes) * 60000, firstKick - 90 * 60000);
  if (notReady.length && now.getTime() < deadline && !dry) {
    return Response.json({ ok: true, skipped: true, reason: `Waiting before today's bets: ${notReady.join(", ")}.` });
  }

  const matters = leagues.some(({ diff: d }) => d.added.length || d.addedTotals.length || d.off.length || d.totalsOff.length);
  const email = buildTodayEmail({ date, leagues, appUrl, generatedAt: now.toISOString() });
  if (dry) return new Response(email.html, { headers: { "content-type": "text/html; charset=utf-8" } });
  if (!matters) {
    if (!test) await recordSent(id, season, day, { sentAt: now.toISOString(), subject: `no bets today, not sent${notReady.length ? ` (${notReady.join(", ")})` : ""}` });
    return Response.json({ ok: true, skipped: true, reason: "No bets today and nothing sent is off." });
  }

  const subject = `${test ? "[Test] " : ""}${email.subject}`;
  const meta = { issuedAt: now.toISOString(), subject };
  const records = test ? [] : leagues.filter((l) => l.diff.added.length || l.diff.addedTotals.length).map((l) => toIssuedUpdate(l.r, l.diff, slot, meta));
  const out = await issueAndSend({
    logId,
    season,
    week: day,
    subject,
    html: email.html,
    idempotencyKey: test ? `${idem}:test-${Date.now()}` : idem,
    records,
  });
  if (out.outcome === "failed") return Response.json({ ok: false, error: out.error, issued: out.issued }, { status: 500 });
  const pushed = out.sent ? await push(todayPush({ date, leagues, appUrl })) : { pushed: false, reason: "email not sent" };
  return Response.json({ ok: true, sent: out.sent, subject, date, season, issued: out.issued, pushed: pushed.pushed, pushNote: pushed.reason });
}
