import "server-only";
import { sendEmail } from "@/lib/guillotine/send";
import { alreadySent, clearSent, recordSent, withSendLock } from "@/lib/email/sent-log";
import { etClock } from "@/lib/pulse/tempo";
import { getPicksCore, refreshPicks } from "./report";
import { refreshShop } from "./shop-store";
import { saveDecisions } from "./decisions-store";
import { type DecisionRecord, toDecision } from "./learning/replay";
import { buildPicksEmail, buildTodayEmail, todayPush, type TodayLeague } from "./email";
import { toIssued, toIssuedUpdate } from "./issued";
import { loadIssued } from "./issued-store";
import { issueAndSend, loadIntent, recoverPending } from "./issue-send";
import { weekOf } from "./parse";
import { GAME_DAY_SLOTS, type GameDaySlot, type LateSlot, diffUpdate, lateOnly, onDate } from "./update";
import { redis } from "@/lib/redis/client";
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

/**
 * Each composed sport's decision for this send, NFL first (college saw NFL's
 * stakes as reserved). Built from the reports already in hand: no extra reads
 * before the send.
 */
function decisionsFor(leagues: TodayLeague[], meta: { at: string; sendKey: string; date: string }): DecisionRecord[] {
  const finalsKnown = leagues.flatMap(({ r }) => r.sizing.finals);
  return leagues.flatMap(({ r }, order) => {
    const d = toDecision(r, { ...meta, order, finalsKnown, onSendDate: (k) => !!k && etDate(new Date(k)) === meta.date });
    return d ? [d] : [];
  });
}

/** The decision write (with the day marker), bounded so it can never hold up a ready email. Resolves true when saved. */
function saveDecisionsBounded(ds: DecisionRecord[], day: { season: number; sendKey: string; at: string }, ms = 4000): Promise<boolean> {
  return Promise.race([
    saveDecisions(ds, day).then(() => true, () => false),
    new Promise<boolean>((done) => setTimeout(() => done(false), ms)),
  ]);
}

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
    // The 9am email has gone (or the day was logged quiet): anything that
    // qualifies after it goes out as a late add of its own.
    if (await alreadySent(id, season, day)) return runLateAdds({ now, date, season, day, slot, appUrl });
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
  const { leagues, notReady, shopNotes } = await composeToday(now, date, clock.day, !dry);
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
  // What each sport decided over, for the sizing replay: recorded on quiet
  // days too, since a different sizing might have fit a bet the limits refused.
  const decisions = test ? [] : decisionsFor(leagues, { at: now.toISOString(), sendKey: idem, date });
  const dayMark = { season: leagues[0]?.r.season ?? Number(season), sendKey: idem, at: now.toISOString() };
  if (!matters) {
    if (!test) {
      // Nothing is waiting on a quiet day, so its decision is required: a
      // missing one would be an undetectable hole in the sizing replay. Retry
      // on the next pulse rather than mark the day handled.
      if (!(await saveDecisionsBounded(decisions, dayMark))) return Response.json({ ok: true, skipped: true, reason: "No bets today, but couldn't record today's sizing decision; retrying next pulse." });
      await recordSent(id, season, day, { sentAt: now.toISOString(), subject: `no bets today, not sent${notReady.length ? ` (${notReady.join(", ")})` : ""}` });
    }
    return Response.json({ ok: true, skipped: true, reason: "No bets today and nothing sent is off.", shop: shopNotes });
  }

  const subject = `${test ? "[Test] " : ""}${email.subject}`;
  const meta = { issuedAt: now.toISOString(), subject };
  const records = test ? [] : leagues.filter((l) => l.diff.added.length || l.diff.addedTotals.length).map((l) => toIssuedUpdate(l.r, l.diff, slot, meta));
  // Before the send, so a retry from the claimed intent keeps this decision.
  // Bounded, and a failure costs the replay this day (the staked record has
  // no decision, so the sample restarts after it), never the bets.
  if (!test) await saveDecisionsBounded(decisions, dayMark);
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
  return Response.json({ ok: true, sent: out.sent, subject, date, season, issued: out.issued, pushed: pushed.pushed, pushNote: pushed.reason, shop: shopNotes });
}

/**
 * Each sport's report and its diff against what was already issued, for
 * games on `date`. NFL first; college is allocated with NFL's new stakes
 * reserved, so the two together stay inside the cross-sport cap. A league
 * that failed to load, has stale or missing quotes, or whose boards are not
 * up yet is listed in notReady.
 */
