import "server-only";
import { redis } from "@/lib/redis/client";
import { buildReports, SEASON } from "@/lib/survivor/report";
import { revalidateGames } from "@/lib/survivor/odds";
import { revalidatePublicPicks } from "@/lib/survivor/ownership";
import { revalidateInjuries } from "@/lib/survivor/intel";
import { revalidateFeed } from "@/lib/jingles/feed";
import { ingestJingles } from "@/lib/jingles/ingest";
import { buildWeeklyLineups } from "@/lib/lineup/build";
import { revalidateProjections } from "@/lib/guillotine/projections";
import { buildWaivers } from "@/lib/waivers/build";
import { getMyLeagues } from "@/lib/league/discover";
import { getNflState } from "@/lib/sleeper/client";
import { alreadySent as sharedAlreadySent } from "@/lib/email/sent-log";
import { alreadySent as thursdayAlreadySent } from "@/lib/thursday/sent-log";
import { fcFormatFromProfile, revalidateFCValues } from "@/lib/fantasycalc/client";
import { revalidateMovers, revalidatePicks } from "@/lib/rosteraudit/client";
import { revalidateAllPlayers } from "@/lib/sleeper/client";
import { runFaabEmail, configuredSendDay } from "@/lib/guillotine/run";
import { runThursdayEmail, configuredSendDay as thursdaySendDay } from "@/lib/thursday/run";
import { runMidweekEmail } from "@/lib/midweek/run";
import { runLockAlarm, runSundayBrief } from "@/lib/sunday/run";
import { tempoFor, type PulseTier, type SendId, type Tempo } from "./tempo";

// The heartbeat.
//
// Everything in this app used to refresh only when a page was opened, which is
// fine for a tool you sit in front of and useless for one that is supposed to
// know something at 11:40 on a Sunday. GitHub Actions calls /api/pulse every
// fifteen minutes; tempo.ts decides what that call means; this file does it.
//
// Two rules hold the whole thing together:
//
//   One dead source never stops the others. Yahoo being down must not cost us
//   the odds refresh, so every job is settled independently and its failure is
//   reported rather than thrown.
//
//   The send log is the schedule. A due send is attempted on every run until
//   the log says it went, so a fifteen minute outage costs nothing and a two
//   hour one costs nothing either.

/** Long enough for a slow Sleeper, short enough to leave room for the rest. */
const JOB_TIMEOUT_MS = 25_000;

/**
 * The whole run's budget, against Vercel's 60 second ceiling.
 *
 * Fifty rather than sixty because being killed mid-send is the one outcome
 * with no receipt: the email may or may not have gone, and nothing knows
 * which. Stopping early and leaving it for the next run fifteen minutes later
 * costs nothing, because the send log is the schedule.
 */
const DEADLINE_MS = 50_000;

/** Below this there is no point starting another send. */
const MIN_SEND_MS = 8_000;

/** Where the last receipt lives, for /api/health to read. */
const LAST_KEY = "pulse:last";
const LAST_TTL = 60 * 60 * 24 * 3;

/**
 * How long a tier waits after doing its work before it will do it again.
 *
 * This is where "once an hour" actually lives. Four calls land in every hour
 * and GitHub can deliver them late, early or out of order, so gating on the
 * minute would drop a whole hour the moment a run slipped past its window.
 * Gating on what last ran cannot: a late run still does the work, and the
 * three calls behind it still do nothing.
 *
 * Forty-five minutes rather than sixty, because a run at :05 followed by one
 * at :59 is two runs in the same hour by the clock and an hour apart in fact,
 * and the second is the one worth keeping.
 */
const MIN_GAP_MS: Partial<Record<PulseTier, number>> = {
  hourly: 45 * 60 * 1000,
  overnight: 12 * 60 * 60 * 1000,
};

export interface JobResult {
  job: string;
  ok: boolean;
  ms: number;
  detail?: string;
  error?: string;
}

export interface SendOutcome {
  id: SendId;
  status: "sent" | "skipped" | "failed";
  detail?: string;
}

export interface PulseReceipt {
  at: string;
  tier: PulseTier;
  window: string;
  et: Tempo["et"];
  jobs: JobResult[];
  sends: SendOutcome[];
  ms: number;
  ok: boolean;
}

/** A lease, so two runs landing together cannot both claim the same tier. */
const LEASE_SECONDS = 90;

/**
 * Whether this run is the one that does the tier's work.
 *
 * Two keys, on purpose. `pulse:ran:<tier>` is written only AFTER the work
 * finishes, so a failed 4am overnight run does not block the 4:15 retry for
 * twelve hours; `pulse:lease:<tier>` is an atomic NX claim that expires on its
 * own, so two runs arriving together cannot both start.
 *
 * Live is never debounced: every fifteen minutes is the point of it. A Redis
 * failure resolves to yes, because a heartbeat that stops when the cache is
 * unreachable is the wrong failure: at worst the work runs twice.
 */
