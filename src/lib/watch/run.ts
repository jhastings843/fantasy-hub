import "server-only";
import { getNflState } from "@/lib/sleeper/client";
import { buildWeeklyLineups } from "@/lib/lineup/build";
import { sendEmail } from "@/lib/guillotine/send";
import { withSendLock } from "@/lib/email/sent-log";
import { alreadySent as thursdayAlreadySent } from "@/lib/thursday/sent-log";
import { buildPickups, dayInNewYork } from "@/lib/thursday/run";
import { renderWatchEmail, watchItems, watchSubject } from "@/lib/thursday/email";
import { addSeen, checkedToday, readSeen, recordChecked } from "./store";

// The daily lineup check, Thursday to the Sunday 1pm lock.
//
// The Wednesday email says what to change. Between then and kickoff things
// move: an injury tag, a revised ranking, a free agent worth grabbing. This
// rebuilds the same advice once a day and emails only when a change appears
// that no earlier email mentioned. No news, no email. The schedule is in
// pulse/tempo.ts.

export function runLineupWatch(
  options: { force?: boolean; dry?: boolean; seed?: boolean } = {},
): Promise<Response> {
  if (options.dry) return runLocked(options);
  return withSendLock("watch", () => runLocked(options));
}

async function runLocked({
  force = false,
  dry = false,
  seed = false,
}: {
  force?: boolean;
  dry?: boolean;
  seed?: boolean;
}): Promise<Response> {
  const state = await getNflState();
  const week = state.display_week ?? state.week;
  const season = state.season;
  if (!week || !season) {
    return Response.json({ ok: false, error: "Sleeper did not say which week it is." });
  }
  const today = dayInNewYork(new Date());

  // Nothing to compare against until the week's lineup email has gone.
  if (!force && !(await thursdayAlreadySent(season, week))) {
    return Response.json({ ok: true, skipped: true, reason: "This week's lineup email has not gone out yet." });
  }
  if (!force && !dry && (await checkedToday(season, week, today))) {
    return Response.json({ ok: true, skipped: true, reason: "Already checked today." });
  }

  const [lineups, pickups] = await Promise.all([buildWeeklyLineups(), buildPickups()]);
  if (lineups.blocked) {
    // Not recorded as checked, so the next pulse tries again.
    return Response.json({ ok: true, skipped: true, reason: lineups.blocked });
  }

  const items = watchItems(lineups, pickups);

  // Mark everything pending as already told, without sending. For a week whose
  // lineup email went out before the watch existed, or after a manual resend.
  if (seed) {
    await addSeen(season, week, items.map((i) => i.key));
    return Response.json({ ok: true, seeded: items.map((i) => `${i.leagueName}: ${i.text}`) });
  }
  const seen = new Set(await readSeen(season, week));
  const fresh = items.filter((i) => !seen.has(i.key));

  const input = {
    survivors: [],
    survivorError: null,
    lineups,
    pickups,
    generatedAt: new Date().toISOString(),
    appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "https://fantasy-hub-tan.vercel.app",
  };

  if (dry) {
    if (fresh.length === 0) {
      return Response.json({ ok: true, wouldSend: false, pending: items.map((i) => i.text) });
    }
    return new Response(renderWatchEmail(input, fresh), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  if (fresh.length === 0) {
    await recordChecked(season, week, today);
    return Response.json({
      ok: true,
      skipped: true,
      reason: items.length === 0 ? "Every lineup matches. No email." : `Nothing new: ${items.length} change(s) already emailed.`,
    });
  }

  const subject = watchSubject(fresh);
  const result = await sendEmail(
    subject,
    renderWatchEmail(input, fresh),
    `watch:${season}:w${week}:${fresh.map((f) => f.key).sort().join("|")}`,
  );
  if (!result.sent) {
    return Response.json({ ok: false, error: result.reason ?? "Not sent." }, { status: 500 });
  }
  await addSeen(season, week, items.map((i) => i.key));
  await recordChecked(season, week, today);
  return Response.json({ ok: true, sent: true, subject, fresh: fresh.map((f) => f.text) });
}
