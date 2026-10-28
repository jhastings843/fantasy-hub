import "server-only";
import { harrisReview, harrisWeeks } from "../harris";
import { dropPicksCore, getPicksCore, getQuotes } from "../report";
import { activatedFor } from "../report-scope";
import { strategies } from "../engine";
import { redis } from "@/lib/redis/client";
import { loadForecasts } from "../forecasts";
import { loadIssued } from "../issued-store";
import { loadDecisions } from "../decisions-store";
import { compose, exposureFrom } from "../compose";
import { unitReport } from "../units";
import { confirmed } from "../issued";
import { firstSends } from "../update";
import type { League } from "../parse";
import { sourceState, type PicksPolicy } from "../policy";
import { redisStore } from "./store";
import { nextReviewAt, runReview, type ReviewInputs, type ReviewResult } from "./review";
import { WEEKLY_CAP } from "../limits";

// Gathers the real inputs and runs one review. Called by the pulse (weekly
// slot) and by the dry-run endpoint; never by a page view.

const LEAGUES: League[] = ["nfl", "cfb"];

async function gather(now: Date): Promise<ReviewInputs> {
  const cores = await Promise.all(LEAGUES.map(async (l) => ({ league: l, core: (await getPicksCore(l)).value })));
  const season = cores.find((c) => c.core)?.core?.season ?? now.getUTCFullYear();
  const [forecasts, issued, decided] = await Promise.all([
    Promise.all(LEAGUES.map(async (l) => ({ league: l, snaps: await loadForecasts(l, season) }))),
    Promise.all(LEAGUES.map(async (l) => ({ league: l, records: await loadIssued(l, season) }))),
    loadDecisions(season),
  ]);
  const finals = cores.map((c) => ({ league: c.league, map: new Map(c.core?.finals ?? []) }));
  const closes = cores.map((c) => ({ league: c.league, map: new Map((c.core?.closes ?? []).map(([k, v]) => [k, v.close] as const)) }));
  const ruleTest = Object.fromEntries(cores.map((c) => [c.league, c.core?.strategies.rule?.test])) as ReviewInputs["ruleTest"];
  // Re-read from Redis each time, so before/after are independent reads.
  const history = async () => {
    const fresh = await Promise.all(LEAGUES.map(async (l) => ({ league: l, records: await loadIssued(l, season) })));
    return JSON.stringify(fresh.map((i) => [i.league, unitReport(firstSends(confirmed(i.records)), finals.find((f) => f.league === i.league)!.map).total]));
  };
  const settled = new Set<string>(((await redis.hkeys(`picks:v2:settled:${season}`).catch(() => [])) as string[]).map(String));
  for (const f of finals) for (const k of f.map.keys()) settled.add(`${f.league}:${k}`);
  const replay = async (policy: PicksPolicy) =>
    Promise.all(
      cores.flatMap(({ league, core }) => {
        if (!core) return [];
        return [
          (async () => {
            const quotes = await getQuotes(league, core.season, core.week);
            const recs = issued.find((i) => i.league === league)!.records;
            const ex = exposureFrom(league, core.week, issued, settled);
            // Rebuild the rules under the candidate policy, so a newly
            // activated cut is actually exercised by the replay.
            // On the same games the weekly rule is chosen on (weeks before this one).
            const prior = core.week ? core.graded.filter((g) => g.week < core.week!) : core.graded;
            const replayCore = { ...core, strategies: strategies(league, prior, { activated: activatedFor(league, policy.atsCandidates), noPem: sourceState(policy, "pem") === "out" }) };
            const r = compose({ core: replayCore, quotes, issued: recs, exposure: ex, policy });
            const stakes = [...r.board.map((g) => g.stake ?? 0), ...r.totals.board.map((g) => g.stake ?? 0)].filter((x) => x > 0);
            const unpriced = r.board.filter((g) => (g.stake ?? 0) > 0 && g.priceSource !== "quoted").length;
            return { league, stakes, weeklyRoom: Math.max(0, WEEKLY_CAP - ex.weekly), unpricedStakes: unpriced };
          })(),
        ];
      }),
    );
  // Harris's sheet lines, verified sheets only, keyed like every other college game.
  const harris = new Map<string, number>();
  for (const w of await harrisWeeks(season).catch(() => [])) if (w.verified) for (const r of w.rows) harris.set(`${w.week}:${r.away}@${r.home}`, r.model);
  return { now, forecasts, finals, closes, issued, ruleTest, replay, history, decisions: decided.decisions, decisionDays: decided.days, harris };
}

export async function runStrategyReview(opts: { dryRun?: boolean; reason?: string; now?: Date } = {}): Promise<ReviewResult> {
  const now = opts.now ?? new Date();
  const r = await runReview(redisStore, await gather(now), { dryRun: opts.dryRun, reason: opts.reason });
  // A real review (scheduled or manual): drop the cached cores so the next
  // build freezes this week's rule under the policy it left in force
  // (rule-freeze.ts). A rule already frozen this week stays as it is.
  if (!opts.dryRun) await Promise.all(LEAGUES.map(dropPicksCore));
  return r;
}

/**
 * The trigger, cheap enough for every hourly pulse: review once the next
 * slate slot (7am ET Fri, Sun, Mon, Tue) has passed. The rule's record moves
 * at the Tuesday turnover; the policy can change at any slate review, one
 * change per part per NFL week. A failed review retries after a 6-hour
 * backoff (the slot stays due until one succeeds).
 */
const BACKOFF = "picks:v2:learning:backoff";

export async function reviewIfDue(now = new Date()): Promise<string> {
  // A review that failed waits before trying again, rather than every hour.
  const until = await redis.get<string>(BACKOFF).catch(() => null);
  if (until && now.toISOString() < until) return `backing off after a failed review until ${until}`;
  const state = await redisStore.state();
  // The slot follows from the last review, so a schedule change applies at once (state written under the weekly one said next Tuesday).
  const next = state ? [state.nextReviewAt, nextReviewAt(new Date(state.lastReviewAt))].sort()[0] : null;
  const due = !next || now.toISOString() >= next;
  if (!due) return `not due (next ${next})`;
  try {
    const r = await runStrategyReview({ reason: "scheduled", now });
    // The Harris tracker rides along: report-only, it can file a proposal, never a change.
    const harris = await harrisReview(now).catch((e) => `Harris tracker failed: ${e instanceof Error ? e.message : String(e)}`);
    return `${r.state.lastOutcome} · ${harris}`;
  } catch (e) {
    const next = new Date(now.getTime() + 6 * 3600 * 1000).toISOString();
    await redis.set(BACKOFF, next, { ex: 6 * 3600 }).catch(() => {});
    await redisStore.append({ at: now.toISOString(), kind: "ops", title: "Review failed; retrying in 6 hours", why: e instanceof Error ? e.message : String(e) }).catch(() => {});
    throw e;
  }
}