async function claimTier(tier: PulseTier): Promise<boolean> {
  const gap = MIN_GAP_MS[tier];
  if (!gap) return true;

  try {
    const last = await redis.get<number>(`pulse:ran:${tier}`);
    if (typeof last === "number" && Date.now() - last < gap) return false;
    const lease = await redis.set(`pulse:lease:${tier}`, Date.now(), {
      nx: true,
      ex: LEASE_SECONDS,
    });
    return lease === "OK";
  } catch {
    return true;
  }
}

/** Only a finished tier counts as done. */
async function recordTierRun(tier: PulseTier): Promise<void> {
  const gap = MIN_GAP_MS[tier];
  if (!gap) return;
  try {
    await redis.set(`pulse:ran:${tier}`, Date.now(), {
      ex: Math.ceil((gap * 4) / 1000),
    });
  } catch {
    /* Worst case the tier runs again sooner than it needed to. */
  }
}

async function withTimeout<T>(work: Promise<T>, ms: number, name: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${name} took longer than ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function job(name: string, work: () => Promise<string>): Promise<JobResult> {
  const started = Date.now();
  try {
    const detail = await withTimeout(work(), JOB_TIMEOUT_MS, name);
    return { job: name, ok: true, ms: Date.now() - started, detail };
  } catch (e) {
    return {
      job: name,
      ok: false,
      ms: Date.now() - started,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * The survivor board.
 *
 * Forced means the three upstream caches are dropped first, so a live window
 * genuinely re-reads ESPN and Yahoo rather than serving a copy that is inside
 * its TTL. Unforced, this is nearly free: every fetcher behind it returns its
 * cached value and the report is rebuilt from that.
 */
async function refreshSurvivor(force: boolean): Promise<string> {
  if (force) {
    await Promise.allSettled([
      revalidateGames(SEASON),
      revalidatePublicPicks(SEASON),
      revalidateInjuries(),
    ]);
  }
  const reports = await buildReports();
  const week = reports[0]?.week ?? "?";
  const picks = reports.map((r) => `${r.pool.name.replace(/-entry pool$/, "")}: ${r.myPick ?? "none"}`);
  return `week ${week}, ${picks.join(", ")}`;
}

async function refreshJingles(force: boolean): Promise<string> {
  if (force) await revalidateFeed();
  const report = await ingestJingles();
  const weekly = report.weeklyIngested.filter((w) => w.changed).length;
  return `${report.postsSeen} posts, ${report.postsNew} new, ${weekly} weekly list${weekly === 1 ? "" : "s"} changed`;
}

/**
 * The four lineups, and the injury statuses inside them.
 *
 * Forced drops the week projections first. That feed is where a starter's
 * status actually comes from (getAllPlayers is slimmed and has no
 * injury_status), and at six hours of TTL an 11:30 inactive would not be
 * visible before a 13:00 lock, which would leave the Sunday alarm silent in
 * the one situation it exists for.
 */
async function refreshLineups(force = false): Promise<string> {
  let dropped = 0;
  if (force) {
    dropped = await revalidateProjections().catch(() => 0);
  }
  const lineups = await buildWeeklyLineups();
  const changes = lineups.leagues.reduce((n, l) => n + l.advice.changes.length, 0);
  const statuses = force ? `, ${dropped} projection cache${dropped === 1 ? "" : "s"} dropped` : "";
  return `${lineups.leagues.length} leagues, ${changes} change${changes === 1 ? "" : "s"}${statuses}`;
}

async function refreshWaivers(): Promise<string> {
  const leagues = (await getMyLeagues()).filter(
    (l) => l.source !== "manual" && l.type !== "guillotine",
  );
  const results = await Promise.allSettled(leagues.map((l) => buildWaivers(l.id)));
  const ok = results.filter((r) => r.status === "fulfilled").length;
  return `${ok} of ${leagues.length} leagues rebuilt`;
}

/**
 * The slow-moving data, dropped rather than refetched.
 *
 * Values, traded picks and the player list are six to twenty-four hour caches
 * that nothing is waiting on at 4am. Dropping the keys means the first page
 * view of the day pays one fetch and sees today's numbers, which is cheaper
 * than warming four formats nobody may open.
 */
async function refreshValues(): Promise<string> {
  const leagues = (await getMyLeagues()).filter((l) => l.source !== "manual");
  const formats = [...new Set(leagues.map((l) => fcFormatFromProfile(l)))];
  await Promise.allSettled([
    ...formats.map((f) => revalidateFCValues(f)),
    revalidatePicks(),
    revalidateMovers(),
    revalidateAllPlayers(),
  ]);
  return `${formats.length} value format${formats.length === 1 ? "" : "s"}, picks, movers, players`;
}

function jobsFor(tier: PulseTier): { name: string; work: () => Promise<string> }[] {
  switch (tier) {
    case "live":
      return [
        { name: "survivor", work: () => refreshSurvivor(true) },
        { name: "jingles", work: () => refreshJingles(true) },
        { name: "lineups", work: () => refreshLineups(true) },
      ];
    case "hourly":
      return [
        { name: "jingles", work: () => refreshJingles(false) },
        { name: "survivor", work: () => refreshSurvivor(false) },
        { name: "lineups", work: () => refreshLineups() },
        { name: "waivers", work: () => refreshWaivers() },
      ];
    case "overnight":
      return [{ name: "values", work: () => refreshValues() }];
    default:
      return [];
  }
}

/** Each send, told to ignore its own day gate because tempo already applied it. */
async function runSend(id: SendId): Promise<Response> {
  switch (id) {
    case "faab":
      // Day gate only. A week with no usable report should stay silent rather
      // than spend the week's send on an apology.
      return runFaabEmail({ ignoreDayGate: true });
    case "midweek":
      return runMidweekEmail();
    case "thursday":
      return runThursdayEmail({ force: true });
    case "sunday":
      return runSundayBrief();
    case "alarm":
      return runLockAlarm();
  }
}

async function attemptSend(id: SendId, budgetMs: number): Promise<SendOutcome> {
  try {
    const res = await withTimeout(runSend(id), budgetMs, `${id} email`);
    const body = (await res.clone().json().catch(() => ({}))) as {
      sent?: boolean;
      skipped?: boolean;
      reason?: string;
      error?: string;
      subject?: string;
      id?: string;
    };
    if (body.sent) return { id, status: "sent", detail: body.subject };
    // The FAAB guide predates the shared shape and answers { ok, id }.
    if (body.id) return { id, status: "sent", detail: body.subject };
    if (body.error) return { id, status: "failed", detail: body.error };
    return { id, status: "skipped", detail: body.reason };
  } catch (e) {
    return { id, status: "failed", detail: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Has this email already gone out this week?
 *
 * Asked before the work, not after it. Every sender checks its own log, but
 * only once it has built the report the email is made of, and a send that
 * went at 08:00 stays "due" until midnight: that is sixty-four rebuilds of the
 * same report for one email. This is two Redis reads instead.
 *
 * Unknown means no. The FAAB guide's log is keyed by league as well as week
 * and is not worth resolving here, so it keeps checking itself.
 */
async function alreadyWentOut(id: SendId): Promise<boolean> {
  if (id === "faab") return false;
  try {
    const state = await getNflState();
    const week = state.display_week ?? state.week;
    if (!week || !state.season) return false;
    if (id === "thursday") return (await thursdayAlreadySent(state.season, week)) !== null;
    return (await sharedAlreadySent(id, state.season, week)) !== null;
  } catch {
    return false;
  }
}

export async function runPulse(
  options: { now?: Date; tier?: PulseTier; sends?: boolean } = {},
): Promise<PulseReceipt> {
  const started = Date.now();
  const now = options.now ?? new Date();

  const tempo = tempoFor(now, {
    faabDay: configuredSendDay(),
    thursdayDay: thursdaySendDay(),
  });
  const requested = options.tier ?? tempo.tier;
  // An explicitly requested tier is somebody asking by hand, and being told
  // "already ran this hour" is not what they want to hear.
  const claimed = options.tier ? true : await claimTier(requested);
  const tier = claimed ? requested : "idle";
  const window = options.tier
    ? `forced ${options.tier}, clock says ${tempo.window}`
    : claimed
      ? tempo.window
      : `${tempo.window}, already done`;

  const jobs = await Promise.all(jobsFor(tier).map((j) => job(j.name, j.work)));

  // Sends run after the refresh on purpose: an email built from numbers this
  // run just pulled is the whole point of pulling them.
  const sends: SendOutcome[] = [];
  if (options.sends !== false) {
    for (const id of tempo.dueSends) {
      // Sunday has two sends due at once and the request has 60 seconds in
      // total. Anything that will not fit is left for the run fifteen minutes
      // from now, which is what the send log makes safe.
      const left = DEADLINE_MS - (Date.now() - started);
      if (left < MIN_SEND_MS) {
        sends.push({ id, status: "skipped", detail: "no time left in this run" });
        continue;
      }
      if (await alreadyWentOut(id)) {
        sends.push({ id, status: "skipped", detail: "already went out this week" });
        continue;
      }
      sends.push(await attemptSend(id, Math.min(JOB_TIMEOUT_MS, left)));
    }
  }

  if (claimed) await recordTierRun(tier);

  const receipt: PulseReceipt = {
    at: new Date().toISOString(),
    tier,
    window,
    et: tempo.et,
    jobs,
    sends,
    ms: Date.now() - started,
    ok: jobs.every((j) => j.ok) && sends.every((s) => s.status !== "failed"),
  };

  // Written even when the run failed: a receipt that only appears on a good
  // day cannot answer "is the heartbeat alive".
  try {
    await redis.set(LAST_KEY, receipt, { ex: LAST_TTL });
  } catch {
    /* The work happened. Losing the receipt is not worth failing the run. */
  }

  return receipt;
}

export async function lastPulse(): Promise<PulseReceipt | null> {
  try {
    return (await redis.get<PulseReceipt>(LAST_KEY)) ?? null;
  } catch {
    return null;
  }
}
