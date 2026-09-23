import "server-only";
import { revalidateFeed } from "./feed";
import { ingestJingles } from "./ingest";

// How long an email will wait on his site before sending with what is stored.
const REFRESH_BUDGET_MS = 25_000;

/**
 * Read his posts and weekly board right before an email is built.
 *
 * The emails used to trust whatever the scheduled ingests had stored, and the
 * scheduler is GitHub's, which ran the fifteen-minute pulse four times on
 * 2026-09-22. His waiver post lands around 1pm Tuesday and the midweek email
 * goes at 7pm, so one skipped run was the difference between an email with his
 * picks and bids and one without. Now the send does its own read first.
 *
 * Never fatal. A slow or broken site costs the refresh, not the email: the
 * send goes ahead on stored data and the returned line says why.
 */
export async function refreshJinglesBeforeSend(): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await revalidateFeed();
    const report = await Promise.race([
      ingestJingles(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`no answer in ${REFRESH_BUDGET_MS / 1000}s`)), REFRESH_BUDGET_MS);
      }),
    ]);
    const weekly = report.weeklyIngested.filter((w) => w.changed).length;
    const waivers = report.waiversIngested.length;
    return `refreshed his posts: ${report.postsNew} new, ${weekly} weekly list${weekly === 1 ? "" : "s"} changed, ${waivers} waiver post${waivers === 1 ? "" : "s"} read`;
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    console.warn(`[email] Jingles refresh skipped, sending on stored data: ${why}`);
    return `could not refresh his posts (${why}); sent on stored data`;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
