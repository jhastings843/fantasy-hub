import "server-only";
import { buildReports } from "@/lib/survivor/report";
import type { SurvivorReport } from "@/lib/survivor/types";
import { buildWeeklyLineups, type WeeklyLineups } from "@/lib/lineup/build";
import { sendEmail } from "@/lib/guillotine/send";
import { alreadySent, clearSent, recordSent, withSendLock } from "@/lib/email/sent-log";
import { readBaseline } from "@/lib/survivor/baseline";
import { lockAlarms, unseenAlarms, type PoolAlarmInput, type SlotAlarmInput } from "./alarm";
import { alarmSubject, renderLockAlarm, renderSundayBrief, sundaySubject } from "./email";

// The two Sunday jobs.
//
// Both are called by the pulse rather than by a schedule of their own, and
// both are gated by the shared send log, so calling either one twice is a
// no-op rather than a second copy.

const APP_URL = () => process.env.NEXT_PUBLIC_APP_URL ?? "https://fantasy-hub-tan.vercel.app";

/** A short stable tag for a set of alarm keys. Not cryptographic; it only has to differ when the set does. */
function digest(keys: string[]): string {
  let h = 5381;
  for (const ch of keys.slice().sort().join("|")) h = ((h << 5) + h + ch.charCodeAt(0)) >>> 0;
  return h.toString(36);
}

export interface RunOptions {
  /** Render and return the HTML instead of sending. */
  dry?: boolean;
  /** Send again even though the log says this week went out. */
  resend?: boolean;
  test?: boolean;
}

/** Both Sunday jobs read the same two things. */
async function gather(): Promise<{
  survivors: SurvivorReport[];
  lineups: WeeklyLineups;
  week: number | null;
  season: string;
}> {
  // One half being down is not a reason to withhold the other, same as
  // Thursday: a Sunday with lineups and no board is still worth sending.
  const [survivors, lineups] = await Promise.all([
    buildReports().catch(() => [] as SurvivorReport[]),
    buildWeeklyLineups(),
  ]);
  const week = survivors[0]?.week ?? lineups.week;
  const season = String(survivors[0]?.season ?? lineups.season ?? "");
  return { survivors, lineups, week, season };
}

/** The job, behind its lock. A preview is not a send, so it never waits on one. */
export function runSundayBrief(options: RunOptions = {}): Promise<Response> {
  if (options.dry) return runSundayBriefLocked(options);
  return withSendLock("sunday", () => runSundayBriefLocked(options));
}

async function runSundayBriefLocked(options: RunOptions = {}): Promise<Response> {
  const { dry = false, resend = false, test = false } = options;
  const { survivors, lineups, week, season } = await gather();

  if (week === null || !season) {
    return Response.json({
      ok: false,
      error: "Could not tell which week this is, so nothing was sent.",
    });
  }

  const input = {
    survivors,
    lineups,
    generatedAt: new Date().toISOString(),
    appUrl: APP_URL(),
  };
  const subject = `${test ? "[Test] " : ""}${sundaySubject(input)}`;
  const html = renderSundayBrief(input);

  if (dry) {
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  }

  const previous = await alreadySent("sunday", season, week);
  if (previous && !resend) {
    return Response.json({
      ok: true,
      skipped: true,
      reason: `Week ${week} already went out at ${previous.sentAt}. Add ?resend=1 to send it again.`,
    });
  }
  if (previous && resend) await clearSent("sunday", season, week);

  const result = await sendEmail(subject, html, `sunday:${season}:w${week}`);
  if (!result.sent) {
    return Response.json({ ok: false, error: result.reason ?? "Not sent." }, { status: 500 });
  }

  await recordSent("sunday", season, week, {
    sentAt: new Date().toISOString(),
    subject,
    messageId: result.id,
  });

  return Response.json({ ok: true, sent: true, subject, week, season });
}

/**
 * The 11:45 check.
 *
 * Sends nothing when nothing is wrong, which is the normal Sunday, and records
 * the send only when it actually sends. A quiet week must not mark the alarm
 * as done, or a problem appearing at 11:50 would be swallowed by the log.
 */
