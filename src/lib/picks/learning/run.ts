import "server-only";
import { getPicksCore, getQuotes } from "../report";
import { loadForecasts } from "../forecasts";
import { loadIssued } from "../issued-store";
import { compose, exposureFrom } from "../compose";
import { unitReport } from "../units";
import { confirmed } from "../issued";
import { firstSends } from "../update";
import type { League } from "../parse";
import type { PicksPolicy } from "../policy";
import { redisStore } from "./store";
import { runReview, type ReviewInputs, type ReviewResult } from "./review";
import { opportunities } from "./model";
import { WEEKLY_CAP } from "../limits";

// Gathers the real inputs and runs one review. Called by the pulse (weekly
// slot plus catch-up) and by the dry-run endpoint; never by a page view.

const LEAGUES: League[] = ["nfl", "cfb"];

async function gather(now: Date): Promise<ReviewInputs> {
  const cores = await Promise.all(LEAGUES.map(async (l) => ({ league: l, core: (await getPicksCore(l)).value })));
  const season = cores.find((c) => c.core)?.core?.season ?? now.getUTCFullYear();
  const [forecasts, issued] = await Promise.all([
    Promise.all(LEAGUES.map(async (l) => ({ league: l, snaps: await loadForecasts(l, season) }))),
    Promise.all(LEAGUES.map(async (l) => ({ league: l, records: await loadIssued(l, season) }))),
  ]);
  const finals = cores.map((c) => ({ league: c.league, map: new Map(c.core?.finals ?? []) }));
  const closes = cores.map((c) => ({ league: c.league, map: new Map((c.core?.closes ?? []).map(([k, v]) => [k, v.close] as const)) }));
  const ruleTest = Object.fromEntries(cores.map((c) => [c.league, c.core?.strategies.rule?.test])) as ReviewInputs["ruleTest"];
  const history = async () =>
    JSON.stringify(issued.map((i) => [i.league, unitReport(firstSends(confirmed(i.records)), finals.find((f) => f.league === i.league)!.map).total]));
  const replay = async (policy: PicksPolicy) =>
    Promise.all(
      cores.flatMap(({ league, core }) => {
        if (!core) return [];
        return [
          (async () => {
            const quotes = await getQuotes(league, core.season, core.week);
            const recs = issued.find((i) => i.league === league)!.records;
            const ex = exposureFrom(league, core.week, issued, new Set());
            const r = compose({ core, quotes, issued: recs, exposure: ex, policy });
            const stakes = [...r.board.map((g) => g.stake ?? 0), ...r.totals.board.map((g) => g.stake ?? 0)].filter((x) => x > 0);
            const unpriced = r.board.filter((g) => (g.stake ?? 0) > 0 && g.priceSource !== "quoted").length;
            return { league, stakes, weeklyRoom: Math.max(0, WEEKLY_CAP - ex.weekly), unpricedStakes: unpriced };
          })(),
        ];
      }),
    );
  return { now, forecasts, finals, closes, issued, ruleTest, replay, history };
}

export async function runStrategyReview(opts: { dryRun?: boolean; reason?: string; now?: Date } = {}): Promise<ReviewResult> {
  const now = opts.now ?? new Date();
  return runReview(redisStore, await gather(now), { dryRun: opts.dryRun, reason: opts.reason });
}

/**
 * The catch-up trigger, cheap enough for every hourly pulse: review when the
 * scheduled time has passed, or when 15+ matched games have settled since
 * the last review.
 */
export async function reviewIfDue(now = new Date()): Promise<string> {
  const state = await redisStore.state();
  const due = !state || now.toISOString() >= state.nextReviewAt;
  let newlySettled = 0;
  if (!due && state) {
    const x = await gather(now);
    const opps = x.forecasts.flatMap((f) => opportunities(f.league, f.snaps, x.finals.find((m) => m.league === f.league)!.map, new Map()));
    newlySettled = opps.filter((o) => o.final).length - state.settledOpportunities;
  }
  if (!due && newlySettled < 15) return `not due (next ${state?.nextReviewAt}; ${newlySettled} newly settled)`;
  const r = await runStrategyReview({ reason: due ? "scheduled" : `catch-up: ${newlySettled} newly settled`, now });
  return r.state.lastOutcome;
}