async function composeToday(now: Date, date: string, weekday: number, shop: boolean): Promise<{ leagues: TodayLeague[]; notReady: string[]; shopNotes: string[] }> {
  const leagues: TodayLeague[] = [];
  const notReady: string[] = [];
  const shopNotes: string[] = [];
  let reserved = 0;
  for (const league of ["nfl", "cfb"] as const) {
    const name = league === "nfl" ? "NFL" : "college";
    const playsToday = (PLAY_DAYS[league] as readonly number[]).includes(weekday);
    // Shop Jack's other books before the quotes are re-read, so a -112 at
    // DraftKings can size at FanDuel's or Fanatics' -110 (2 credits a read).
    if (playsToday && shop) {
      const core = (await getPicksCore(league).catch(() => null))?.value;
      shopNotes.push(`${name}: ${await refreshShop(league, core ? [...new Set(core.rows.flatMap((x) => [x.home, x.away]))] : [], now)}`);
    }
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
  return { leagues, notReady, shopNotes };
}

// ------------------------------------------------------------- late adds
//
// Jack, 2026-10-31: a play that qualifies after the 9am email (a line posts
// late, a board updates, the number moves into range) goes out on its own,
// not "with the next email", which is tomorrow and after the game. The diff
// against the issued ledger is what makes this safe to repeat: a game issued
// by any earlier send this week is never added again.

/** How often a day already handled looks for late adds (each look reads both boards). */
const LATE_CHECK_SECONDS = 30 * 60;
/** Late slots per day: gsat2 .. gsat9. */
const LATE_SLOTS = [2, 3, 4, 5, 6, 7, 8, 9];

const lateCheckKey = (date: string) => `picks:v2:late-check:${date}`;

/** True while today's late-add look is resting (the pulse skips the send without rebuilding anything). */
export async function lateCheckResting(now = new Date()): Promise<boolean> {
  return ((await redis.exists(lateCheckKey(todayLogKey(now).date)).catch(() => 0)) ?? 0) > 0;
}

async function runLateAdds(input: { now: Date; date: string; season: string; day: number; slot: GameDaySlot; appUrl: string }): Promise<Response> {
  const { now, date, season, day, slot, appUrl } = input;
  // A late add that never confirmed is finished before anything new is decided.
  for (const n of LATE_SLOTS) {
    const rec = await recoverPending({ logId: "picks-day-late", season, week: day * 10 + n, idempotencyKey: `picks-day:${date}:late${n}` });
    if (rec) return Response.json({ ok: rec.outcome !== "failed", sent: rec.sent, reason: `recovered earlier late add: ${rec.outcome}`, issued: rec.issued, error: rec.error });
  }
  if ((await redis.set(lateCheckKey(date), now.toISOString(), { nx: true, ex: LATE_CHECK_SECONDS })) !== "OK") {
    return Response.json({ ok: true, skipped: true, reason: "Today's email went out; late adds checked within the last 30 minutes." });
  }
  let n: number | undefined;
  for (const k of LATE_SLOTS) if (!(await loadIntent(`picks-day:${date}:late${k}`))) { n = k; break; }
  if (n === undefined) return Response.json({ ok: true, skipped: true, reason: "Today's late-add slots are used up." });

  // No book shopping here: it spends credits on every look, and most looks find nothing.
  const composed = await composeToday(now, date, etClock(now).day, false);
  // A sport whose quotes are missing or stale adds nothing: a late add is judged at the line it shows.
  const fresh = (l: TodayLeague) => !l.r.reference.stale && !!l.r.reference.fetchedAt;
  const leagues = composed.leagues.filter(fresh).map((l) => ({ ...l, diff: lateOnly(l.diff, now) })).filter((l) => l.diff.added.length || l.diff.addedTotals.length);
  if (!leagues.length) return Response.json({ ok: true, skipped: true, reason: "Today's email went out; no late adds." });

  const idem = `picks-day:${date}:late${n}`;
  const lateSlot: LateSlot = `${slot}${n}`;
  const email = buildTodayEmail({ date, leagues, appUrl, generatedAt: now.toISOString(), late: true });
  const meta = { issuedAt: now.toISOString(), subject: email.subject };
  const records = leagues.map((l) => toIssuedUpdate(l.r, l.diff, lateSlot, meta));
  await saveDecisionsBounded(decisionsFor(leagues, { at: now.toISOString(), sendKey: idem, date }), { season: leagues[0].r.season, sendKey: idem, at: now.toISOString() });
  const out = await issueAndSend({ logId: "picks-day-late", season, week: day * 10 + n, subject: email.subject, html: email.html, idempotencyKey: idem, records });
  if (out.outcome === "failed") return Response.json({ ok: false, error: out.error, issued: out.issued }, { status: 500 });
  const pushed = out.sent ? await push(todayPush({ date, leagues, appUrl, late: true })) : { pushed: false, reason: "email not sent" };
  return Response.json({ ok: true, sent: out.sent, subject: email.subject, date, season, issued: out.issued, pushed: pushed.pushed, pushNote: pushed.reason });
}