export function runLockAlarm(options: RunOptions = {}): Promise<Response> {
  if (options.dry) return runLockAlarmLocked(options);
  return withSendLock("alarm", () => runLockAlarmLocked(options));
}

async function runLockAlarmLocked(options: RunOptions = {}): Promise<Response> {
  const { dry = false, resend = false, test = false } = options;
  const { survivors, lineups, week, season } = await gather();

  if (week === null || !season) {
    return Response.json({ ok: true, skipped: true, reason: "No week to check." });
  }

  const baseline = await readBaseline(season, week);
  const now = Date.now();

  const pools: PoolAlarmInput[] = survivors.map((s) => {
    const kickoff = s.myPickCandidate?.kickoff;
    const recorded = baseline[s.poolId];
    // Only a baseline for THIS team is a baseline. Switching from an 85% pick
    // on Thursday to a different 75% one on Sunday is a decision Jack made,
    // not a line moving against him, and reporting it as a ten point drop
    // would spend the week's one alarm on his own choice.
    const sameTeam = recorded?.pick != null && recorded.pick === s.myPick;
    return {
      pool: s.pool.name,
      pick: s.myPick,
      winProb: s.myPickCandidate?.winProb ?? null,
      baselineWinProb: sameTeam ? (recorded?.winProb ?? null) : null,
      locked: kickoff ? Date.parse(kickoff) <= now : false,
    };
  });

  // Only slots that can still be changed. A player whose game has kicked off
  // is not a decision any more, and telling Jack his 9:30am London starter is
  // out at 11:45 is a notification with nothing on the other end of it.
  const slots: SlotAlarmInput[] = lineups.leagues.flatMap((league) =>
    league.error
      ? []
      : league.advice.slots
          .filter((slot) => !slot.current?.locked)
          .map((slot) => ({
            league: league.leagueName,
            slot: slot.slot,
            index: slot.index,
            player: slot.current?.name ?? null,
            status: slot.current?.onBye ? "Bye" : (slot.current?.injuryStatus ?? null),
          })),
  );

  const found = lockAlarms({ pools, slots });

  if (found.length === 0) {
    return Response.json({
      ok: true,
      skipped: true,
      reason: "Nothing is wrong, so nothing was sent.",
      checked: { pools: pools.length, slots: slots.length },
    });
  }

  // One email per PROBLEM, not one per week. A record without keys is from
  // before problems were keyed; it is read as covering everything it saw,
  // which is what it used to mean.
  const previous = dry ? null : await alreadySent("alarm", season, week);
  const sentKeys = resend ? [] : (previous?.keys ?? (previous ? found.map((r) => r.key) : []));
  const fresh = unseenAlarms(found, sentKeys);
  if (previous && !resend && fresh.length === 0) {
    return Response.json({
      ok: true,
      skipped: true,
      reason: `An alarm already went out at ${previous.sentAt} about everything that is wrong: ${previous.note ?? ""}`.trim(),
    });
  }
  // The new problem leads; anything still unfixed from the earlier alarm
  // follows, so the email is complete on its own.
  const reasons = [...fresh, ...found.filter((r) => !fresh.includes(r))];

  const input = { reasons, week, generatedAt: new Date().toISOString(), appUrl: APP_URL() };
  const subject = `${test ? "[Test] " : ""}${alarmSubject(input)}`;
  const html = renderLockAlarm(input);

  if (dry) {
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  }

  // The idempotency key names the problems, so a retry of this send is a
  // no-op and a later send about a new problem is not.
  const result = await sendEmail(subject, html, `alarm:${season}:w${week}:${digest(fresh.map((r) => r.key))}`);
  if (!result.sent) {
    return Response.json({ ok: false, error: result.reason ?? "Not sent." }, { status: 500 });
  }

  await recordSent("alarm", season, week, {
    sentAt: new Date().toISOString(),
    subject,
    messageId: result.id,
    note: reasons.map((r) => r.kind).join(", "),
    keys: [...new Set([...sentKeys, ...reasons.map((r) => r.key)])],
  });

  return Response.json({ ok: true, sent: true, subject, week, reasons });
}
